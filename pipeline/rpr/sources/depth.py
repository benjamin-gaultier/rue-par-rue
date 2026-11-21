"""AI depth maps for archive photographs (prototype on Notre-Dame).

Depth Anything V2 Small (Apache 2.0, ONNX export by onnx-community) estimates
relative depth from a single photo. The app turns each photo into a relief
you can move around a little: a "3D photo", not a measured reconstruction.

Output in web/public/data/3d/depth/:
  <source>-<id>.png   8-bit depth, white = near, at most 256 px on the long side
  <source>-<id>.jpg   same-origin copy of the photo (only where the archive
                      sends no CORS headers: Paris Musées)
  index.json          photo id -> files and sizes

A depth map is derived from its photo, so only photos cleared for reuse get
one: Albert-Kahn photos whose licence is not in `kahn.DERIVABLE` are skipped,
and maps made from them earlier are removed.
"""

from __future__ import annotations

import io
import json
import math
import re
from typing import Any, Callable

from rpr import net, paths
from rpr.sources import kahn

MODEL_URL = "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model.onnx"
MODEL = paths.REPO_ROOT / "pipeline" / "cache" / "models" / "depth-anything-v2-small.onnx"
MEAN = (0.485, 0.456, 0.406)
STD = (0.229, 0.224, 0.225)
SHORT_SIDE = 518
DEPTH_MAX_SIDE = 256
IMAGE_MAX_SIDE = 900
NEEDS_COPY = {"parismusees"}

SETS = {
    "notre-dame": {"title": r"notre.?dame", "center": (2.3499, 48.8530), "radius_m": 350},
}


def selected(photos: list[dict], name: str) -> list[dict]:
    cfg = SETS[name]
    cx, cy = cfg["center"]
    out = []
    for f in photos:
        x, y = f["geometry"]["coordinates"]
        d = math.hypot((x - cx) * 111320 * math.cos(math.radians(cy)), (y - cy) * 110574)
        if d <= cfg["radius_m"] and re.search(cfg["title"], f["properties"]["title"], re.I):
            out.append(f)
    return out


def derivable(p: dict) -> bool:
    """Whether a depth map may be made from this photo (its licence allows derived works)."""
    return p["source"] != "kahn" or p.get("license") in kahn.DERIVABLE


def prune(index: dict[str, dict], photos: list[dict], out_dir) -> list[str]:
    """Remove the depth maps of photos not cleared for reuse. Returns their ids."""
    blocked = {f["properties"]["id"] for f in photos if not derivable(f["properties"])}
    gone = sorted(i for i in index if i in blocked)
    for i in gone:
        entry = index.pop(i)
        for key in ("depth", "image"):
            if key in entry:
                (out_dir / entry[key]).unlink(missing_ok=True)
    return gone


def stem_of(p: dict) -> str:
    return f"{p['source']}-{re.sub(r'[^A-Za-z0-9]+', '_', p['source_id'])}"


def input_size(w: int, h: int) -> tuple[int, int]:
    """Scale the short side to 518, both sides to multiples of 14 (as DPTImageProcessor)."""
    s = SHORT_SIDE / min(w, h)
    return max(14, round(w * s / 14) * 14), max(14, round(h * s / 14) * 14)


def normalise(depth, lo_pct: float = 2, hi_pct: float = 98):
    """Relative inverse depth -> 0..1 (1 = near), robust to outliers."""
    import numpy as np

    lo, hi = np.percentile(depth, [lo_pct, hi_pct])
    return np.clip((depth - lo) / max(hi - lo, 1e-6), 0, 1)


def crop_mount(img):
    """Cut a photographic print out of its mount (Paris Musées scans the whole card).

    The card is the colour along the scan's border; the print is the largest
    region that differs from it. Returns the image unchanged if nothing stands out.
    """
    import cv2
    import numpy as np

    a = np.asarray(img.convert("RGB"), dtype=np.int16)
    h, w, _ = a.shape
    border = np.concatenate([a[: h // 40].reshape(-1, 3), a[-h // 40 :].reshape(-1, 3), a[:, : w // 40].reshape(-1, 3), a[:, -w // 40 :].reshape(-1, 3)])
    card = np.median(border, axis=0)
    diff = np.abs(a - card).sum(axis=2)
    mask = (diff > 60).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n <= 1:
        return img
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, bw, bh = (int(v) for v in stats[k, :4])
    if bw * bh < 0.08 * w * h or bw * bh > 0.97 * w * h:
        return img  # nothing that looks like a print on a card
    inset = max(2, int(0.01 * min(bw, bh)))
    return img.crop((x + inset, y + inset, x + bw - inset, y + bh - inset))


def build(name: str = "notre-dame", log: Callable[[str], Any] = print) -> dict:
    photos = json.loads((paths.DATA_DIR / "photos.geojson").read_text(encoding="utf-8"))["features"]
    out_dir = paths.DATA_DIR / "3d" / "depth"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "index.json"
    index: dict[str, dict] = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    removed = prune(index, photos, out_dir)
    if removed:
        log(f"depth: removed {len(removed)} maps of photos not cleared for reuse: {', '.join(removed)}")
    in_set = selected(photos, name)
    chosen = [f for f in in_set if derivable(f["properties"])]
    todo = [f for f in chosen if not (f["properties"]["id"] in index and (out_dir / f"{stem_of(f['properties'])}.png").exists())]
    made = failed = 0
    if todo:  # the model is only needed when there is a photo to compute
        import numpy as np
        import onnxruntime as ort
        from PIL import Image

        if not MODEL.exists():
            size = net.download(MODEL_URL, MODEL, timeout=600)
            log(f"depth: downloaded model ({size / 1e6:.0f} MB)")
        session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    for f in todo:
        p = f["properties"]
        stem = stem_of(p)
        try:
            raw = net.fetch_bytes(p.get("image") or p["thumb"], timeout=90, retries=5)
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            if p["source"] in NEEDS_COPY:
                img = crop_mount(img)
        except Exception as err:
            failed += 1
            log(f"depth: {p['id']} image failed ({err})")
            continue
        w, h = img.size
        iw, ih = input_size(w, h)
        x = np.asarray(img.resize((iw, ih), Image.BICUBIC), dtype=np.float32) / 255.0
        x = (x - np.array(MEAN, dtype=np.float32)) / np.array(STD, dtype=np.float32)
        x = x.transpose(2, 0, 1)[None]
        depth = session.run(None, {"pixel_values": x})[0][0]
        d = normalise(depth)
        dimg = Image.fromarray((d * 255).astype(np.uint8), "L")
        dimg.thumbnail((DEPTH_MAX_SIDE, DEPTH_MAX_SIDE), Image.BILINEAR)
        dimg.save(out_dir / f"{stem}.png", optimize=True)
        entry = {"depth": f"{stem}.png", "width": w, "height": h}
        if p["source"] in NEEDS_COPY:
            copy = img.copy()
            copy.thumbnail((IMAGE_MAX_SIDE, IMAGE_MAX_SIDE))
            copy.save(out_dir / f"{stem}.jpg", "JPEG", quality=80, optimize=True, progressive=True)
            entry["image"] = f"{stem}.jpg"
        index[p["id"]] = entry
        made += 1
        if made % 10 == 0:
            log(f"depth: {made} done")
            index_path.write_text(json.dumps(index, sort_keys=True), encoding="utf-8")
    index_path.write_text(json.dumps(index, sort_keys=True), encoding="utf-8")
    size = sum(f.stat().st_size for f in out_dir.glob("*") if f.suffix in (".png", ".jpg"))
    log(f"depth: {made} new, {failed} failed, {len(index)} total, {size / 1e6:.1f} MB")
    return {
        "set": name,
        "count": len(index),
        "failed": failed,
        "not_cleared": len(in_set) - len(chosen),
        "bytes": size,
        "model": "Depth Anything V2 Small (Apache 2.0)",
    }

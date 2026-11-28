"""Photo scenes: posed photographs made ready to be painted onto the 3D model.

When a photo's camera is placed (pipeline/poses, rpr/cameras.py), the app can
project the photograph from that camera onto the model's walls, roofs and
ground, so you can walk a little way into the picture and see its streets
from beside where it was taken. This step prepares what the app needs, from
the photograph alone. It uses no generative model and makes no new pixels: it
cuts the picture out and marks where it must not be painted.

Output in web/public/data/3d/scenes/:
  <stem>.jpg       the picture, cut out by the camera's crop. A same-origin
                   copy: a WebGL texture needs one, and Paris Musées sends no
                   CORS headers.
  <stem>-mask.png  where the photo must not paint. Red: sky. Green: leaves
                   (colour photos only). Blue: boxes covered by hand, such as
                   a museum's label printed on the plate.
  index.json       photo id -> files, size, crop, and the share of each mask

The sky is the light, smooth part of the picture that touches its top edge.
Leaves are the green of an autochrome. Both are found by colour and texture
only, so they are approximate; the app shows the model there instead.

Only photos cleared for reuse get a scene (depth.derivable: the copy is a
derived work), and only when their camera is placed with a confidence of at
least MIN_CONFIDENCE: a badly placed camera paints walls with the wrong
houses. Boxes to cover are set by hand in pipeline/scenes.json.
"""

from __future__ import annotations

import io
import json
from collections import deque
from pathlib import Path
from typing import Any, Callable

from rpr import net, paths
from rpr.sources.depth import derivable, stem_of

MIN_CONFIDENCE = 0.5
MAX_SIDE = 1600
WORK_SIDE = 480  # the masks are found at this size, then scaled up
SETTINGS_FILE = paths.REPO_ROOT / "pipeline" / "scenes.json"
COLOUR_MEDIA = {"autochrome"}


def crop_of(p: dict) -> list[float] | None:
    """The camera's crop as four shares, or None when the photo has no full camera."""
    c = p.get("camera_crop")
    if not c or p.get("camera_hfov") is None:
        return None
    vals = [float(v) for v in str(c).split(",")]
    return vals if len(vals) == 4 else None


def chosen(photos: list[dict]) -> list[dict]:
    """Photos that get a scene: a full camera placed well enough, and cleared for reuse."""
    out = []
    for f in photos:
        p = f["properties"]
        if crop_of(p) is None or (p.get("camera_confidence") or 0) < MIN_CONFIDENCE:
            continue
        if derivable(p):
            out.append(f)
    return out


def crop_box(w: int, h: int, crop: list[float]) -> tuple[int, int, int, int]:
    """The crop in pixels (left, top, right, bottom), inside the image."""
    x0, y0, x1, y1 = crop
    box = (round(x0 * w), round(y0 * h), round(x1 * w), round(y1 * h))
    left, top = max(0, box[0]), max(0, box[1])
    return left, top, max(left + 1, min(w, box[2])), max(top + 1, min(h, box[3]))


def load_settings(path: Path = SETTINGS_FILE) -> dict[str, dict]:
    """Per-photo settings set by hand: {"covers": [[x0, y0, x1, y1], ...]} in shares of the picture."""
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8")).get("photos", {})


# ------------------------------------------------------------------ masks


def _box_mean(a, r: int):
    """Mean over a (2r+1)² square, edges repeated (numpy only)."""
    import numpy as np

    p = np.pad(a, r, mode="edge")
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    n = 2 * r + 1
    return (c[n:, n:] - c[:-n, n:] - c[n:, :-n] + c[:-n, :-n]) / (n * n)


def _flood(allowed, seed):
    """The pixels of `allowed` connected (4-neighbours) to a pixel of `seed`."""
    import numpy as np

    h, w = allowed.shape
    out = seed & allowed
    q = deque(zip(*np.nonzero(out)))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and allowed[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                q.append((ny, nx))
    return out


def _fill_from_top(allowed):
    """The pixels of `allowed` connected to the top row."""
    import numpy as np

    seed = np.zeros_like(allowed)
    seed[0] = True
    return _flood(allowed, seed)


def _drop_small(mask, min_px: int):
    """Mask without its connected pieces smaller than min_px."""
    import numpy as np

    h, w = mask.shape
    seen = np.zeros_like(mask)
    keep = np.zeros_like(mask)
    for y0, x0 in zip(*np.nonzero(mask)):
        if seen[y0, x0]:
            continue
        piece = [(y0, x0)]
        seen[y0, x0] = True
        q = deque(piece)
        while q:
            y, x = q.popleft()
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
                    piece.append((ny, nx))
        if len(piece) >= min_px:
            ys, xs = zip(*piece)
            keep[list(ys), list(xs)] = True
    return keep


def _grow(mask, r: int):
    import numpy as np

    return _box_mean(mask.astype(np.float32), r) > 1e-6


def sky_mask(rgb, colour: bool):
    """Sky: light and smooth, touching the top edge (rgb: float 0..1, H×W×3).

    A paper print's sky is nearly blank (texture about 0.005 here), so a pale
    wall beside it (0.05) is kept out. An autochrome's sky has the plate's
    grain (about 0.04) and is told from stone by its blue.
    """
    grey = rgb.mean(2)
    std = (_box_mean(grey**2, 2) - _box_mean(grey, 2) ** 2).clip(0, None) ** 0.5
    if colour:
        allowed = (grey > max(0.45, float(grey.max()) * 0.6)) & (std < 0.06) & (rgb[..., 2] - rgb[..., 0] > -0.02)
    else:
        allowed = (grey > max(0.45, float(grey.max()) * 0.65)) & (std < 0.025)
    sky = _fill_from_top(allowed)
    return ~_grow(~_grow(sky, 1), 1)  # close the grain left inside the sky


def leaves_mask(rgb):
    """Leaves of a colour photo: green, or dark beside green.

    Pieces that lie wholly in the bottom fifth are left out: there the dark
    green of an autochrome is shade on the ground, not trees.
    """
    import numpy as np

    mx, mn = rgb.max(2), rgb.min(2)
    val, sat = mx, (mx - mn) / np.maximum(mx, 1e-6)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    green = (g >= r - 0.01) & (g - b > 0.025) & (sat > 0.1) & (val > 0.08) & (val < 0.85)
    dark = (val < 0.22) & _grow(green, 3)
    m = green | dark
    m = ~_grow(~m, 1)  # drop single grains
    m = ~_grow(~_grow(m, 2), 2)  # close small holes
    m = _drop_small(m, max(30, m.size // 1000))
    high = np.zeros_like(m)
    high[: int(m.shape[0] * 0.8)] = True
    m = _flood(m, high)  # keep the pieces that reach above the bottom fifth
    # Take in the gaps between leaves (sky, trunks, dark shade), which would
    # otherwise be painted onto the wall behind as specks: dark pixels at a
    # tree's edge, and small holes inside it.
    m |= _grow(m, 4) & (val < 0.35)
    m |= ~m & ~_drop_small(~m, m.size // 400)
    return _grow(m, 1)


def covers_mask(h: int, w: int, covers: list[list[float]]):
    import numpy as np

    m = np.zeros((h, w), bool)
    for x0, y0, x1, y1 in covers:
        m[round(y0 * h) : round(y1 * h), round(x0 * w) : round(x1 * w)] = True
    return m


def masks(img, colour: bool, covers: list[list[float]]):
    """The mask image (RGB: sky, leaves, covered) at the picture's size, and the share of each."""
    import numpy as np
    from PIL import Image

    w, h = img.size
    s = min(1.0, WORK_SIDE / max(w, h))
    small = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.BILINEAR) if s < 1 else img
    rgb = np.asarray(small.convert("RGB"), dtype=np.float32) / 255
    sky = sky_mask(rgb, colour)
    leaves = leaves_mask(rgb) & ~sky if colour else np.zeros_like(sky)
    planes = [sky, leaves, covers_mask(*sky.shape, covers)]
    out = np.stack([p.astype(np.uint8) * 255 for p in planes], 2)
    full = Image.fromarray(out, "RGB").resize((w, h), Image.NEAREST)
    shares = {k: round(float(p.mean()), 4) for k, p in zip(("sky", "leaves", "covered"), planes)}
    return full, shares


# ------------------------------------------------------------------ build


def prune(index: dict[str, dict], keep: set[str], out_dir: Path) -> list[str]:
    """Remove scenes of photos no longer chosen (camera moved below the bar, licence changed)."""
    gone = sorted(i for i in index if i not in keep)
    for i in gone:
        entry = index.pop(i)
        for key in ("image", "mask"):
            if key in entry:
                (out_dir / entry[key]).unlink(missing_ok=True)
    return gone


def build(log: Callable[[str], Any] = print, rebuild: bool = False) -> dict:
    from PIL import Image

    photos = json.loads((paths.DATA_DIR / "photos.geojson").read_text(encoding="utf-8"))["features"]
    out_dir = paths.DATA_DIR / "3d" / "scenes"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "index.json"
    index: dict[str, dict] = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    settings = load_settings()
    picked = chosen(photos)
    removed = prune(index, {f["properties"]["id"] for f in picked}, out_dir)
    if removed:
        log(f"scenes: removed {len(removed)}: {', '.join(removed)}")
    made = failed = 0
    for f in picked:
        p = f["properties"]
        crop = crop_of(p)
        covers = settings.get(p["id"], {}).get("covers", [])
        old = index.get(p["id"])
        if old and not rebuild and old.get("crop") == crop and old.get("covers", []) == covers and (out_dir / old["image"]).exists():
            continue
        stem = stem_of(p)
        try:
            raw = net.fetch_bytes(p.get("image") or p["thumb"], timeout=90, retries=5)
            img = Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as err:
            failed += 1
            log(f"scenes: {p['id']} image failed ({err})")
            continue
        pic = img.crop(crop_box(*img.size, crop))
        pic.thumbnail((MAX_SIDE, MAX_SIDE))
        mask, shares = masks(pic, p.get("media") in COLOUR_MEDIA, covers)
        pic.save(out_dir / f"{stem}.jpg", "JPEG", quality=88, optimize=True, progressive=True)
        mask.save(out_dir / f"{stem}-mask.png", optimize=True)
        index[p["id"]] = {
            "image": f"{stem}.jpg",
            "mask": f"{stem}-mask.png",
            "width": pic.size[0],
            "height": pic.size[1],
            "crop": crop,
            **({"covers": covers} if covers else {}),
            **shares,
        }
        made += 1
        log(f"scenes: {p['id']} {pic.size[0]}x{pic.size[1]}, sky {shares['sky']:.0%}, leaves {shares['leaves']:.0%}")
    index_path.write_text(json.dumps(index, sort_keys=True, indent=1) + "\n", encoding="utf-8")
    size = sum(q.stat().st_size for q in out_dir.glob("*") if q.suffix in (".png", ".jpg"))
    log(f"scenes: {made} new, {failed} failed, {len(index)} total, {size / 1e6:.2f} MB")
    return {"count": len(index), "failed": failed, "bytes": size, "min_confidence": MIN_CONFIDENCE}

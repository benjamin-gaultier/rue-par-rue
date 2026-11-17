"""Small same-origin thumbnails for photos shown as frames in the 3D view.

Prints are cut out of their mounts first (see depth.crop_mount).

WebGL can only draw images served with CORS headers. The Albert-Kahn portal
sends them; the Paris Musées site does not, so we keep small copies of its
CC0 images for the 3D area. Output: web/public/data/3d/thumbs/ and an
index.json mapping photo id -> file.
"""

from __future__ import annotations

import io
import json
from typing import Any, Callable

from rpr import net, paths
from rpr.sources.depth import crop_mount
from rpr.sources.model3d import AREAS

MAX_SIDE = 224
QUALITY = 70
# Sources whose image servers send CORS headers need no copy.
NEEDS_COPY = {"parismusees"}


def build(area: str = "cite", log: Callable[[str], Any] = print, rebuild: bool = False) -> dict:
    from PIL import Image

    x0, y0, x1, y1 = AREAS[area]["bbox"]
    photos = json.loads((paths.DATA_DIR / "photos.geojson").read_text())["features"]
    out_dir = paths.DATA_DIR / "3d" / "thumbs"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_path = out_dir / "index.json"
    index: dict[str, str] = json.loads(index_path.read_text()) if index_path.exists() else {}
    made = skipped = failed = 0
    for f in photos:
        p = f["properties"]
        lon, lat = f["geometry"]["coordinates"]
        if p["source"] not in NEEDS_COPY or not (x0 <= lon <= x1 and y0 <= lat <= y1):
            continue
        name = f"{p['source']}-{p['source_id']}.jpg"
        if not rebuild and p["id"] in index and (out_dir / name).exists():
            skipped += 1
            continue
        try:
            raw = net.fetch_bytes(p.get("thumb") or p["image"], timeout=60)
            im = crop_mount(Image.open(io.BytesIO(raw)).convert("RGB"))
            im.thumbnail((MAX_SIDE, MAX_SIDE))
            im.save(out_dir / name, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            index[p["id"]] = name
            made += 1
        except Exception as err:  # keep going; the 3D view falls back to a label
            failed += 1
            log(f"thumbs: {p['id']} failed ({err})")
    index_path.write_text(json.dumps(index, sort_keys=True, ensure_ascii=False))
    size = sum(f.stat().st_size for f in out_dir.glob("*.jpg"))
    log(f"thumbs: {made} made, {skipped} already there, {failed} failed; {len(index)} total, {size / 1e6:.1f} MB")
    return {"area": area, "count": len(index), "bytes": size, "failed": failed}

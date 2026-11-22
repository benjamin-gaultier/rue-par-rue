"""Full-size images of the photos of 1900-1929 in a model area.

A photo becomes a wall only at a size that holds up when seen close. The app
shows 224 px thumbnails; this fetches the largest image each archive serves
without an account:

  Albert-Kahn   the open data file, 800 px on the long side, saved as served.
                Only photos whose licence allows derived works
                (`kahn.DERIVABLE`): the others are never downloaded.
  Paris Musées  the image of the work's IIIF manifest, 2,160 px on the long
                side (CC0). The scan shows the whole card, so the print is cut
                out of its mount (`depth.crop_mount`) and saved as JPEG.
                Without a manifest image: the 1,080 px image of the work page.

Output in pipeline/cache/era1920/ (not committed: it is rebuilt by this command):
  images/<source>-<id>.jpg
  index.json   photo id -> file, size, where it came from, licence and credit

The licence and credit of each photo are copied into the index, so that every
texture cut from an image can carry them.
"""

from __future__ import annotations

import io
import json
import time
from pathlib import Path
from typing import Any, Callable

from rpr import net, paths
from rpr.areas import AREAS
from rpr.photo import ERA_1920, in_era
from rpr.sources import kahn
from rpr.sources.depth import crop_mount, stem_of

CACHE = paths.REPO_ROOT / "pipeline" / "cache" / "era1920"
IIIF_MANIFEST = "https://apicollections.parismusees.paris.fr/iiif/{id}/manifest"
JPEG_QUALITY = 92
PAUSE_S = 0.25  # between downloads: these are museums' servers


def derivable(p: dict) -> bool:
    """Whether textures may be cut from this photo (DATA_SOURCES.md)."""
    if p["source"] == "kahn":
        return p.get("license") in kahn.DERIVABLE
    return p.get("license") == "CC0-1.0"


def selected(photos: list[dict], area: str) -> tuple[list[dict], int]:
    """Photos of the era inside the area that may be used, and how many may not."""
    x0, y0, x1, y1 = AREAS[area]["bbox"]
    chosen, not_cleared = [], 0
    for f in photos:
        lon, lat = f["geometry"]["coordinates"]
        p = f["properties"]
        if not (x0 <= lon <= x1 and y0 <= lat <= y1) or not in_era(p):
            continue
        if not (p.get("image") or p.get("thumb")):
            continue
        if derivable(p):
            chosen.append(f)
        else:
            not_cleared += 1
    return chosen, not_cleared


def file_name(url: str) -> str:
    """'https://…/CAR/aze_carph007198_001.jpg?itok=x' -> 'aze_carph007198_001.jpg'."""
    return url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1].lower()


def manifest_image(manifest: dict, wanted: str) -> str | None:
    """The manifest's image of the scan named `wanted`, or None.

    A work's manifest lists every scan of it: the print, its back, other
    prints. Only the scan the photo record points to is the photo, so the file
    names must match; nothing is guessed from the order.
    """
    for sequence in manifest.get("sequences") or []:
        for canvas in sequence.get("canvases") or []:
            for image in canvas.get("images") or []:
                url = (image.get("resource") or {}).get("@id")
                if isinstance(url, str) and file_name(url) == file_name(wanted):
                    return url
    return None


def fetch(p: dict, sleep: Callable[[float], Any] = time.sleep) -> tuple[bytes, str, str]:
    """The largest image of one photo: (bytes, url, which size it is)."""
    url = p.get("image") or p["thumb"]
    if p["source"] != "parismusees":
        return net.fetch_bytes(url, timeout=90), url, "open data file"
    try:
        manifest = net.fetch_json(IIIF_MANIFEST.format(id=p["source_id"]), timeout=60, retries=2)
        large = manifest_image(manifest, url)
    except Exception:  # no manifest: the work page's image is the fallback
        large = None
    if large:
        sleep(PAUSE_S)
        try:
            return net.fetch_bytes(large, timeout=120, retries=2), large, "iiif manifest image"
        except Exception:
            pass
    return net.fetch_bytes(url, timeout=90), url, "work page image"


def build(area: str = "cite", log: Callable[[str], Any] = print, limit: int | None = None, rebuild: bool = False, cache: Path | None = None) -> dict:
    from PIL import Image

    cache = cache or CACHE
    images = cache / "images"
    images.mkdir(parents=True, exist_ok=True)
    index_path = cache / "index.json"
    index: dict[str, dict] = json.loads(index_path.read_text(encoding="utf-8")) if index_path.exists() else {}
    photos = json.loads((paths.DATA_DIR / "photos.geojson").read_text(encoding="utf-8"))["features"]
    chosen, not_cleared = selected(photos, area)
    wanted = {f["properties"]["id"] for f in chosen}
    # A photo no longer selected (moved, redated, licence changed) loses its image.
    for gone in sorted(set(index) - wanted):
        (images / index.pop(gone)["file"]).unlink(missing_ok=True)
    todo = [f for f in chosen if rebuild or not (f["properties"]["id"] in index and (images / index[f["properties"]["id"]]["file"]).exists())]
    if limit is not None:
        todo = todo[:limit]
    made = failed = 0
    for f in todo:
        p = f["properties"]
        name = f"{stem_of(p)}.jpg"
        try:
            raw, url, kind = fetch(p)
            img = Image.open(io.BytesIO(raw))
            img.load()
            full = img.size
            cropped = False
            if p["source"] == "parismusees":
                cut = crop_mount(img.convert("RGB"))
                cropped = cut.size != full
                cut.save(images / name, "JPEG", quality=JPEG_QUALITY, optimize=True)
                img = cut
            else:
                (images / name).write_bytes(raw)  # as served: no second JPEG pass
        except Exception as err:
            failed += 1
            log(f"eraimages: {p['id']} failed ({err})")
            continue
        index[p["id"]] = {
            "file": name,
            "width": img.size[0],
            "height": img.size[1],
            "scan_width": full[0],
            "scan_height": full[1],
            "cut_from_mount": cropped,
            "from": kind,
            "url": url.split("?", 1)[0],
            "license": p["license"],
            "credit": p.get("credit"),
            "creator": p.get("creator"),
            "title": p["title"],
        }
        made += 1
        if made % 25 == 0:
            log(f"eraimages: {made} of {len(todo)}")
            index_path.write_text(json.dumps(index, sort_keys=True, ensure_ascii=False, indent=1), encoding="utf-8")
        time.sleep(PAUSE_S)
    index_path.write_text(json.dumps(index, sort_keys=True, ensure_ascii=False, indent=1), encoding="utf-8")
    summary = summarise(index, images)
    log(f"eraimages: {made} new, {failed} failed, {summary['count']} of {len(chosen)} on disk, {summary['bytes'] / 1e6:.0f} MB; {not_cleared} not cleared for reuse and left out")
    return {"area": area, "era": list(ERA_1920), "selected": len(chosen), "not_cleared": not_cleared, "failed": failed, **summary}


def summarise(index: dict[str, dict], images: Path) -> dict:
    """Counts for the manifest: images per source and size, bytes on disk."""
    by_source: dict[str, int] = {}
    by_kind: dict[str, int] = {}
    long_sides = []
    for pid, entry in index.items():
        source = pid.split(":", 1)[0]
        by_source[source] = by_source.get(source, 0) + 1
        by_kind[entry["from"]] = by_kind.get(entry["from"], 0) + 1
        long_sides.append(max(entry["width"], entry["height"]))
    long_sides.sort()
    return {
        "count": len(index),
        "by_source": dict(sorted(by_source.items())),
        "by_size": dict(sorted(by_kind.items())),
        "cut_from_mount": sum(1 for e in index.values() if e["cut_from_mount"]),
        "median_long_side": long_sides[len(long_sides) // 2] if long_sides else 0,
        "bytes": sum((images / e["file"]).stat().st_size for e in index.values() if (images / e["file"]).exists()),
    }

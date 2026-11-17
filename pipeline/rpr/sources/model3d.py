"""A 3D massing model of a small area as it stood in 1836 (prototype).

Two kinds of buildings go into the model:

* Buildings that were already standing in 1836 and still stand today. APUR
  publishes every Paris building with its construction period and median
  height, measured from aerial surveys. Periods "before 1800" and "1801-1850"
  give us real footprints and real heights.
* Buildings that have since disappeared. No 1836 building footprints exist,
  so we extrude the Vasserot cadastre parcels (1810-1836) that no surviving
  building covers. Courtyards are not separated from buildings and heights are
  estimated, so these are labelled as a reconstruction.

Output: web/public/data/3d/<area>-1836.geojson
"""

from __future__ import annotations

import hashlib
import json
import urllib.parse
from pathlib import Path
from typing import Any, Callable

from rpr import net, paths

AREAS = {
    # Île de la Cité and the quays facing it.
    "cite": {"name": "Île de la Cité", "bbox": (2.3395, 48.8505, 2.3565, 48.8590)},
}

VASSEROT_DRUID = "qr091wq2775"
VASSEROT_STEM = "Vasserots_parcelles2_v"
VASSEROT_EPSG = 27561  # NTF (Paris) / Lambert Nord France, as in the .prj
STACKS = "https://stacks.stanford.edu/file/druid:{druid}/{name}"

APUR_QUERY = "https://carto2.apur.org/apur/rest/services/OPENDATA/EMPRISE_BATIE_PARIS/MapServer/0/query"
APUR_PERIODS = {
    1: "before 1800",
    2: "1801–1850",
    3: "1851–1914",
    5: "1915–1939",
    6: "1940–1967",
    7: "1968–1975",
    8: "1976–1981",
    9: "1982–1989",
    10: "1990–1999",
    11: "2000 and later",
    12: "2008 and later",
    99: "undated",
}
STANDING_IN_1836 = {1, 2}
# First year each APUR period class can appear on the 3D time slider.
PERIOD_FROM = {1: 1700, 2: 1801, 3: 1851, 5: 1915, 6: 1940, 7: 1968, 8: 1976, 9: 1982, 10: 1990, 11: 2000, 12: 2008}
# Most of the medieval Cité was cleared in the 1860s.
DEMOLISHED_BY = 1860

# A parcel counts as still built if surviving buildings cover this share of it.
SURVIVOR_COVERAGE = 0.35
# Typical Cité house in the 1830s: four to six storeys.
EST_HEIGHT = (12.0, 19.0)
MIN_PARCEL_M2 = 12
# Parcels larger than this held courtyards and gardens: build a ring of
# street-facing buildings this deep instead of a solid block.
RING_ABOVE_M2 = 400
RING_DEPTH_M = 9
# Shrink every footprint a little so neighbouring buildings read separately.
INSET_M = 0.3
OPEN_SPACE_CODES = ("2P", "2M")  # Vasserot reliability codes used for squares and markets
OPEN_SPACE_WORDS = ("place", "parvis", "marché", "marche", "champ", "cour ", "jardin", "square", "quai", "pont")


def fix_text(value: object) -> str:
    """The shapefile's names are UTF-8 read as Latin-1."""
    text = str(value or "")
    try:
        return text.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def is_open_space(rec: dict) -> bool:
    code = str(rec.get("CODE_FIAB") or "")
    name = fix_text(rec.get("NOM_CODE2")).lower()
    if code.startswith(OPEN_SPACE_CODES):
        return True
    return bool(name) and not rec.get("NUM_ILOT") and any(w in name + " " for w in OPEN_SPACE_WORDS)


def estimated_height(key: str) -> float:
    """Deterministic pseudo-random height, so the model is stable between runs."""
    h = int(hashlib.sha1(key.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    lo, hi = EST_HEIGHT
    return round(lo + h * (hi - lo), 1)


def download_vasserot(cache: Path, log: Callable[[str], Any]) -> Path:
    cache.mkdir(parents=True, exist_ok=True)
    for ext in ("shp", "shx", "dbf", "prj"):
        dest = cache / f"{VASSEROT_STEM}.{ext}"
        if not dest.exists():
            size = net.download(STACKS.format(druid=VASSEROT_DRUID, name=dest.name), dest, timeout=300)
            log(f"model3d: downloaded {dest.name} ({size / 1e6:.1f} MB)")
    return cache / f"{VASSEROT_STEM}.shp"


def fetch_apur(bbox: tuple[float, float, float, float]) -> list[dict]:
    params = {
        "where": "1=1",
        "geometry": ",".join(str(v) for v in bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "n_sq_eb,c_perconst,an_const,h_med,h_max,c_forme_toit",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": "3000",
    }
    data = net.fetch_json(f"{APUR_QUERY}?{urllib.parse.urlencode(params)}", timeout=120)
    feats = data.get("features", [])
    if len(feats) >= 3000:
        raise RuntimeError("APUR query hit its 3000 record limit; use a smaller area")
    return feats


def build(area: str, log: Callable[[str], Any] = print) -> dict:
    # Imported here so the rest of the pipeline keeps working without these extras.
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import box, mapping, shape
    from shapely.ops import transform, unary_union

    cfg = AREAS[area]
    bbox = cfg["bbox"]
    area_box = box(*bbox)

    # Equal-area metres for coverage maths: Lambert 93.
    to_l93 = Transformer.from_crs(4326, 2154, always_xy=True).transform
    from_vasserot = Transformer.from_crs(VASSEROT_EPSG, 4326, always_xy=True).transform

    # 1. Today's buildings (APUR). Those built before 1851 were standing in 1836.
    survivors, later, survivor_shapes = [], [], []
    for f in fetch_apur(bbox):
        p = f["properties"]
        if not f.get("geometry"):
            continue
        geom = shape(f["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        metric_geom = transform(to_l93, geom)
        inset = metric_geom.buffer(-INSET_M * 0.6, join_style="mitre", mitre_limit=3.0).simplify(0.15, preserve_topology=True)
        if not inset.is_empty:
            geom = transform(Transformer.from_crs(2154, 4326, always_xy=True).transform, inset)
        height = p.get("h_med") or p.get("h_max")
        if not height:
            continue
        period = p.get("c_perconst")
        standing = period in STANDING_IN_1836
        built = p.get("an_const") or None
        start = built or PERIOD_FROM.get(period)
        feature = {
            "type": "Feature",
            "properties": {
                "kind": "standing" if standing else ("later" if start else "undated"),
                "height": round(float(height), 1),
                "height_max": round(float(p.get("h_max") or height), 1),
                "period": APUR_PERIODS.get(period, "unknown"),
                "built": built,
                "from": start if start else 1851,
                "source": "APUR building footprint and median height",
                "id": f"apur:{p.get('n_sq_eb')}",
            },
            "geometry": mapping(geom),
        }
        if standing:
            survivors.append(feature)
            survivor_shapes.append(metric_geom)
        else:
            later.append(feature)
    survivor_union = unary_union(survivor_shapes) if survivor_shapes else None
    log(f"model3d: {len(survivors)} buildings standing in 1836 survive; {len(later)} were built later (APUR)")

    # 2. Vasserot parcels not covered by survivors: reconstructed.
    shp = download_vasserot(paths.REPO_ROOT / "pipeline" / "cache" / "vasserot", log)
    reader = shapefile.Reader(str(shp), encoding="latin-1")
    fields = [f[0] for f in reader.fields[1:]]
    reconstructed, skipped = [], {"covered by a surviving building": 0, "too small": 0, "open space": 0}
    from_l93 = Transformer.from_crs(2154, 4326, always_xy=True).transform
    for sr in reader.iterShapeRecords():
        if sr.shape.shapeType == 0 or not sr.shape.points:
            continue
        x0, y0, x1, y1 = sr.shape.bbox
        lon0, lat0 = from_vasserot(x0, y0)
        lon1, lat1 = from_vasserot(x1, y1)
        if lon1 < bbox[0] or lon0 > bbox[2] or lat1 < bbox[1] or lat0 > bbox[3]:
            continue
        geom = transform(from_vasserot, shape(sr.shape.__geo_interface__))
        if not geom.is_valid:
            geom = geom.buffer(0)
        if not geom.intersects(area_box):
            continue
        metric = transform(to_l93, geom)
        if metric.area < MIN_PARCEL_M2:
            skipped["too small"] += 1
            continue
        if survivor_union is not None and metric.intersection(survivor_union).area / metric.area >= SURVIVOR_COVERAGE:
            skipped["covered by a surviving building"] += 1
            continue
        rec = dict(zip(fields, sr.record))
        if is_open_space(rec):
            skipped["open space"] += 1
            continue
        key = str(rec.get("ID_ALPAGE") or rec.get("IDENTIF") or sr.record.oid)
        footprint = metric.buffer(-INSET_M, join_style="mitre", mitre_limit=3.0)
        ring = False
        if metric.area > RING_ABOVE_M2:
            inner = metric.buffer(-RING_DEPTH_M, join_style="mitre", mitre_limit=3.0)
            if not inner.is_empty and inner.area > 0.15 * metric.area:
                footprint = footprint.difference(inner)
                ring = True
        footprint = footprint.simplify(0.15, preserve_topology=True)
        if footprint.is_empty:
            continue
        geom = transform(from_l93, footprint)
        reconstructed.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "reconstructed",
                    "height": estimated_height(key),
                    "period": "standing in 1836, since demolished",
                    "until": DEMOLISHED_BY,
                    "source": "Vasserot cadastre parcel (1810–1836); height estimated",
                    "id": f"vasserot:{key}",
                    "quartier": rec.get("QUARTIER") or None,
                    "name": fix_text(rec.get("NOM_CODE2")) or None,
                    "ring": ring,
                },
                "geometry": mapping(geom),
            }
        )
    log(f"model3d: {len(reconstructed)} demolished buildings reconstructed from parcels; skipped {skipped}")

    features = survivors + later + reconstructed
    out = paths.DATA_DIR / "3d" / f"{area}-1836.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    coll = {
        "type": "FeatureCollection",
        "metadata": {
            "area": cfg["name"],
            "bbox": bbox,
            "year": 1836,
            "standing": len(survivors),
            "later": len(later),
            "reconstructed": len(reconstructed),
            "notes": "Reconstructed buildings use whole parcels (courtyards included), estimated heights, and disappear in 1860. Later buildings appear from their APUR construction period.",
        },
        "features": features,
    }
    text = json.dumps(coll, ensure_ascii=False, separators=(",", ":"))
    # Trim coordinate precision to about 1 cm.
    import re

    text = re.sub(r"(-?\d+\.\d{7})\d+", r"\1", text)
    out.write_text(text)
    log(f"model3d: wrote {out.relative_to(paths.REPO_ROOT)} ({len(text) / 1e6:.1f} MB)")
    return {
        "file": f"3d/{area}-1836.geojson",
        "area": cfg["name"],
        "standing": len(survivors),
        "later": len(later),
        "reconstructed": len(reconstructed),
        "license": "Vasserot parcels: ODbL (ALPAGE). APUR buildings: ODbL.",
    }

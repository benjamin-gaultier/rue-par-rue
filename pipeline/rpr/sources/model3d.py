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
    # Île de la Cité and the quays facing it. `focus` is the showcase rendered
    # with detailed buildings (facades, roofs) in the app.
    "cite": {
        "name": "Île de la Cité",
        "bbox": (2.3395, 48.8505, 2.3565, 48.8590),
        "focus": (2.3450, 48.8512, 2.3535, 48.8560),
    },
}

# APUR roof codes (c_forme_toit): 1 flat, 2 two-pitch tile, 3 two-pitch small-scale,
# 4 brisis-terrasson (the Paris mansard). Materials (c_toiture_mat): T tile,
# M mineral, V planted, A other (mostly zinc).
ROOF_SHAPES = {1: "flat", 2: "gable", 3: "gable", 4: "mansard"}
ROOF_MATERIALS = {"T": "tile", "M": "mineral", "V": "planted", "A": "zinc"}

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
# A tall, compact building is a tower: flat top, landmark style.
TOWER_M = 40.0
TOWER_MAX_M2 = 600.0

# A parcel counts as still built if surviving buildings cover this share of it.
SURVIVOR_COVERAGE = 0.35
# Typical Cité house in the 1830s: four to six storeys.
EST_HEIGHT = (12.0, 19.0)
MIN_PARCEL_M2 = 12
# Parcels larger than this held courtyards and gardens: build a ring of
# street-facing buildings this deep instead of a solid block.
RING_ABOVE_M2 = 400
RING_DEPTH_M = 9
HOUSE_M = 9.0  # typical frontage and depth of an old Paris house lot
SPLIT_ABOVE_M2 = 160.0
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


def load_traced(area: str, to_metric) -> dict[str, dict]:
    """Traced footprints by parcel id (see rpr.sources.vasserot_plans), cleaned up."""
    from shapely.geometry import Polygon, MultiPolygon, shape
    from shapely.ops import transform

    path = paths.DATA_DIR / "3d" / f"vasserot-traced-{area}.geojson"
    if not path.exists():
        return {}
    out = {}
    for f in json.loads(path.read_text())["features"]:
        g = transform(to_metric, shape(f["geometry"]))
        # Close hairline gaps, drop specks and pinholes left by unwashed patches.
        g = g.buffer(0.4, join_style="mitre").buffer(-0.4, join_style="mitre")
        parts = []
        for p in getattr(g, "geoms", [g]):
            if p.area < 4:
                continue
            holes = [h for h in p.interiors if Polygon(h).area >= 6]
            parts.append(Polygon(p.exterior, holes))
        if not parts:
            continue
        geom = MultiPolygon(parts) if len(parts) > 1 else parts[0]
        prev = out.get(f["properties"]["parcel"])
        if prev and prev["iou"] >= f["properties"]["iou"]:
            continue  # several sheets for one parcel: keep the best fit
        out[f["properties"]["parcel"]] = {
            "geometry": geom.simplify(0.15, preserve_topology=True),
            "address": f["properties"]["address"],
            "plan_url": f["properties"]["url"],
            "iou": f["properties"]["iou"],
        }
    return out


def split_houses(footprint, size: float = HOUSE_M, min_area: float = 8.0) -> list:
    """Cut a metric footprint into lots of about `size` metres along its own axes.

    Footprints under SPLIT_ABOVE_M2 stay whole. Slivers smaller than
    `min_area` join the neighbouring lot they touch most.
    """
    import math

    from shapely import affinity
    from shapely.geometry import Polygon, box

    if footprint.area < SPLIT_ABOVE_M2:
        return [footprint]
    rect = footprint.minimum_rotated_rectangle
    xy = list(rect.exterior.coords)
    edges = [(xy[i], xy[i + 1]) for i in range(4)]
    (ax, ay), (bx, by) = max(edges, key=lambda e: math.dist(*e))
    angle = math.degrees(math.atan2(by - ay, bx - ax))
    c = footprint.centroid
    flat = affinity.rotate(footprint, -angle, origin=c)
    x0, y0, x1, y1 = flat.bounds
    nx = max(1, round((x1 - x0) / size))
    ny = max(1, round((y1 - y0) / size))
    sx, sy = (x1 - x0) / nx, (y1 - y0) / ny
    lots, slivers = [], []
    for i in range(nx):
        for j in range(ny):
            cell = flat.intersection(box(x0 + i * sx, y0 + j * sy, x0 + (i + 1) * sx, y0 + (j + 1) * sy))
            for part in getattr(cell, "geoms", [cell]):
                if isinstance(part, Polygon) and not part.is_empty:
                    (lots if part.area >= min_area else slivers).append(part)
    for s in slivers:
        best = max(range(len(lots)), key=lambda k: lots[k].buffer(0.01).intersection(s).area, default=None)
        if best is not None and lots[best].buffer(0.01).intersects(s):
            merged = lots[best].union(s.buffer(0.01)).buffer(-0.01)
            if merged.geom_type == "Polygon":
                lots[best] = merged
    # Each lot is inset a little so neighbouring houses read apart.
    out = []
    for lot in lots:
        lot = affinity.rotate(lot, angle, origin=c).buffer(-0.1, join_style="mitre").simplify(0.1, preserve_topology=True)
        if lot.geom_type == "Polygon" and lot.area >= min_area:
            out.append(lot)
    return out or [footprint]


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
        "outFields": "n_sq_eb,c_perconst,an_const,h_med,h_max,c_forme_toit,c_toiture_mat,c_tissu",
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
    focus_box = box(*cfg["focus"]) if cfg.get("focus") else None

    # Equal-area metres for coverage maths: Lambert 93.
    to_l93 = Transformer.from_crs(4326, 2154, always_xy=True).transform
    from_vasserot = Transformer.from_crs(VASSEROT_EPSG, 4326, always_xy=True).transform

    # 1. Today's buildings (APUR). Those built before 1851 were standing in 1836.
    survivors, later, survivor_shapes, later_shapes = [], [], [], []
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
                "roof": ROOF_SHAPES.get(p.get("c_forme_toit"), "flat"),
                "roof_material": ROOF_MATERIALS.get(p.get("c_toiture_mat"), "zinc"),
                # Remarkable buildings, and towers (Notre-Dame's are not tagged ER).
                "landmark": p.get("c_tissu") == "ER" or float(height) >= TOWER_M,
                "focus": bool(focus_box is not None and geom.intersects(focus_box)),
            },
            "geometry": mapping(geom),
        }
        if float(height) >= TOWER_M and metric_geom.area < TOWER_MAX_M2:
            feature["properties"]["roof"] = "flat"  # tower tops: terraces behind a balustrade
        if standing:
            survivors.append(feature)
            survivor_shapes.append(metric_geom)
        else:
            later.append(feature)
            later_shapes.append(metric_geom)
    survivor_union = unary_union(survivor_shapes) if survivor_shapes else None
    log(f"model3d: {len(survivors)} buildings standing in 1836 survive; {len(later)} were built later (APUR)")

    # 2. Vasserot parcels not covered by survivors: reconstructed.
    shp = download_vasserot(paths.REPO_ROOT / "pipeline" / "cache" / "vasserot", log)
    reader = shapefile.Reader(str(shp), encoding="latin-1")
    fields = [f[0] for f in reader.fields[1:]]
    reconstructed_shapes: list = []
    reconstructed, skipped = [], {"covered by a surviving building": 0, "too small": 0, "open space": 0}
    traced = load_traced(area, to_l93)
    used_traced = 0
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
        trace = traced.get(key)
        footprint = metric.buffer(-INSET_M, join_style="mitre", mitre_limit=3.0)
        ring = False
        if trace is not None:
            footprint = trace["geometry"].intersection(footprint)
            used_traced += 1
        elif metric.area > RING_ABOVE_M2:
            inner = metric.buffer(-RING_DEPTH_M, join_style="mitre", mitre_limit=3.0)
            if not inner.is_empty and inner.area > 0.15 * metric.area:
                footprint = footprint.difference(inner)
                ring = True
        # Leave room for the surviving buildings that share the parcel.
        if survivor_union is not None:
            footprint = footprint.difference(survivor_union.buffer(INSET_M))
        footprint = footprint.simplify(0.15, preserve_topology=True)
        if footprint.is_empty:
            continue
        # A big parcel held several houses: split it into house-sized lots,
        # each with its own height, so streets do not read as one long wall.
        pieces = [footprint] if trace is not None else split_houses(footprint)
        for n, piece in enumerate(pieces):
            geom = transform(from_l93, piece)
            house = key if len(pieces) == 1 else f"{key}:{n}"
            reconstructed.append(
              {
                  "type": "Feature",
                  "properties": {
                      "kind": "reconstructed",
                      "height": estimated_height(house),
                      "period": "standing in 1836, since demolished",
                      "until": DEMOLISHED_BY,
                      "source": (
                          "Footprint traced from Vasserot's plan of the building; height estimated"
                          if trace is not None
                          else "Vasserot cadastre parcel (1810–1836); height estimated"
                      ),
                      "id": f"vasserot:{house}",
                      "quartier": rec.get("QUARTIER") or None,
                      "name": fix_text(rec.get("NOM_CODE2")) or None,
                      "ring": ring,
                      "traced": trace is not None,
                      # Pre-Haussmann houses: pitched roofs, mostly tile.
                      "roof": "gable",
                      "roof_material": "tile",
                      "landmark": False,
                      "focus": bool(focus_box is not None and geom.intersects(focus_box)),
                      **({k: trace[k] for k in ("address", "plan_url", "iou")} if trace else {}),
                  },
                  "geometry": mapping(geom),
              }
            )
        reconstructed_shapes.append(footprint)
    # A building of 1851-1859 on the site of a house that stands until 1860
    # would overlap it for a few years: start it when the house goes.
    if reconstructed_shapes:
        gone = unary_union(reconstructed_shapes)
        for f, g in zip(later, later_shapes):
            if f["properties"]["from"] < DEMOLISHED_BY and g.area and g.intersection(gone).area / g.area > 0.2:
                f["properties"]["from"] = DEMOLISHED_BY
    log(f"model3d: {len(reconstructed)} demolished buildings reconstructed ({used_traced} with traced footprints); skipped {skipped}")

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
            "traced": used_traced,
            "focus": cfg.get("focus"),
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
        "traced": used_traced,
        "license": "Vasserot parcels: ODbL (ALPAGE). APUR buildings: ODbL.",
    }

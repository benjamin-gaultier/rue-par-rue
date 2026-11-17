"""Trace building footprints from Vasserot's ground-floor plans (1809-1854).

The Archives nationales publish one coloured sheet per building (Licence
Ouverte 2.0, dataset "Plans cadastraux des immeubles de Paris 1809-1856").
Built rooms carry a pink wash, walls are darker, courtyards are left white.

For each sheet we:
  1. find its parcel through the ALPAGE address points (street, number, quarter);
  2. segment the drawing into the whole property and its pink built part;
  3. register the drawing onto the ALPAGE parcel polygon: scale from the
     areas, rotation by search, scored by intersection over union (IoU);
  4. keep the built part, mapped into real coordinates, when the fit is good.

Everything uncertain is recorded on the output so the 3D model can say how
each footprint was obtained.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from rpr import net, paths

DATASET_API = "https://www.data.gouv.fr/api/1/datasets/plans-cadastraux-des-immeubles-de-paris-1809-1856/"
ADDRESS_DRUID = "pn650tp5621"
ADDRESS_STEM = "Num_Voies_Vasserot"
PARCEL_STEM = "Vasserots_parcelles2_v"
STACKS = "https://stacks.stanford.edu/file/druid:{druid}/{name}"
VASSEROT_EPSG = 27561

# Quarters as written in the plans' index and in the ALPAGE layers.
AREA_QUARTERS = {
    "cite": {"plans": ("Cité", "Palais de Justice"), "alpage": ("Cite", "Palais de Justice")},
}

MIN_IOU = 0.72
CACHE = paths.REPO_ROOT / "pipeline" / "cache" / "vasserot"


# ----------------------------------------------------------- addresses

def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def plan_street(adresse: str) -> tuple[str, str] | None:
    """'Paris - Marmousets (rue des) n°17' -> ('rue des marmousets', '17')."""
    m = re.match(r"Paris\s*-\s*(.+?)\s*\((.+?)\)\s*(?:n°\s*([\w\s\-]+))?$", adresse.strip())
    if not m:
        return None
    name, kind, number = m.group(1), m.group(2), (m.group(3) or "").strip()
    number = re.split(r"[\s\-]", number)[0] if number else ""
    return norm(f"{kind} {name}"), number


def address_key(street: str, number: str) -> str:
    return f"{norm(street)}|{number.lower()}"


@dataclass
class Plan:
    id: str
    adresse: str
    quartier: str
    image: str
    url: str
    cote: str
    street: str
    number: str


def load_plans(area: str, log: Callable[[str], Any]) -> list[Plan]:
    meta = net.fetch_json(DATASET_API)
    csv_url = next(r["url"] for r in meta["resources"] if r["format"].lower() == "csv")
    text = net.fetch_bytes(csv_url, timeout=120).decode("utf-8-sig")
    wanted = AREA_QUARTERS[area]["plans"]
    plans = []
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        m = re.search(r"quartier\s*:\s*([^;]+)", r["detail"])
        q = m.group(1).strip() if m else ""
        if q not in wanted:
            continue
        parsed = plan_street(r["adresse"])
        if not parsed or not parsed[1]:
            continue
        plans.append(Plan(r["id"], r["adresse"], q, r["image"], r["url_siv"], r["cote"], parsed[0], parsed[1]))
    log(f"plans: {len(plans)} sheets with a street number in {', '.join(wanted)}")
    return plans


def download_layer(druid: str, stem: str, log: Callable[[str], Any]) -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    for ext in ("shp", "shx", "dbf", "prj"):
        dest = CACHE / f"{stem}.{ext}"
        if not dest.exists():
            net.download(STACKS.format(druid=druid, name=dest.name), dest, timeout=300)
            log(f"plans: downloaded {dest.name}")
    return CACHE / f"{stem}.shp"


# ---------------------------------------------------------- segmentation

def segment(path: Path):
    """Return (property_mask, built_mask, bbox, walls_only) for a sheet, or None.

    Colour is measured against the sheet's own paper (Lab a* and b* minus
    their medians), so yellowed and pale sheets behave alike. Pink wash and
    pink walls are redder than the paper without being yellower.
    """
    import cv2
    import numpy as np

    img = cv2.imread(str(path))
    if img is None:
        return None
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.int16)
    L, A, B = lab[..., 0], lab[..., 1], lab[..., 2]
    da = A - int(np.median(A))
    db = B - int(np.median(B))
    paper_l = int(np.median(L))
    pink = ((da >= 5) & (da - np.maximum(db, 0) // 2 >= 4) & (L > 60)).astype(np.uint8) * 255
    pink = cv2.morphologyEx(pink, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    if int((pink > 0).sum()) < 800:
        return None

    # The drawing is the largest cluster once rooms are merged.
    clusters = cv2.dilate(pink, np.ones((25, 25), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(clusters, 8)
    if n <= 1:
        return None
    weights = [int(((labels == i) & (pink > 0)).sum()) for i in range(1, n)]
    k = 1 + int(np.argmax(weights))
    x, y, w, h = (int(v) for v in stats[k, :4])
    edge = 0.03
    H, W = pink.shape
    if x < edge * W and x + w > (1 - edge) * W:
        return None  # a sheet-wide frame, not a building
    cluster = (labels == k).astype(np.uint8) * 255
    built = cv2.bitwise_and(pink, cluster)
    built = cv2.morphologyEx(built, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))

    # Fill small holes (gaps along walls); keep large ones (courtyards).
    contours, hierarchy = cv2.findContours(built, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    total = float(sum(cv2.contourArea(c) for i, c in enumerate(contours) if hierarchy[0][i][3] == -1))
    for i, c in enumerate(contours):
        if hierarchy[0][i][3] != -1 and cv2.contourArea(c) < 0.015 * total:
            cv2.drawContours(built, [c], -1, 255, thickness=-1)

    # Property: built part plus courtyards closed by dark boundary lines.
    dark = (L < paper_l - 70).astype(np.uint8) * 255
    near = cv2.dilate(cluster, np.ones((15, 15), np.uint8))
    lines = cv2.bitwise_and(dark, near)
    prop = cv2.morphologyEx(cv2.bitwise_or(built, lines), cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    contours, _ = cv2.findContours(prop, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    main = max(contours, key=cv2.contourArea)
    prop_filled = np.zeros_like(prop)
    hull = cv2.convexHull(main)
    if cv2.contourArea(main) < 0.6 * cv2.contourArea(hull):
        # A thin outline: walls drawn around unwashed rooms, often open on the
        # street side. The hull is the property.
        cv2.drawContours(prop_filled, [hull], -1, 255, thickness=-1)
    else:
        cv2.drawContours(prop_filled, [main], -1, 255, thickness=-1)
    built = cv2.bitwise_and(built, prop_filled)

    # Sheets that colour only the walls: the walled area is the building.
    walls_only = (built > 0).sum() < 0.35 * (prop_filled > 0).sum()
    if walls_only:
        built = prop_filled.copy()
    pad = 10
    bbox = (max(0, x - pad), max(0, y - pad), min(W, x + w + pad), min(H, y + h + pad))
    return prop_filled, built, bbox, bool(walls_only)


def mask_polygons(mask, simplify_px: float = 2.0):
    """Polygons (with holes) from a binary mask, in pixel coordinates (y down)."""
    import cv2
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hierarchy is None:
        return None
    polys = []
    for i, c in enumerate(contours):
        if hierarchy[0][i][3] != -1 or len(c) < 3:
            continue  # holes are handled with their parent
        shell = [(float(p[0][0]), float(p[0][1])) for p in c]
        holes = []
        child = hierarchy[0][i][2]
        while child != -1:
            hc = contours[child]
            if len(hc) >= 3:
                holes.append([(float(p[0][0]), float(p[0][1])) for p in hc])
            child = hierarchy[0][child][0]
        poly = Polygon(shell, holes).buffer(0)
        if poly.area > 50:
            polys.append(poly.simplify(simplify_px))
    return unary_union(polys) if polys else None


# ------------------------------------------------------------ registration

@dataclass
class Fit:
    scale: float
    angle: float
    dx: float
    dy: float
    iou: float


def to_math(geom):
    """Image coordinates (y down) to a right-handed plane (y up) without mirroring."""
    from shapely.affinity import scale

    return scale(geom, xfact=1, yfact=-1, origin=(0, 0))


def place(geom, fit: Fit):
    from shapely.affinity import rotate, scale, translate

    g = scale(geom, xfact=fit.scale, yfact=fit.scale, origin=(0, 0))
    g = rotate(g, fit.angle, origin=(0, 0))
    return translate(g, fit.dx, fit.dy)


def register(outline_px, parcel_m) -> Fit | None:
    """Fit a pixel outline onto a metric parcel polygon.

    Scale comes from the ratio of areas. Rotation is searched every 3°, then
    refined to 0.25°. Translation matches centroids. Scored by IoU.
    """
    from shapely.affinity import rotate, scale, translate

    if outline_px is None or outline_px.is_empty or parcel_m.area <= 0:
        return None
    base = to_math(outline_px)
    s = math.sqrt(parcel_m.area / base.area)
    o = scale(base, xfact=s, yfact=s, origin=(0, 0))
    pc = parcel_m.centroid

    def candidate(angle: float) -> tuple[float, float, float]:
        g = rotate(o, angle, origin=(0, 0))
        c = g.centroid
        g = translate(g, pc.x - c.x, pc.y - c.y)
        union = g.union(parcel_m).area
        return (g.intersection(parcel_m).area / union if union else 0.0), pc.x - c.x, pc.y - c.y

    coarse = max((candidate(a)[0], a) for a in range(0, 360, 3))[1]
    best_iou, best_angle, dx, dy = -1.0, coarse, 0.0, 0.0
    for q in range(int((coarse - 3) * 4), int((coarse + 3) * 4) + 1):
        iou, tx, ty = candidate(q / 4)
        if iou > best_iou:
            best_iou, best_angle, dx, dy = iou, q / 4, tx, ty
    return Fit(scale=s, angle=best_angle, dx=dx, dy=dy, iou=round(best_iou, 3))


# ------------------------------------------------------------------ run

def trace(area: str = "cite", log: Callable[[str], Any] = print, limit: int | None = None) -> dict:
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import mapping, shape
    from shapely.ops import transform

    plans = load_plans(area, log)
    if limit:
        plans = plans[:limit]

    to_l93 = Transformer.from_crs(VASSEROT_EPSG, 2154, always_xy=True).transform
    l93_to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform
    alpage_q = AREA_QUARTERS[area]["alpage"]

    # Addresses -> parcel ids.
    addr = shapefile.Reader(str(download_layer(ADDRESS_DRUID, ADDRESS_STEM, log)), encoding="latin-1")
    afields = [f[0] for f in addr.fields[1:]]
    address_index: dict[str, str] = {}
    for rec in addr.iterRecords():
        d = dict(zip(afields, rec))
        if d.get("QUARTIER") not in alpage_q or not str(d.get("NOM_ENTIER") or "").strip():
            continue
        address_index[address_key(str(d["NOM_ENTIER"]), str(d["NUM_VOIES"]))] = str(d["ID_PARC"])

    # Parcel polygons by id (Lambert 93 metres).
    parc = shapefile.Reader(str(download_layer("qr091wq2775", PARCEL_STEM, log)), encoding="latin-1")
    pfields = [f[0] for f in parc.fields[1:]]
    wanted_ids = set(address_index.values())
    parcels = {}
    for sr in parc.iterShapeRecords():
        d = dict(zip(pfields, sr.record))
        pid = str(d.get("ID_ALPAGE") or d.get("NUM_PARC"))  # addresses use ID_ALPAGE
        if pid in wanted_ids:
            g = shape(sr.shape.__geo_interface__)
            parcels[pid] = transform(to_l93, g if g.is_valid else g.buffer(0))

    out_dir = CACHE / "plans"
    out_dir.mkdir(parents=True, exist_ok=True)
    features, stats = [], {"no parcel match": 0, "no drawing found": 0, "poor fit": 0, "traced": 0, "image missing": 0}
    for p in plans:
        pid = address_index.get(address_key(p.street, p.number))
        if not pid or pid not in parcels:
            stats["no parcel match"] += 1
            continue
        img = out_dir / f"{p.id}.jpg"
        if not img.exists():
            try:
                net.download(p.image, img, timeout=120)
            except Exception:
                stats["image missing"] += 1
                continue
        seg = segment(img)
        if seg is None:
            stats["no drawing found"] += 1
            continue
        prop_mask, built_mask, _, walls_only = seg
        outline = mask_polygons(prop_mask, 3.0)
        built = mask_polygons(built_mask, 2.0)
        fit = register(outline, parcels[pid])
        if fit is None or built is None or fit.iou < MIN_IOU:
            stats["poor fit"] += 1
            continue
        footprint = place(to_math(built), fit).intersection(parcels[pid].buffer(0.5))
        if footprint.is_empty:
            stats["poor fit"] += 1
            continue
        stats["traced"] += 1
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "parcel": pid,
                    "plan": p.id,
                    "address": p.adresse.replace("Paris - ", ""),
                    "cote": p.cote,
                    "url": p.url,
                    "iou": fit.iou,
                    "walls_only": walls_only,
                    "built_share": round(footprint.area / parcels[pid].area, 2),
                },
                "geometry": mapping(transform(l93_to_wgs, footprint)),
            }
        )
    out = traced_path(area)
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(
        {
            "type": "FeatureCollection",
            "metadata": {
                "area": area,
                "source": "Archives nationales, Plans cadastraux des immeubles de Paris 1809-1856 (Licence Ouverte 2.0); parcels: ALPAGE (ODbL)",
                "min_iou": MIN_IOU,
                **stats,
            },
            "features": features,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    out.write_text(re.sub(r"(-?\d+\.\d{7})\d+", r"\1", text))
    log(f"plans: {stats}")
    return {"area": area, **stats, "file": str(out.relative_to(paths.DATA_DIR))}


def traced_path(area: str) -> Path:
    return paths.DATA_DIR / "3d" / f"vasserot-traced-{area}.geojson"

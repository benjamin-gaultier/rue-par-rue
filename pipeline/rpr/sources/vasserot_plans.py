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
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Callable

from rpr import net, paths
from rpr.areas import AREAS, area_file

DATASET_API = "https://www.data.gouv.fr/api/1/datasets/plans-cadastraux-des-immeubles-de-paris-1809-1856/"
ADDRESS_DRUID = "pn650tp5621"
ADDRESS_STEM = "Num_Voies_Vasserot"
PARCEL_STEM = "Vasserots_parcelles2_v"
STACKS = "https://stacks.stanford.edu/file/druid:{druid}/{name}"
VASSEROT_EPSG = 27561

MIN_IOU = 0.72
# The ground a sheet's long side covers once fitted. On the Cité, 73 of the 77
# sheets traced from their wash cover 37-92 m (median 67 m). A reading of the
# ink walls that covers more has caught only part of the drawing, scaled up to
# fill the parcel (8240 and 8243, checked by eye, came out at 208 and 134 m).
MAX_INK_SHEET_M = 100.0
CACHE = paths.REPO_ROOT / "pipeline" / "cache" / "vasserot"

# An address point with no street name takes the name of a street still
# called the same today when it lies this close to that street's outline.
# On the place Dauphine, points 2 to 27 lie within 0.1 m; 28 to 31 lie 8 to
# 11 m off, on the stub renamed rue Henri-Robert in 1948, and stay unnamed.
NAME_FROM_OUTLINE_M = 2.0
OUTLINES_URL = (
    "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/denominations-emprises-voies-actuelles/"
    "exports/geojson?select=typo_min,ouverture,denomination,geo_shape&where="
)
OUTLINES_CREDIT = "Ville de Paris, Dénominations des emprises des voies actuelles (ODbL)"

# The plans' index adds a qualifier to some names to tell homonyms apart
# ("Sainte-Anne-en-la-Cité", "Harlay-au-Palais"); the address points do not.
QUALIFIER = re.compile(r" (?:en la cite|au palais)$")
MATCH_ADDRESS = "address"
MATCH_QUALIFIER = "street name without the index's qualifier"
MATCH_SPELLING = "street name spelled differently"
MATCH_OUTLINE = "unnamed address point on today's outline of the street"
MATCH_SECOND = "second address of the house in the plans' index"

# The index corrects some numbers in brackets: "n°22 [en fait : 20]". The
# number written on the sheet is the cadastre's, and the correction is a later
# numbering: see the README for the count on the Cité. The correction is dropped.
CORRECTION = re.compile(r"\[\s*en fait[^\]]*\]", re.I)

STREET_KINDS = "rue|ruelle|quai|place|cour|impasse|passage|pont"

# The sheets are drawn at 1:200: of the 11,200 scale bars the index records,
# 8,400 are within a tenth of "15 cm / 30 m" (most of the others are 1:400).
USUAL_SCALE = 200.0
# A fit is kept when the scale it implies is 0.7 to 1.5 times the sheet's own.
# Because the fit takes its scale from the areas, a drawing of part of a
# parcel is blown up to fill it, and one of two parcels is shrunk to fit one.
# Measured from the paper sizes in the index, 87 of the 93 Cité sheets traced
# before this check came out at 1:152 to 1:284 (median 1:209: the scans keep a
# margin around the paper). The other six were at 1:119, 1:328 and 1:440 to 1:949.
SCALE_RATIO = (0.7, 1.5)
# The best overlap is not always the right way round: a near-square drawing
# overlaps a near-square parcel almost as well when turned. So the walls are
# also compared with the parcel's sides (`turn_between`). A wall counts when it
# runs straight for 2.5 m once kinks under 0.6 m are smoothed away.
TURN_SIMPLIFY_M = 0.6
TURN_MIN_SIDE_M = 2.5
# Of the 114 Cité fits made on overlap alone, half were turned under 2.7° and
# 94 were turned 6° or less. The 20 beyond were looked at one by one: all sat
# visibly askew. Such a fit is turned back (`straighten`), up to 20° either
# way, to the best overlap whose walls are within 3° of the parcel's sides, or
# failing that to the least turned. It is rejected when the overlap falls
# under MIN_IOU before the walls come within 6°.
MAX_TURN = 6.0
GOOD_TURN = 3.0
STRAIGHTEN_WITHIN = 20.0


# ----------------------------------------------------------- addresses

def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def plan_street(adresse: str) -> tuple[str, str] | None:
    """'Paris - Marmousets (rue des) n°17' -> ('rue des marmousets', '17')."""
    m = re.match(r"Paris\s*-\s*(.+?)\s*\((.+?)\)\s*(?:n°\s*([\w\s\-]+))?$", written(adresse))
    if not m:
        return None
    name, kind, number = m.group(1), m.group(2), (m.group(3) or "").strip()
    number = re.split(r"[\s\-]", number)[0] if number else ""
    return norm(f"{kind} {name}"), number


def written(adresse: str) -> str:
    """The address as written on the sheet: 'n°22 [en fait : 20]' -> 'n°22', 'n°4 [BIS]' -> 'n°4 BIS'."""
    return re.sub(r"[\[\]]", "", CORRECTION.sub("", adresse)).strip()


def second_addresses(detail: str) -> list[tuple[str, list[str]]]:
    """Other addresses of the same house in the index's notes, as (street, numbers).

    'quartier : Cité ; et 3 rue des Deux-Ermites ; propriétaire : Aune'
    -> [('rue des deux ermites', ['3'])]. A corner house has a door on each
    street, so a house on a street opened or renumbered after the cadastre
    can still be found by its address on the side street. Notes with no
    number ("et rue Chanoinesse") and corrections ("en fait : 13 quai
    Napoléon") are not addresses to try.
    """
    out = []
    for note in detail.replace("\xa0", " ").split(";"):
        note = re.sub(r"\[.*?\]", "", note).strip()
        m = re.match(rf"et\s+(\d[\w\s]*?),?\s+((?:{STREET_KINDS})\b.+)$", note, re.I)
        if m:
            numbers = plan_numbers("n°" + m.group(1))
            if numbers:
                out.append((norm(m.group(2)), numbers))
    return out


def sheet_long_cm(dimensions: str) -> float | None:
    """'35,7 x 22 cm' -> 35.7: the long side of the paper."""
    sizes = [float(v.replace(",", ".")) for v in re.findall(r"\d+(?:[.,]\d+)?", dimensions)]
    return max(sizes) if sizes else None


def sheet_scale(echelle: str) -> float:
    """The scale a sheet is drawn at, from its scale bar ('14.8 cm / 30 m' -> 203), else 1:200."""
    m = re.match(r"\s*([\d.,]+)\s*cm\s*/\s*([\d.,]+)\s*m\b", echelle or "")
    if not m:
        return USUAL_SCALE
    try:
        cm, metres = (float(v.replace(",", ".")) for v in m.groups())
    except ValueError:
        return USUAL_SCALE
    return metres * 100 / cm if cm > 0 and metres > 0 else USUAL_SCALE


def fitted_scale(sheet_m: float, long_cm: float | None) -> float | None:
    """The scale a fit implies: the ground the sheet's long side covers, over its length on paper."""
    return sheet_m * 100 / long_cm if long_cm else None


def scale_holds(fitted: float | None, drawn: float) -> bool:
    """True when the fitted scale agrees with the sheet's own, or the paper size is unknown."""
    return fitted is None or SCALE_RATIO[0] <= fitted / drawn <= SCALE_RATIO[1]


def address_key(street: str, number: str) -> str:
    return f"{norm(street)}|{number.lower()}"


def plan_numbers(adresse: str) -> list[str]:
    """The house numbers a sheet covers: 'n°6 et 8' -> ['6', '8'], 'n°9 BIS' -> ['9bis']."""
    m = re.search(r"n°\s*(.+)$", written(adresse))
    if not m:
        return []
    return [n + suffix for n, suffix in re.findall(r"(\d+)\s*(bis|ter)?\b", m.group(1).lower())]


def loose(key: str) -> str:
    """A spelling-free form of a street key: Deux-Ermites = Deux-Hermites."""
    from rpr.sources.streetnames import sound

    return " ".join(re.sub(r"^h(?=[aeiouy])", "", w) for w in sound(key).split())


def resolve_street(street: str, known: set[str]) -> tuple[str | None, str]:
    """The address points' name for a sheet's street, and how it was found."""
    key = norm(street)
    if key in known:
        return key, MATCH_ADDRESS
    bare = QUALIFIER.sub("", key)
    if bare in known:
        return bare, MATCH_QUALIFIER
    same = {k for k in known if loose(k) == loose(bare)}
    if len(same) == 1:
        return same.pop(), MATCH_SPELLING
    return None, ""


def match_parcels(street: str, numbers: list[str], index: dict[str, str]) -> list[str] | None:
    """Parcel ids for every number a sheet covers, or None if one is missing.

    A bis or ter house with no point of its own takes the parcel of its plain
    number, as before; the fit then checks the shape.
    """
    pids: list[str] = []
    for n in numbers:
        pid = index.get(address_key(street, n)) or index.get(address_key(street, re.sub(r"(bis|ter)$", "", n)))
        if pid is None:
            return None
        if pid not in pids:
            pids.append(pid)
    return pids or None


def name_unnamed_points(points: list[tuple[str, str, float, float]], outline, max_m: float = NAME_FROM_OUTLINE_M) -> dict[str, str]:
    """Number -> parcel, for the address points with no street name that lie on a street's outline."""
    from shapely.geometry import Point

    out: dict[str, str] = {}
    for number, pid, x, y in points:
        if outline.distance(Point(x, y)) <= max_m:
            out.setdefault(number.lower(), pid)
    return out


def display_name(adresse: str) -> str | None:
    """'Paris - Dauphine (place) n°27' -> 'place Dauphine'."""
    m = re.match(r"Paris\s*-\s*(.+?)\s*\((.+?)\)", adresse.strip())
    if not m:
        return None
    kind = m.group(2).strip()
    return f"{kind}{'' if kind.endswith(chr(39)) else ' '}{m.group(1).strip()}"


def named_by_1836(record: dict) -> bool:
    """False when the City's record dates the street's opening or naming after 1836.

    The rue d'Arcole, named by a decision of 13 February 1837, is not the
    street its 1836 address points belonged to.
    """
    text = f"{record.get('ouverture') or ''} {record.get('denomination') or ''}"
    return all(int(y) <= 1836 for y in re.findall(r"\b(1[5-9]\d\d|20\d\d)\b", text))


def today_outline(name: str, log: Callable[[str], Any]):
    """Today's outline of a street still called `name`, in Vasserot's projection, or None.

    From the City of Paris street outlines (ODbL), cached in today-outlines.json.
    """
    import urllib.parse

    import numpy as np
    import shapely
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import unary_union

    cache = CACHE / "today-outlines.json"
    known = json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    if name not in known:
        word = max(norm(name).split(), key=len)
        feats = net.fetch_json(OUTLINES_URL + urllib.parse.quote(f'search(typo_min, "{word}")'), timeout=120)["features"]
        known[name] = [
            f["geometry"]
            for f in feats
            if norm(f["properties"].get("typo_min") or "") == norm(name) and named_by_1836(f["properties"])
        ]
        CACHE.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(known), encoding="utf-8")
        log(f"plans: today's outline of {name}: {len(known[name])} piece(s)")
    if not known[name]:
        return None
    to_vasserot = Transformer.from_crs(4326, VASSEROT_EPSG, always_xy=True)
    return shapely.transform(
        unary_union([shape(g) for g in known[name]]),
        lambda c: np.column_stack(to_vasserot.transform(c[:, 0], c[:, 1])),
    )


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
    numbers: tuple[str, ...] = ()
    second: tuple[tuple[str, tuple[str, ...]], ...] = ()
    long_cm: float | None = None
    scale: float = USUAL_SCALE


def quarters_of(area: str) -> dict:
    """The area's quarters as written in the plans' index (`plans`) and in the ALPAGE layers (`alpage`)."""
    quarters = AREAS[area].get("vasserot")
    if not quarters:
        raise ValueError(f"no Vasserot quarters for the area {area!r}: name them under 'vasserot' in AREAS (rpr/areas.py)")
    return quarters


def load_plans(area: str, log: Callable[[str], Any]) -> list[Plan]:
    meta = net.fetch_json(DATASET_API)
    csv_url = next(r["url"] for r in meta["resources"] if r["format"].lower() == "csv")
    text = net.fetch_bytes(csv_url, timeout=120).decode("utf-8-sig")
    wanted = quarters_of(area)["plans"]
    plans = []
    for r in csv.DictReader(io.StringIO(text), delimiter=";"):
        m = re.search(r"quartier\s*:\s*([^;]+)", r["detail"])
        q = m.group(1).strip() if m else ""
        if q not in wanted:
            continue
        parsed = plan_street(r["adresse"])
        if not parsed or not parsed[1]:
            continue
        numbers = tuple(plan_numbers(r["adresse"])) or (parsed[1],)
        second = tuple((street, tuple(ns)) for street, ns in second_addresses(r["detail"]))
        long_cm, scale = sheet_long_cm(r.get("dimensions") or ""), sheet_scale(r.get("echelle") or "")
        plans.append(
            Plan(r["id"], r["adresse"], q, r["image"], r["url_siv"], r["cote"], parsed[0], parsed[1], numbers, second, long_cm, scale)
        )
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

INK_SHARE = 0.15
"""A pink cluster inside an ink drawing whose box covers less than this share
of the drawing's box is a stray mark or a single washed room, not the
building: the sheet is read from its walls. (On the Cité the fragments cover
1-14%; the smallest whole washed drawing found inside ink walls covers 16%.)"""

SEGMENT_PINK = "pink wash"
SEGMENT_INK = "ink walls"


def biggest_cluster(mask, grow: int):
    """The cluster of `mask` with the most pixels once marks `grow` px apart are
    joined, as (cluster_mask, (x, y, w, h), pixels), or None."""
    import cv2
    import numpy as np

    n, labels, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(mask, np.ones((grow, grow), np.uint8)), 8)
    if n <= 1:
        return None
    weights = [int(((labels == i) & (mask > 0)).sum()) for i in range(1, n)]
    k = 1 + int(np.argmax(weights))
    return (labels == k).astype(np.uint8) * 255, tuple(int(v) for v in stats[k, :4]), weights[k - 1]


def touches_edge(box, shape, edge: float = 0.03) -> bool:
    """True for a cluster that runs into the sheet's margin: a strip of the
    scanner's background or a frame, not a drawing."""
    x, y, w, h = box
    H, W = shape[:2]
    return x < edge * W or y < edge * H or x + w > (1 - edge) * W or y + h > (1 - edge) * H


def box_share(inner, outer) -> float:
    """The share of box `outer` that box `inner` covers (boxes as x, y, w, h)."""
    x0, y0 = max(inner[0], outer[0]), max(inner[1], outer[1])
    x1, y1 = min(inner[0] + inner[2], outer[0] + outer[2]), min(inner[1] + inner[3], outer[1] + outer[3])
    return max(0, x1 - x0) * max(0, y1 - y0) / float(outer[2] * outer[3])


def ink_walls(L, paper_l: int):
    """Thick dark strokes away from the margins: the walls of a drawing in ink.

    Handwriting and thin lines are narrower than the 5 px opening and go.
    """
    import cv2
    import numpy as np

    dark = (L < paper_l - 60).astype(np.uint8) * 255
    H, W = dark.shape
    m = int(0.02 * max(H, W))
    dark[:m], dark[-m:], dark[:, :m], dark[:, -m:] = 0, 0, 0, 0
    return cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))


def walled_area(walls):
    """The area a wall drawing encloses: walls closed over door gaps, filled;
    the convex hull when the closed walls still leave it open."""
    import cv2
    import numpy as np

    closed = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, np.ones((31, 31), np.uint8))
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    main = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(main)
    filled = np.zeros_like(walls)
    cv2.drawContours(filled, [hull if cv2.contourArea(main) < 0.6 * cv2.contourArea(hull) else main], -1, 255, thickness=-1)
    return filled


def segment(path: Path):
    """Return (property_mask, built_mask, bbox, walls_only, how) for a sheet, or None.

    Colour is measured against the sheet's own paper (Lab a* and b* minus
    their medians), so yellowed and pale sheets behave alike. Pink wash and
    pink walls are redder than the paper without being yellower.

    Some sheets have no wash: the walls are drawn in ink only. When the pink
    found is missing, runs into the margin, or is a small fragment inside the
    ink drawing (INK_SHARE), the walled area is the building (`how` is
    SEGMENT_INK and `walls_only` is True).
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

    # The drawing is the largest cluster once rooms are merged.
    found = biggest_cluster(pink, 25) if int((pink > 0).sum()) >= 800 else None
    H, W = pink.shape
    # A frame or a strip of the scanner's background is not a building.
    if found is not None and touches_edge(found[1], pink.shape):
        found = None
    walls = ink_walls(L, paper_l)
    ink = biggest_cluster(walls, 25)
    if ink is not None and not touches_edge(ink[1], pink.shape):
        enclosed = walled_area(cv2.bitwise_and(walls, ink[0]))
        if enclosed is not None and (
            found is None or 0 < box_share(found[1], ink[1]) < INK_SHARE
        ):
            x, y, w, h = ink[1]
            pad = 10
            bbox = (max(0, x - pad), max(0, y - pad), min(W, x + w + pad), min(H, y + h + pad))
            return enclosed, enclosed.copy(), bbox, True, SEGMENT_INK
    if found is None:
        return None
    cluster, (x, y, w, h), _ = found
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
    return prop_filled, built, bbox, bool(walls_only), SEGMENT_PINK


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
    turn: float | None = None
    """Degrees between the placed walls and the parcel's sides (`turn_between`)."""
    turned_back: float = 0.0
    """Degrees `straighten` turned the fit away from the best overlap."""


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


def sides(geom, simplify_m: float, min_m: float) -> list[tuple[float, float, float, float, float]]:
    """The straight sides of a polygon's outer ring, at least `min_m` long, once
    kinks under `simplify_m` are smoothed away: (x0, y0, x1, y1, length)."""
    polys = getattr(geom, "geoms", [geom])
    out = []
    for poly in polys:
        if poly.geom_type != "Polygon" or poly.is_empty:
            continue
        ring = list(poly.simplify(simplify_m).exterior.coords)
        for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
            length = math.hypot(x1 - x0, y1 - y0)
            if length >= min_m:
                out.append((x0, y0, x1, y1, length))
    return out


def turn_between(placed, parcel_m, simplify_m: float = TURN_SIMPLIFY_M, min_m: float = TURN_MIN_SIDE_M) -> float | None:
    """How far, in degrees, the sides of a placed outline are turned from the
    sides of the parcel they run along.

    Each side of the outline is compared with the parcel side nearest to its
    middle. The answer is the median of those angles, each side counting for its
    length: 0 when the walls run along the parcel's sides, up to 90. None when
    either shape has no side long enough to compare.
    """
    from shapely.geometry import LineString, Point

    theirs = [(LineString([(a, b), (c, d)]), math.atan2(d - b, c - a)) for a, b, c, d, _ in sides(parcel_m, simplify_m, min_m)]
    ours = sides(placed, simplify_m, min_m)
    if not theirs or not ours:
        return None
    turns = []
    for x0, y0, x1, y1, length in ours:
        mid = Point((x0 + x1) / 2, (y0 + y1) / 2)
        _, bearing = min(theirs, key=lambda t: t[0].distance(mid))
        d = abs(math.degrees(math.atan2(y1 - y0, x1 - x0) - bearing)) % 180
        turns.append((min(d, 180 - d), length))
    turns.sort()
    half, run = sum(w for _, w in turns) / 2, 0.0
    for d, w in turns:
        run += w
        if run >= half:
            return round(d, 1)
    return None


def straighten(outline_px, parcel_m, fit: Fit) -> Fit | None:
    """Check a fit's walls against the parcel's sides, and turn it back if askew.

    A fit turned MAX_TURN or less is returned as it is, with its turn. Beyond,
    the angles within STRAIGHTEN_WITHIN of it are tried every half degree,
    keeping those that still overlap the parcel by MIN_IOU: the best overlap
    among those within GOOD_TURN of the parcel's sides, or else the least
    turned. None when even that one is turned more than MAX_TURN: the drawing
    and the parcel disagree.
    """
    from shapely.affinity import rotate, scale, translate

    o = scale(to_math(outline_px), xfact=fit.scale, yfact=fit.scale, origin=(0, 0))
    pc = parcel_m.centroid

    def at(angle: float):
        g = rotate(o, angle, origin=(0, 0))
        c = g.centroid
        dx, dy = pc.x - c.x, pc.y - c.y
        g = translate(g, dx, dy)
        union = g.union(parcel_m).area
        return g, (g.intersection(parcel_m).area / union if union else 0.0), dx, dy

    turn = turn_between(at(fit.angle)[0], parcel_m)
    if turn is None or turn <= MAX_TURN:
        return replace(fit, turn=turn)
    tried = []
    steps = int(STRAIGHTEN_WITHIN * 2)
    for q in range(-steps, steps + 1):
        g, iou, dx, dy = at(fit.angle + q / 2)
        t = turn_between(g, parcel_m) if iou >= MIN_IOU else None
        if t is not None:
            tried.append((t, iou, q / 2, dx, dy))
    good = [c for c in tried if c[0] <= GOOD_TURN]
    best = max(good, key=lambda c: c[1]) if good else min(tried, key=lambda c: (c[0], -c[1]), default=None)
    if best is None or best[0] > MAX_TURN:
        return None
    t, iou, by, dx, dy = best
    return Fit(scale=fit.scale, angle=(fit.angle + by) % 360, dx=dx, dy=dy, iou=round(iou, 3), turn=t, turned_back=by)


# ------------------------------------------------------------------ run

def trace(area: str = "cite", log: Callable[[str], Any] = print, limit: int | None = None) -> dict:
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import mapping, shape
    from shapely.ops import transform, unary_union

    plans = load_plans(area, log)
    if limit:
        plans = plans[:limit]

    to_l93 = Transformer.from_crs(VASSEROT_EPSG, 2154, always_xy=True).transform
    l93_to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform
    alpage_q = quarters_of(area)["alpage"]

    # Addresses -> parcel ids.
    addr = shapefile.Reader(str(download_layer(ADDRESS_DRUID, ADDRESS_STEM, log)), encoding="latin-1")
    afields = [f[0] for f in addr.fields[1:]]
    address_index: dict[str, str] = {}
    unnamed: list[tuple[str, str, float, float]] = []
    for sr in addr.iterShapeRecords():
        d = dict(zip(afields, sr.record))
        if d.get("QUARTIER") not in alpage_q:
            continue
        if not str(d.get("NOM_ENTIER") or "").strip():
            x, y = sr.shape.points[0]
            unnamed.append((str(d["NUM_VOIES"]), str(d["ID_PARC"]), x, y))
            continue
        address_index[address_key(str(d["NOM_ENTIER"]), str(d["NUM_VOIES"]))] = str(d["ID_PARC"])
    named_streets = {k.split("|")[0] for k in address_index}

    # Each sheet -> its parcels, and how they were found.
    matches: dict[str, tuple[list[str], str]] = {}
    for p in plans:
        street, how = resolve_street(p.street, named_streets)
        if street is None:
            # No point carries the name: try the unnamed points that lie on
            # the outline of a street still called the same today.
            name = display_name(p.adresse)
            outline = today_outline(name, log) if name else None
            if outline is not None:
                street, how = norm(name), MATCH_OUTLINE
                for number, pid in name_unnamed_points(unnamed, outline).items():
                    address_index.setdefault(address_key(street, number), pid)
        pids = match_parcels(street, list(p.numbers), address_index) if street else None
        if not pids:
            # A street opened or renumbered after the cadastre was drawn, or a
            # number it lacks: try the house's other address.
            for other, numbers in p.second:
                other_street, _ = resolve_street(other, named_streets)
                pids = match_parcels(other_street, list(numbers), address_index) if other_street else None
                if pids:
                    how = MATCH_SECOND
                    break
        if pids:
            matches[p.id] = (pids, how)

    # Parcel polygons by id (Lambert 93 metres).
    parc = shapefile.Reader(str(download_layer("qr091wq2775", PARCEL_STEM, log)), encoding="latin-1")
    pfields = [f[0] for f in parc.fields[1:]]
    wanted_ids = {pid for pids, _ in matches.values() for pid in pids}
    parcels = {}
    for sr in parc.iterShapeRecords():
        d = dict(zip(pfields, sr.record))
        pid = str(d.get("ID_ALPAGE") or d.get("NUM_PARC"))  # addresses use ID_ALPAGE
        if pid in wanted_ids:
            g = shape(sr.shape.__geo_interface__)
            parcels[pid] = transform(to_l93, g if g.is_valid else g.buffer(0))

    out_dir = CACHE / "plans"
    out_dir.mkdir(parents=True, exist_ok=True)
    features, stats = [], {"no parcel match": 0, "no drawing found": 0, "poor fit": 0, "traced": 0, "image missing": 0, "wrong scale": 0, "turned": 0, "turned back": 0}
    for p in plans:
        if p.id not in matches or any(pid not in parcels for pid in matches[p.id][0]):
            stats["no parcel match"] += 1
            continue
        pids, how = matches[p.id]
        pid = "+".join(pids)
        if len(pids) > 1:  # one sheet for two houses ("n°6 et 8"): fit it to both parcels
            parcels[pid] = unary_union([parcels[i] for i in pids]).buffer(0.05).buffer(-0.05)
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
        prop_mask, built_mask, _, walls_only, drawing = seg
        outline = mask_polygons(prop_mask, 3.0)
        built = mask_polygons(built_mask, 2.0)
        fit = register(outline, parcels[pid])
        if fit is None or built is None or fit.iou < MIN_IOU:
            stats["poor fit"] += 1
            continue
        sheet_m = fit.scale * max(prop_mask.shape[:2])
        if drawing == SEGMENT_INK and sheet_m > MAX_INK_SHEET_M:
            stats["poor fit"] += 1
            continue
        scale = fitted_scale(sheet_m, p.long_cm)
        if not scale_holds(scale, p.scale):
            stats["poor fit"] += 1
            stats["wrong scale"] += 1
            continue
        fit = straighten(outline, parcels[pid], fit)
        if fit is None:
            stats["poor fit"] += 1
            stats["turned"] += 1
            continue
        if fit.turned_back:
            stats["turned back"] += 1
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
                    "match": how,
                    "walls_only": walls_only,
                    "drawing": drawing,
                    "sheet_m": round(sheet_m),
                    "scale": round(scale) if scale else None,
                    "turn": fit.turn,
                    "turned_back": fit.turned_back or None,
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
    out.write_text(re.sub(r"(-?\d+\.\d{7})\d+", r"\1", text), encoding="utf-8")
    log(f"plans: {stats}")
    return {"area": area, **stats, "file": out.relative_to(paths.DATA_DIR).as_posix()}


def traced_path(area: str) -> Path:
    return area_file(area, "traced")

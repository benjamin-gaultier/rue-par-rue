"""Gardens and trees for the detailed 3D area.

Trees: the City of Paris tree register ("Les arbres", Paris Data, ODbL):
every street and garden tree with its species, height and girth, but no
planting date. Gardens: the outlines of public green spaces in APUR's
facility footprints (EQUIPEMENT_EMPRISE, category 151), which carry no
date either.

Dates are therefore reasoned, and stated as such:
- a garden opens in the year history gives it (GARDENS below), or, when
  no source was found, is shown from UNKNOWN_GARDEN_YEAR and flagged;
- a tree in a garden is planted when the garden opens;
- a street tree is planted with the Second Empire's tree-lined quays and
  boulevards, from STREET_TREES_FROM;
- no tree grows inside a building standing that year: a tree on the site of
  a demolished house is planted after the demolition, and trees that fall
  inside today's buildings or in the river (mismatched positions) are left out.
"""

from __future__ import annotations

import hashlib
import json
import urllib.parse
from typing import Any, Callable

from rpr import net, paths
from rpr.areas import area_file, manifest_file

TREES = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres/exports/json"
APUR_FACILITIES = "https://carto2.apur.org/apur/rest/services/OPENDATA/EQUIPEMENT_EMPRISE/MapServer/0/query"
GREEN_SPACES = 151  # APUR c_niv2: parks, gardens and squares

STREET_TREES_FROM = 1855
UNKNOWN_GARDEN_YEAR = 1950
# APUR facility id -> (name, year opened, note). Years from the City of
# Paris history panels and pages (paris.fr, "Histoire de Paris" signs).
GARDENS: dict[int, tuple[str, int, str]] = {
    750000209: ("Square Jean-XXIII", 1844, "Laid out 1844-1848 on the site of the archbishop's palace, sacked in 1831"),
    750000215: ("Jardin de l'église Notre-Dame", 1844, "Part of the same works as the square Jean-XXIII"),
    750000210: ("Square de l'Île-de-France", 1914, "On the site of the Morgue, which moved out in 1914"),
    750000318: ("Square René-Viviani", 1928, "Opened in 1928 beside Saint-Julien-le-Pauvre"),
    750003452: ("Square du Port de l'Hôtel de Ville", 1933, "Laid out on the port in 1933; renamed Federico-García-Lorca in 2013"),
    750003829: ("Jardin de l'Hôtel de Ville", 1848, "The prefect's garden, which survived the fire of 1871"),
    750000312: ("Jardin du cloître Saint-Séverin", 1700, "The church's old charnel-house cloister"),
    750000207: ("Jardin du parvis Notre-Dame", 1970, "Planted when the parvis was replanned, about 1970"),
    # Added with the whole island (searches of November 2026).
    750006626: ("Square du Vert-Galant", 1884, "The island's tip became a municipal garden in 1884 (paris.fr)"),
    750000199: (
        "Square de la Tour Saint-Jacques",
        1856,
        "The first Haussmannian square, laid out by Alphand and opened in 1856 (paris.fr, napoleon.org)",
    ),
}

# Tree groups the app draws differently, by genus.
GROUPS = {
    "Platanus": 0,
    "Aesculus": 1,
    "Populus": 2,
    "Tilia": 3,
}
SMALL = {"Prunus", "Malus", "Magnolia", "Arbutus", "Olea", "Cydonia", "Crataegus", "Hippophae", "Ligustrum", "Cercis", "Pyrus", "Ficus", "Laurus"}
CONIFERS = {"Pinus", "Taxus", "Cedrus", "Picea", "Abies", "Cupressus", "Sequoia", "Metasequoia", "Ginkgo", "Thuja", "Juniperus"}
DEFAULT_HEIGHT = {0: 20.0, 1: 15.0, 2: 22.0, 3: 15.0, 4: 12.0, 5: 6.0, 6: 14.0}


def group_of(genus: str | None) -> int:
    g = (genus or "").strip().capitalize()
    if g in GROUPS:
        return GROUPS[g]
    if g in SMALL:
        return 5
    if g in CONIFERS:
        return 6
    return 4


def tree_height(raw: Any, group: int) -> float:
    """The register's height when plausible, else a typical height for the group."""
    try:
        h = float(raw)
    except (TypeError, ValueError):
        h = 0.0
    if not 2.0 <= h <= 40.0:
        h = DEFAULT_HEIGHT[group]
    return round(h, 1)


def jitter(key: str, span: int) -> int:
    """0..span-1, stable per tree: plantings spread over a few seasons."""
    return int(hashlib.sha1(key.encode()).hexdigest()[:6], 16) % max(span, 1)


def fetch_trees(bbox: tuple[float, float, float, float]) -> list[dict]:
    x0, y0, x1, y1 = bbox
    query = {
        "where": f"in_bbox(geo_point_2d, {y0}, {x0}, {y1}, {x1})",
        "select": "idbase,libellefrancais,genre,espece,hauteurenm,circonferenceencm,domanialite,remarquable,geo_point_2d",
    }
    return net.fetch_json(f"{TREES}?{urllib.parse.urlencode(query)}", timeout=120, retries=8)


def fetch_gardens(bbox: tuple[float, float, float, float]) -> list[dict]:
    query = {
        "where": f"c_niv2={GREEN_SPACES}",
        "geometry": ",".join(str(v) for v in bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "n_sq_ee,l_ee_min",
        "outSR": "4326",
        "f": "geojson",
    }
    return net.fetch_json(f"{APUR_FACILITIES}?{urllib.parse.urlencode(query)}", timeout=120).get("features", [])


def palace_gardens(area: str, water: list) -> list[dict]:
    """The palace parcel outside the palace's buildings and courts, until the sack of 1831."""
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union

    from rpr.sources.institutions import INSTITUTIONS, load_parcels

    path = area_file(area, "institutions")
    if not path.exists():
        return []
    cfg = INSTITUTIONS["archeveche"]
    built = [shape(f["geometry"]) for f in json.loads(path.read_text())["features"] if f["properties"]["institution"] == "archeveche" and not f["properties"].get("ruin")]
    parcels = load_parcels(set(cfg["parcels"]))
    if not built or not parcels:
        return []
    parcel = unary_union(list(parcels.values()))
    rest = parcel.difference(unary_union(built).convex_hull.buffer(0.00002)).difference(unary_union(water))
    pieces = [p for p in getattr(rest, "geoms", [rest]) if p.geom_type == "Polygon" and p.area * 111320 * 0.658 * 110574 > 200]
    return [
        {
            "type": "Feature",
            "properties": {
                "kind": "garden",
                "id": f"archeveche-garden:{i}",
                "name": "Jardins de l'Archevêché",
                "from": -10000,
                "until": cfg["ruin_from"],
                "dated": True,
                "note": "The archbishop's terraced gardens (Verniquet's atlas), lost with the palace in February 1831",
            },
            "geometry": mapping(p),
        }
        for i, p in enumerate(pieces)
    ]


def build(area: str = "cite", log: Callable[[str], Any] = print) -> dict:
    from shapely.geometry import Point, box, mapping, shape
    from shapely.strtree import STRtree

    site = json.loads((area_file(area, "site")).read_text())
    model = json.loads((area_file(area, "model")).read_text())
    ground_box = tuple(site["metadata"]["ground_box"])
    water = [shape(f["geometry"]) for f in site["features"] if f["properties"]["kind"] == "water"]
    bridges = [shape(f["geometry"]) for f in site["features"] if f["properties"]["kind"] == "bridge"]

    # Gardens, dated.
    gardens, garden_shapes = [], []
    for f in fetch_gardens(ground_box):
        if not f.get("geometry"):
            continue
        g = shape(f["geometry"]).buffer(0)
        fid = int(f["properties"].get("n_sq_ee") or 0)
        name, year, note = GARDENS.get(fid, (str(f["properties"].get("l_ee_min") or "Garden"), UNKNOWN_GARDEN_YEAR, ""))
        dated = fid in GARDENS
        gardens.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "garden",
                    "id": f"apur:{fid}",
                    "name": name,
                    "from": year,
                    "dated": dated,
                    "note": note or f"Opening date not found; shown from {UNKNOWN_GARDEN_YEAR}",
                },
                "geometry": mapping(g),
            }
        )
        garden_shapes.append((g, year))

    # The archbishop's gardens, terraced along the river: Verniquet draws
    # their parterres. They went with the palace in February 1831.
    gardens += palace_gardens(area, water)

    # Buildings, to keep trees out of them.
    buildings = []
    for f in model["features"]:
        p = f["properties"]
        if p["kind"] == "reconstructed":
            life = (-1e4, p.get("until", 1860))
        elif p["kind"] == "standing":
            life = (-1e4, 1e4)
        else:
            life = (p.get("from", 1851), 1e4)
        buildings.append((shape(f["geometry"]), life))
    tree_index = STRtree([b[0] for b in buildings])

    rows, skipped = [], {"outside the area": 0, "inside a building today": 0, "in the river": 0}
    area_box = box(*ground_box)
    for t in fetch_trees(ground_box):
        pt = t.get("geo_point_2d") or {}
        if "lon" not in pt:
            continue
        p = Point(pt["lon"], pt["lat"])
        if not area_box.contains(p):
            skipped["outside the area"] += 1
            continue
        if any(w.contains(p) for w in water) and not any(b.contains(p) for b in bridges):
            skipped["in the river"] += 1
            continue
        key = str(t.get("idbase"))
        garden_year = next((year for g, year in garden_shapes if g.contains(p)), None)
        planted = (garden_year if garden_year is not None else STREET_TREES_FROM) + jitter(key, 4)
        blocked = False
        for i in tree_index.query(p):
            geom, (start, end) = buildings[i]
            if not geom.contains(p):
                continue
            if end >= 1e4:
                blocked = True  # a building that stands today covers the tree: positions disagree
                break
            planted = max(planted, int(end) + 1 + jitter(key, 3))
        if blocked:
            skipped["inside a building today"] += 1
            continue
        group = group_of(t.get("genre"))
        girth = t.get("circonferenceencm") or 0
        rows.append(
            [
                round(pt["lon"], 6),
                round(pt["lat"], 6),
                tree_height(t.get("hauteurenm"), group),
                group,
                planted,
                int(girth) if isinstance(girth, (int, float)) and 0 < girth < 800 else 0,
                1 if garden_year is not None else 0,
            ]
        )
    rows.sort()
    out = area_file(area, "greenery")
    out.write_text(
        json.dumps(
            {
                "metadata": {
                    "trees_source": "Ville de Paris, Les arbres (Paris Data, ODbL)",
                    "gardens_source": "APUR, EQUIPEMENT_EMPRISE (ODbL)",
                    "street_trees_from": STREET_TREES_FROM,
                    "notes": "Planting years are reasoned: trees in a garden from its opening, street trees from the Second Empire, never inside a building standing that year.",
                },
                "gardens": {"type": "FeatureCollection", "features": gardens},
                "trees": {"fields": ["lon", "lat", "height_m", "group", "planted", "girth_cm", "in_garden"], "rows": rows},
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    log(f"greenery: {len(gardens)} gardens ({sum(g['properties']['dated'] for g in gardens)} dated), {len(rows)} trees; skipped {skipped} -> {out.relative_to(paths.REPO_ROOT)}")
    return {"area": area, "file": manifest_file(area, "greenery"), "gardens": len(gardens), "trees": len(rows)}

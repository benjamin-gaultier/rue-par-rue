"""The ground of the detailed focus area: the Seine, its bridges, and a few
hand-placed landmark details. From IGN BD TOPO, plus notes from history.

The river polygon carries the water level (27 m around the Cité; the streets
are near 34 m), which the app uses to sink the river between quay walls. The
bridges are today's decks: the 1836 bridges stood on the same lines (Pont
Saint-Michel, Petit-Pont, Pont au Double, Pont Notre-Dame...), most were
rebuilt later in the century.
"""

from __future__ import annotations

import json
import urllib.parse
from typing import Any, Callable

from rpr import net, paths
from rpr.sources.model3d import AREAS

WFS = "https://data.geopf.fr/wfs/ows"

# Details no dataset holds. Notre-Dame's crossing was located from the
# footprints (middle of the widest slice across the nave axis). The medieval
# spire was taken down in 1786; Viollet-le-Duc's spire (96 m) went up in
# 1859-1860, burned in April 2019 and was rebuilt in 2024.
LANDMARKS = {
    "cite": [
        {
            "kind": "spire",
            "name": "Spire of Notre-Dame",
            "at": (2.34988, 48.85300),
            "base_m": 43.0,
            "height_m": 96.0,
            "from": 1860,
            "gap": (2019, 2024),
        },
        {
            # The cathedral's parts in APUR (towers, nave, aisles, chevet,
            # sacristy). The app draws its west front: portals, gallery of
            # kings, rose window, the great gallery and the belfries.
            "kind": "cathedral",
            "name": "Notre-Dame de Paris",
            "at": (2.34988, 48.85300),
            "axis_bearing": 114.85,
            "ids": [
                "apur:750117318",
                "apur:750040572",
                "apur:750072927",
                "apur:750078376",
                "apur:750016410",
                "apur:750090672",
            ],
        },
    ]
}


PAGE = 500
# Names as they read on a map, and as the bridges were called before renamings.
BRIDGE_NAMES = {
    "PETIT PONT CARDINAL LUSTIGER": "Petit-Pont",
    "PONT DE L'ARCHEVECHE": "Pont de l’Archevêché",
}


def bridge_name(raw: str) -> str:
    if raw.upper() in BRIDGE_NAMES:
        return BRIDGE_NAMES[raw.upper()]
    small = {"AU", "DE", "LA", "DU", "DES", "LE"}
    words = []
    for i, w in enumerate(raw.upper().replace("'", "’").split()):
        if "’" in w:
            head, tail = w.split("’", 1)
            words.append(head.lower() + "’" + tail.capitalize())
        else:
            words.append(w.lower() if i and w in small else "-".join(x.capitalize() for x in w.split("-")))
    return " ".join(words)
SIDEWALKS_M = 8.0  # both pavements together; BD TOPO gives the carriageway width only


def wfs(typename: str, bbox: tuple[float, float, float, float]) -> list[dict]:
    x0, y0, x1, y1 = bbox
    out: list[dict] = []
    while True:
        params = {
            "SERVICE": "WFS",
            "VERSION": "2.0.0",
            "REQUEST": "GetFeature",
            "TYPENAMES": typename,
            "BBOX": f"{y0},{x0},{y1},{x1},urn:ogc:def:crs:EPSG::4326",  # lat,lon order for this CRS
            "OUTPUTFORMAT": "application/json",
            "COUNT": str(PAGE),
            "STARTINDEX": str(len(out)),
        }
        page = net.fetch_json(f"{WFS}?{urllib.parse.urlencode(params)}", timeout=120).get("features", [])
        out += page
        if len(page) < PAGE:
            return out


def bridge_decks(roads: list[dict], water, to_metric, to_wgs) -> list[tuple[str, Any]]:
    """Bridge decks from the road segments BD TOPO marks as above ground.

    Each bridge's segments give its line and carriageway width; the line is
    extended across the river (some segments span only part of it) and cut
    to the water plus a few metres onto each quay.
    """
    import math

    from shapely.geometry import LineString, MultiPoint
    from shapely.ops import transform

    river = transform(to_metric, water)
    named: dict[str, list] = {}
    widths: dict[str, float] = {}
    for f in roads:
        p = f["properties"]
        name = p.get("cpx_toponyme_route_nommee") or p.get("nom_collaboratif_gauche") or ""
        if str(p.get("position_par_rapport_au_sol")) != "1" or "PONT" not in name.upper():
            continue
        line = transform(to_metric, LineString([c[:2] for c in f["geometry"]["coordinates"]]))
        named.setdefault(name, []).append(line)
        widths[name] = max(widths.get(name, 0.0), float(p.get("largeur_de_chaussee") or 6.0))
    decks = []
    for name, lines in named.items():
        pts = MultiPoint([c for ln in lines for c in ln.coords])
        a, b = max(((p, q) for p in pts.geoms for q in pts.geoms), key=lambda pq: pq[0].distance(pq[1]))
        length = a.distance(b)
        if length < 3:
            continue
        ux, uy = (b.x - a.x) / length, (b.y - a.y) / length
        c = pts.centroid
        axis = LineString([(c.x - ux * 400, c.y - uy * 400), (c.x + ux * 400, c.y + uy * 400)])
        crossing = axis.intersection(river.buffer(4))
        parts = [crossing] if crossing.geom_type == "LineString" else list(getattr(crossing, "geoms", []))
        parts = [p for p in parts if p.length > 5]
        if not parts:
            continue
        span = min(parts, key=lambda p: p.distance(c))
        width = widths[name] * 1.2 + SIDEWALKS_M
        deck = span.buffer(width / 2, cap_style="flat")
        if math.isfinite(deck.area) and deck.area > 0:
            decks.append((bridge_name(name), transform(to_wgs, deck)))
    return decks


def flat(geometry: dict) -> dict:
    """Drop the z of BD TOPO coordinates."""

    def strip(c):
        return [strip(x) for x in c] if isinstance(c[0], list) else c[:2]

    return {"type": geometry["type"], "coordinates": strip(geometry["coordinates"])}


def zs(geometry: dict) -> list[float]:
    out: list[float] = []

    def walk(c):
        if isinstance(c[0], list):
            for x in c:
                walk(x)
        elif len(c) > 2:
            out.append(c[2])

    walk(geometry["coordinates"])
    return out


GROUND_MARGIN = (0.0012, 0.0008)  # degrees, about 90 m
STREET_LEVEL_M = 34.0


def ground_features(water, ground_box) -> list[dict]:
    """The river inside the ground box, the dry ground around it, and the
    quay edges between them (each line runs with the water on its right)."""
    from shapely.geometry import LineString, Point, mapping
    from shapely.ops import linemerge

    river = water.intersection(ground_box)
    ground = ground_box.difference(water)
    out = [
        {"type": "Feature", "properties": {"kind": "water", "name": "Seine"}, "geometry": mapping(river)},
        {"type": "Feature", "properties": {"kind": "ground"}, "geometry": mapping(ground)},
    ]
    edge = water.boundary.intersection(ground_box.buffer(-0.00001))
    merged = linemerge(edge) if edge.geom_type == "MultiLineString" else edge
    lines = [merged] if merged.geom_type == "LineString" else list(getattr(merged, "geoms", []))
    for line in lines:
        if line.geom_type != "LineString" or line.length < 1e-5:
            continue
        coords = list(line.coords)
        (ax, ay), (bx, by) = coords[0], coords[1]
        # Is the water to the right of the first segment?
        dx, dy = bx - ax, by - ay
        n = (dx * dx + dy * dy) ** 0.5 or 1
        probe = Point((ax + bx) / 2 + dy / n * 2e-5, (ay + by) / 2 - dx / n * 2e-5)
        if not water.contains(probe):
            coords.reverse()
        out.append({"type": "Feature", "properties": {"kind": "quay"}, "geometry": mapping(LineString(coords))})
    return out


def build(area: str = "cite", log: Callable[[str], Any] = print) -> dict:
    from pyproj import Transformer
    from shapely.geometry import box, mapping, shape
    from shapely.ops import unary_union

    cfg = AREAS[area]
    x0, y0, x1, y1 = cfg["bbox"]
    clip = box(x0 - 0.002, y0 - 0.002, x1 + 0.002, y1 + 0.002)
    # The detailed ground: the focus area and a margin where it fades out.
    fx0, fy0, fx1, fy1 = cfg["focus"]
    ground_box = box(fx0 - GROUND_MARGIN[0], fy0 - GROUND_MARGIN[1], fx1 + GROUND_MARGIN[0], fy1 + GROUND_MARGIN[1])
    features, levels = [], []
    for f in wfs("BDTOPO_V3:surface_hydrographique", cfg["bbox"]):
        if f["properties"].get("nature") != "Ecoulement naturel":
            continue  # the river, not fountain basins
        levels += zs(f["geometry"])
        g = shape(flat(f["geometry"])).intersection(clip)
        if not g.is_empty:
            features.append({"type": "Feature", "properties": {"kind": "water", "name": "Seine"}, "geometry": mapping(g)})
    level = round(sum(levels) / len(levels), 1) if levels else None
    bridges = 0
    if features:
        water = unary_union([shape(f["geometry"]) for f in features])
        features = ground_features(water, ground_box)
        to_metric = Transformer.from_crs(4326, 2154, always_xy=True).transform
        to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform
        for name, deck in bridge_decks(wfs("BDTOPO_V3:troncon_de_route", cfg["bbox"]), water, to_metric, to_wgs):
            bridges += 1
            if deck.intersects(ground_box):
                features.append({"type": "Feature", "properties": {"kind": "bridge", "name": name}, "geometry": mapping(deck)})
    for lm in LANDMARKS.get(area, []):
        props = {k: v for k, v in lm.items() if k != "at"}
        features.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": list(lm["at"])}})

    out = paths.DATA_DIR / "3d" / f"site-{area}.geojson"
    out.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "metadata": {
                    "water_level_m": level,
                    "street_level_m": STREET_LEVEL_M,
                    "ground_box": list(ground_box.bounds),
                    "source": "IGN BD TOPO (Etalab 2.0)",
                },
                "features": features,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    log(f"site: river at {level} m, {bridges} bridge(s), {len(LANDMARKS.get(area, []))} landmark detail(s) -> {out.relative_to(paths.REPO_ROOT)}")
    return {"area": area, "file": f"3d/site-{area}.geojson", "water_level_m": level, "bridges": bridges}

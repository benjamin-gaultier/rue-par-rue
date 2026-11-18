"""Streets and street furniture of a model area, through time.

Two street networks, one before and one after Haussmann's works on the Cité:

* The old network (1780 to DEMOLISHED_BY, 1860): the street space of the
  Vasserot cadastre (ALPAGE, about 1836), the same layer the massing model
  takes its demolished houses from. Streets had a central gutter and no
  pavements; a centreline is traced through each street (the medial axis of
  the street space, from a Voronoi diagram of its edges) to draw the gutter
  and to hang the lanterns. Streets at least OLD_PAVEMENT_MIN_WIDTH wide get
  granite-kerbed pavements from OLD_PAVEMENTS_FROM, after the law of 7 June
  1845 and the Paris rules of 1846 that made pavements general.
* The modern network (from 1860): today's pavements and pedestrian crossings
  from the City of Paris road plan (plan de voirie, ODbL), today's street
  lamps, drinking fountains and newspaper kiosks (Paris Data, ODbL), and the
  main roads from IGN BD TOPO (Etalab 2.0).

Every item has a life (from, until) in years. Dates come from HISTORY below;
where no source gives a year for this place, the year is a stated
approximation (see each note). Positions are today's where open data has
them; older furniture that no dataset records (lanterns, kerb stones, street
name plaques, Morris columns, benches...) is placed by rule: along the
centreline, at block corners, or at regular spacing on wide pavements.
Nothing is placed inside a building standing that year: the app trims every
life against the buildings of the model as well.

Output: web/public/data/3d/streets-<area>.json, compact: coordinates are
integers (degrees x 1e7 from an origin), delta-encoded along each line.
"""

from __future__ import annotations

import json
import math
import urllib.parse
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable, Iterable

from rpr import net, paths
from rpr.sources.model3d import AREAS, DEMOLISHED_BY, VASSEROT_EPSG

CACHE = paths.REPO_ROOT / "pipeline" / "cache" / "streets"
STACKS = "https://stacks.stanford.edu/file/druid:{druid}/{name}"
VOIRIE_DRUID = "gy980ch3900"
VOIRIE_STEM = "Vasserot_Emprise_de_la_voirie"
ODS = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/{ds}/exports/{fmt}"
SCALE = 10_000_000  # integer coordinates: degrees x 1e7 (about 1 cm)
OPEN = 10_000  # "still there"

# --------------------------------------------------------------- history

FIRST_YEAR = 1780
OLD_UNTIL = DEMOLISHED_BY  # the old houses of the Cité are shown until then (model3d)
MODERN_FROM = DEMOLISHED_BY
OLD_PAVEMENTS_FROM = 1845
OLD_PAVEMENT_MIN_WIDTH = 10.0  # metres between facades
OLD_PAVEMENT_WIDTH = 1.6
GUTTER_WIDTHS = (2.4, 14.0)  # streets with a central gutter, metres between facades
GAS_FROM = 1850
LANTERN_SPACING = 45.0
STONE_PLAQUES_FROM = 1729
ENAMEL_PLAQUES_FROM = 1847
RAMBUTEAU_FROM = 1839
MORRIS_FROM = 1868
VESPASIENNES = (1868, 1980)
KIOSKS_FROM = 1857
WALLACE_FROM = 1872
BENCHES_FROM = 1860
STUDDED_CROSSINGS_FROM = 1930
PAINTED_CROSSINGS_FROM = 1963
CENTRE_LINES_FROM = 1963
MODERN_LAMPS_FROM = 1960
BOLLARDS_FROM = 1980

HISTORY: dict[str, dict[str, Any]] = {
    "central_gutter": {
        "years": [FIRST_YEAR, OLD_UNTIL],
        "note": "Old Paris streets were cambered toward a central gutter (ruisseau) and had no pavements. Shown on every street of the 1836 network between 2.4 and 14 m wide, until the Haussmann clearances (1860, as the model).",
    },
    "old_pavements": {
        "years": [OLD_PAVEMENTS_FROM, OLD_UNTIL],
        "note": "Prefect Chabrol required granite-kerbed pavements on new streets from 1823; the law of 7 June 1845 and the Paris arrêté of 1846 made them general. Approximation: streets of the 1836 network at least 10 m wide get 1.6 m pavements from 1845.",
    },
    "modern_network": {
        "years": [MODERN_FROM, OPEN],
        "note": "Today's pavements and crossings (plan de voirie) from 1860, when Haussmann's works rebuilt the Cité; streets that survived (around rue Chanoinesse) switch from the old network then too (approximation).",
    },
    "bridge_pavements": {
        "note": "Pavements over the river are shown from the year the present bridge was built (BRIDGE_YEARS).",
    },
    "oil_lanterns": {
        "years": [FIRST_YEAR, GAS_FROM],
        "note": "Réverbères (oil lamps with reflectors, from 1766-1769) hung on a rope across the street. Gas replaced oil from 1839; by the early 1850s oil was left only on secondary streets, and the six gas companies merged in 1855. Approximation for the Cité: gas from 1850. Spacing: one every 45 m (12,761 burners lit Paris in 1788, three or four per lantern).",
    },
    "gas_lamps": {
        "years": [GAS_FROM, MODERN_LAMPS_FROM],
        "note": "Gas lanterns on wall brackets in narrow streets and on cast-iron candelabra elsewhere. On the modern network they stand at today's lamp positions. The last gas lamps of Paris went out in 1962; functional electric poles are shown from 1960 where today's lamp is functional (approximation).",
    },
    "stone_plaques": {
        "years": [STONE_PLAQUES_FROM, ENAMEL_PLAQUES_FROM],
        "note": "Street names engraved on stone tablets at street corners, ordered in 1728 and put up from 1729.",
    },
    "enamel_plaques": {
        "years": [ENAMEL_PLAQUES_FROM, OPEN],
        "note": "Blue enamelled plaques with white letters, decided under Rambuteau and put up from 1847.",
    },
    "rambuteau_columns": {
        "years": [RAMBUTEAU_FROM, MORRIS_FROM],
        "note": "Colonnes Rambuteau: urinals inside a column carrying posters, authorised in 1839 (478 by 1841). Only on pavements, so from 1845 on the old network.",
    },
    "morris_columns": {
        "years": [MORRIS_FROM, OPEN],
        "note": "Gabriel Morris's poster columns, from 1868. No dataset gives positions: placed on wide pavements about 180 m apart.",
    },
    "vespasiennes": {
        "years": list(VESPASIENNES),
        "note": "Cast-iron urinals that replaced the Rambuteau columns from 1868; replaced in turn by automatic toilets from 1980 (approximation). Placed about 300 m apart on wide pavements.",
    },
    "kiosks": {
        "years": [KIOSKS_FROM, OPEN],
        "note": "Newspaper kiosks from 1857 (Davioud). Today's kiosks (Paris Data), shown from 1860 at their present places.",
    },
    "wallace_fountains": {
        "years": [WALLACE_FROM, OPEN],
        "note": "Wallace fountains from 1872. Today's fountains (Paris Data, type FONTNE_WALLACE), shown from 1872 at their present places; the dataset has no installation dates.",
    },
    "benches": {
        "years": [BENCHES_FROM, OPEN],
        "note": "Davioud's double benches came with the promenades of the Second Empire. Placed every 35 m or so on pavements at least 4.5 m deep (approximation).",
    },
    "kerb_stones": {
        "years": [FIRST_YEAR, OLD_UNTIL],
        "note": "Stone bollards (bornes, chasse-roues) guarded the corners of houses on the old streets. Placed at block corners of the 1836 network.",
    },
    "bollards": {
        "years": [BOLLARDS_FROM, OPEN],
        "note": "Today's cast-iron bollards (plan de voirie). Shown from 1980 (approximation: anti-parking bollards spread in the 1970s and 1980s).",
    },
    "crossings": {
        "years": [STUDDED_CROSSINGS_FROM, OPEN],
        "note": "Today's pedestrian crossings (plan de voirie). Studded crossings (passages cloutés) from 1930 (78 in Paris in 1928, over 12,000 in 1934); white bars from 1963 (interministerial instruction of 22 October 1963).",
    },
    "centre_lines": {
        "years": [CENTRE_LINES_FROM, OPEN],
        "note": "Dashed centre lines on two-way main roads from 1963 (same instruction; approximation).",
    },
    "road_surfaces": {
        "note": "Drawn by the ground shader by year: sandstone setts until the 1960s (in 1907 about 6 of Paris's 10 million m² of roadway were still sandstone); main roads macadam from 1860 and asphalt from 1900 (asphalt first laid in rue Bergère in 1854); asphalt everywhere from 1970, as setts were tarred over after 1968 (approximations).",
    },
}

# Pavements over the river: the year the present bridge was built.
BRIDGE_YEARS = {
    "PONT NEUF": 1607,
    "PONT SAINT-MICHEL": 1857,
    "PETIT PONT": 1853,
    "PONT AU DOUBLE": 1883,
    "PONT D'ARCOLE": 1856,
    "PONT NOTRE-DAME": 1853,
    "PONT AU CHANGE": 1860,
    "PONT DE L'ARCHEVECHE": 1828,
    "PONT SAINT-LOUIS": 1970,
    "PONT LOUIS-PHILIPPE": 1862,
    "PONT DE LA TOURNELLE": 1928,
    "PONT DES ARTS": 1984,
    "PONT MARIE": 1635,
    "PONT DE SULLY": 1876,
}
UNKNOWN_BRIDGE_YEAR = 1900

# Item types, as the app reads them (streets.ts).
ITEM = {
    "lantern": 0,  # old network: oil réverbère on a rope, then a gas lantern on a wall bracket
    "potence": 1,  # oil réverbère on a post and arm, on squares and quays
    "candelabra": 2,  # cast-iron lamp post with a lantern
    "pole": 3,  # functional electric lamp
    "wall_lamp": 4,  # lantern on a wall bracket (today's consoles)
    "kerb_stone": 5,
    "bollard": 6,
    "plaque": 7,
    "column": 8,  # Rambuteau, then Morris
    "vespasienne": 9,
    "wallace": 10,
    "kiosk": 11,
    "bench": 12,
}
ITEM_FIELDS = ["type", "x", "y", "angle_deg", "from", "until", "param"]

# Today's lamps: luminaires "de style" (Paris lanterns on cast-iron posts) or functional.
STYLE_LAMP_WORDS = ("FONTES DE PARIS", "LANT", "LYRE", "LENZI", "DUBUISSON", "RAGNI", "R2", "R4", "R5", "PONT NEUF", "HOT VIL")


# --------------------------------------------------------------- encoding


def encode(coords: Iterable[tuple[float, float]], origin: tuple[float, float]) -> list[int]:
    """Lon/lat pairs as integers (degrees x 1e7 from `origin`), each pair a delta from the previous."""
    out: list[int] = []
    px = py = 0
    for lon, lat in coords:
        x = round((lon - origin[0]) * SCALE)
        y = round((lat - origin[1]) * SCALE)
        out += [x - px, y - py]
        px, py = x, y
    return out


def decode(values: list[int], origin: tuple[float, float]) -> list[tuple[float, float]]:
    out = []
    x = y = 0
    for i in range(0, len(values), 2):
        x += values[i]
        y += values[i + 1]
        out.append((origin[0] + x / SCALE, origin[1] + y / SCALE))
    return out


def point(lon: float, lat: float, origin: tuple[float, float]) -> tuple[int, int]:
    return round((lon - origin[0]) * SCALE), round((lat - origin[1]) * SCALE)


def lamp_style(label: str | None) -> str:
    """'style' for Paris lanterns on cast-iron posts, 'functional' for modern luminaires."""
    up = (label or "").upper()
    return "style" if any(w in up for w in STYLE_LAMP_WORDS) else "functional"


def bridge_year(name: str) -> int:
    up = name.upper().replace("’", "'")
    for key, year in BRIDGE_YEARS.items():
        if key in up:
            return year
    return UNKNOWN_BRIDGE_YEAR


def dedupe(points: list[tuple[float, float]], radius: float) -> list[int]:
    """Indices of points kept so that no two are closer than `radius` (first one wins)."""
    cells: dict[tuple[int, int], list[int]] = defaultdict(list)
    kept: list[int] = []
    for i, (x, y) in enumerate(points):
        cx, cy = int(math.floor(x / radius)), int(math.floor(y / radius))
        near = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in cells.get((cx + dx, cy + dy), []):
                    if (points[j][0] - x) ** 2 + (points[j][1] - y) ** 2 < radius * radius:
                        near = True
                        break
        if not near:
            cells[(cx, cy)].append(i)
            kept.append(i)
    return kept


def along(line: list[tuple[float, float]], spacing: float, start: float | None = None) -> list[tuple[float, float, float]]:
    """Points every `spacing` metres along a polyline (x, y, direction in radians), half a step in."""
    out = []
    t = spacing / 2 if start is None else start
    acc = 0.0
    for (ax, ay), (bx, by) in zip(line[:-1], line[1:]):
        seg = math.hypot(bx - ax, by - ay)
        if seg <= 0:
            continue
        while t <= acc + seg:
            f = (t - acc) / seg
            out.append((ax + (bx - ax) * f, ay + (by - ay) * f, math.atan2(by - ay, bx - ax)))
            t += spacing
        acc += seg
    return out


def chaikin(line: list[tuple[float, float]], iterations: int = 2) -> list[tuple[float, float]]:
    """Smooth a polyline by corner cutting, keeping its two ends."""
    for _ in range(iterations):
        if len(line) < 3:
            return line
        out = [line[0]]
        for (ax, ay), (bx, by) in zip(line[:-1], line[1:]):
            out += [(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by), (0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by)]
        out[1] = line[0]
        out[-1] = line[-1]
        line = [out[0]] + out[2:-1] + [line[-1]]
    return line


def corner_angle(prev: tuple[float, float], at: tuple[float, float], nxt: tuple[float, float]) -> float:
    """Turn at `at` in degrees, positive to the left (counter-clockwise)."""
    a = math.atan2(at[1] - prev[1], at[0] - prev[0])
    b = math.atan2(nxt[1] - at[1], nxt[0] - at[0])
    d = math.degrees(b - a)
    while d > 180:
        d -= 360
    while d <= -180:
        d += 360
    return d


# --------------------------------------------------------------- centrelines


def prune_spurs(adj: dict, radius: dict, factor: float = 1.6, min_len: float = 3.0) -> dict:
    """Remove dead-end branches of a skeleton graph shorter than `factor` times
    the street's half-width at the junction they leave (they point into corners)."""
    for _ in range(6):
        changed = False
        for leaf in [k for k, v in adj.items() if len(v) == 1]:
            if leaf not in adj or len(adj[leaf]) != 1:
                continue
            path, prev, cur, length = [leaf], None, leaf, 0.0
            while True:
                nxt = [n for n in adj[cur] if n != prev]
                if not nxt or (cur != leaf and len(adj[cur]) != 2):
                    break
                n = nxt[0]
                length += math.hypot(n[0] - cur[0], n[1] - cur[1])
                prev, cur = cur, n
                path.append(cur)
            if len(adj.get(cur, [])) > 2 and length < max(min_len, factor * radius.get(cur, 0.0)):
                for a, b in zip(path[:-1], path[1:]):
                    adj[a].remove(b)
                    adj[b].remove(a)
                for p in path[:-1]:
                    if not adj[p]:
                        del adj[p]
                changed = True
        if not changed:
            break
    return adj


def centrelines(poly, spacing: float = 1.0, min_radius: float = 0.6):
    """Medial axis of a street polygon (metric CRS) as LineStrings, with a function
    giving the half-width (distance to the edge) at any point."""
    import numpy as np
    import shapely
    from shapely.geometry import LineString
    from shapely.ops import linemerge

    edge = poly.boundary
    pts = shapely.MultiPoint(shapely.get_coordinates(shapely.segmentize(edge, spacing)))
    segs = shapely.get_parts(shapely.voronoi_polygons(pts, only_edges=True))
    shapely.prepare(poly)
    segs = segs[shapely.contains(poly, segs)]
    shapely.prepare(edge)
    c = shapely.get_coordinates(segs).reshape(-1, 2, 2)
    r0 = shapely.distance(shapely.points(c[:, 0]), edge)
    r1 = shapely.distance(shapely.points(c[:, 1]), edge)
    keep = np.minimum(r0, r1) > min_radius
    adj: dict = defaultdict(list)
    radius: dict = {}
    for (a, b), ra, rb in zip(c[keep], r0[keep], r1[keep]):
        ka, kb = (round(a[0], 3), round(a[1], 3)), (round(b[0], 3), round(b[1], 3))
        if ka == kb:
            continue
        adj[ka].append(kb)
        adj[kb].append(ka)
        radius[ka], radius[kb] = float(ra), float(rb)
    prune_spurs(adj, radius)
    pairs = {(min(a, b), max(a, b)) for a, nbrs in adj.items() for b in nbrs}
    merged = linemerge([LineString(p) for p in pairs])
    lines = [ln.simplify(0.4) for ln in getattr(merged, "geoms", [merged]) if not ln.is_empty]
    return [ln for ln in lines if ln.length > 2.0], lambda p: edge.distance(p)


# --------------------------------------------------------------- sources


def cached(name: str, fetch: Callable[[], bytes]) -> bytes:
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_bytes(fetch())
        tmp.replace(path)
    return path.read_bytes()


def ods_export(dataset: str, bbox: tuple[float, float, float, float], select: str | None = None, fmt: str = "geojson") -> Any:
    """A Paris Data (Opendatasoft) export of the records in a bbox. The portal is flaky: retried."""
    x0, y0, x1, y1 = bbox
    query = {"where": f"in_bbox(geo_point_2d, {y0}, {x0}, {y1}, {x1})"}
    if select:
        query["select"] = select
    url = f"{ODS.format(ds=dataset, fmt=fmt)}?{urllib.parse.urlencode(query)}"
    return json.loads(cached(f"{dataset}.{fmt}", lambda: net.fetch_bytes(url, timeout=180, retries=10)))


def vasserot_streets(bbox: tuple[float, float, float, float], log: Callable[[str], Any]):
    """The 1836 street space (one polygon per old arrondissement), clipped to the bbox, in WGS84."""
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import box, shape
    from shapely.ops import transform, unary_union
    from shapely.validation import make_valid

    for ext in ("shp", "shx", "dbf", "prj"):
        name = f"{VOIRIE_STEM}.{ext}"
        cached(name, lambda: net.fetch_bytes(STACKS.format(druid=VOIRIE_DRUID, name=name), timeout=300))
    to_wgs = Transformer.from_crs(VASSEROT_EPSG, 4326, always_xy=True).transform
    clip = box(*bbox)
    parts = []
    reader = shapefile.Reader(str(CACHE / f"{VOIRIE_STEM}.shp"), encoding="latin-1")
    for sr in reader.iterShapeRecords():
        g = make_valid(transform(to_wgs, shape(sr.shape.__geo_interface__)))
        if g.intersects(clip):
            parts.append(g.intersection(clip))
    log(f"streets: Vasserot street space, {len(parts)} arrondissement part(s)")
    return unary_union(parts)


def river(bbox: tuple[float, float, float, float]):
    from shapely.geometry import shape
    from shapely.ops import unary_union

    from rpr.sources.site import flat, wfs

    raw = json.loads(cached("bdtopo-surface_hydrographique.geojson", lambda: json.dumps({"features": wfs("BDTOPO_V3:surface_hydrographique", bbox)}).encode()))
    return unary_union([shape(flat(f["geometry"])) for f in raw["features"] if f["properties"].get("nature") == "Ecoulement naturel"])


def roads(bbox: tuple[float, float, float, float]) -> list[dict]:
    from rpr.sources.site import wfs

    return json.loads(cached("bdtopo-troncon_de_route.geojson", lambda: json.dumps({"features": wfs("BDTOPO_V3:troncon_de_route", bbox)}).encode()))["features"]


# --------------------------------------------------------------- build


def _rings(geom) -> list:
    polys = [geom] if geom.geom_type == "Polygon" else [g for g in getattr(geom, "geoms", []) if g.geom_type == "Polygon"]
    return polys


def _edge_flags(ring: list[tuple[float, float]], blocked: Callable[[Any], bool], inside_ccw: bool) -> str:
    """'1' for each edge that is a kerb (open road beyond it), '0' where a
    facade, the river or another pavement lies just outside."""
    from shapely.geometry import Point

    flags = []
    n = len(ring)
    for i in range(n):
        (ax, ay), (bx, by) = ring[i], ring[(i + 1) % n]
        L = math.hypot(bx - ax, by - ay) or 1.0
        # Outward normal: right of the edge for a counter-clockwise outer ring.
        nx, ny = (by - ay) / L, -(bx - ax) / L
        if not inside_ccw:
            nx, ny = -nx, -ny
        probe = Point((ax + bx) / 2 + nx * 0.3, (ay + by) / 2 + ny * 0.3)
        flags.append("0" if blocked(probe) else "1")
    return "".join(flags)


def _polygon_out(poly, to_wgs, origin, blocked) -> tuple[list[list[int]], list[str]]:
    """Encoded rings (outer counter-clockwise, holes clockwise) and their kerb flags."""
    from shapely.geometry.polygon import orient

    poly = orient(poly, 1.0)
    rings, flags = [], []
    for k, ring in enumerate([poly.exterior, *poly.interiors]):
        coords = list(ring.coords)[:-1]
        if len(coords) < 3:
            continue
        flags.append(_edge_flags(coords, blocked, True))
        rings.append(encode([to_wgs(x, y) for x, y in coords], origin))
    return rings, flags


def build(area: str = "cite", log: Callable[[str], Any] = print) -> dict:
    import shapely
    from pyproj import Transformer
    from shapely.geometry import LineString, Point, box, shape
    from shapely.geometry.polygon import orient
    from shapely.ops import nearest_points, transform, unary_union
    from shapely.strtree import STRtree
    from shapely.validation import make_valid

    cfg = AREAS[area]
    bbox = cfg["bbox"]
    origin = (round(bbox[0], 4), round(bbox[1], 4))
    to_m = Transformer.from_crs(4326, 2154, always_xy=True).transform
    to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform

    water = transform(to_m, river(bbox)).buffer(0)
    model = json.loads((paths.DATA_DIR / "3d" / f"{area}-1836.geojson").read_text())
    old_shapes, today_shapes = [], []
    for f in model["features"]:
        g = make_valid(transform(to_m, shape(f["geometry"])))
        (old_shapes if f["properties"]["kind"] in ("reconstructed", "standing") else []).append(g)
        (today_shapes if f["properties"]["kind"] != "reconstructed" else []).append(g)
    old_index, today_index = STRtree(old_shapes), STRtree(today_shapes)

    def in_any(index, shapes, p) -> bool:
        return any(shapes[i].contains(p) for i in index.query(p))

    stats: dict[str, int] = defaultdict(int)
    items: list[list] = []

    def item(kind: str, x: float, y: float, angle: float, start: int, end: int, param: float = 0.0) -> None:
        lon, lat = to_wgs(x, y)
        ix, iy = point(lon, lat, origin)
        items.append([ITEM[kind], ix, iy, round(math.degrees(angle)) % 360, int(start), int(end), round(param, 2)])
        stats[kind] += 1

    # ---- the old network (Vasserot, about 1836)
    streets = transform(to_m, vasserot_streets(bbox, log)).buffer(0).difference(water).simplify(0.2)
    streets = unary_union([p for p in _rings(streets) if p.area > 4])
    lines, half_width = centrelines(streets)
    log(f"streets: 1836 street space {streets.area:,.0f} m², {len(lines)} centrelines, {sum(ln.length for ln in lines) / 1000:.1f} km")

    gutters = []
    for ln in lines:
        coords = list(ln.coords)
        run: list[tuple[float, float, float]] = []

        def flush():
            if len(run) >= 2:
                widths = sorted(r for _, _, r in run)
                wide = widths[len(widths) // 2] * 2 >= OLD_PAVEMENT_MIN_WIDTH
                end = OLD_PAVEMENTS_FROM if wide else OLD_UNTIL
                rough = LineString([(x, y) for x, y, _ in run]).simplify(0.5)
                simple = LineString(chaikin(list(rough.coords), 2)).simplify(0.08)
                gutters.append([FIRST_YEAR, end, encode([to_wgs(x, y) for x, y in simple.coords], origin)])
            run.clear()

        # Densify to 3 m so the half-width follows the street.
        dense = LineString(coords).segmentize(3.0)
        for x, y in dense.coords:
            p = Point(x, y)
            r = half_width(p)
            ok = GUTTER_WIDTHS[0] <= 2 * r <= GUTTER_WIDTHS[1] and water.distance(p) > r + 2 and not in_any(old_index, old_shapes, p)
            if ok:
                run.append((x, y, r))
            else:
                flush()
        flush()
    stats["gutter runs"] = len(gutters)

    # Lanterns: along the centreline of narrow streets; on posts on squares and quays.
    lantern_pts: list[tuple[float, float]] = []
    for ln in lines:
        for x, y, a in along(list(ln.coords), LANTERN_SPACING):
            p = Point(x, y)
            r = half_width(p)
            if in_any(old_index, old_shapes, p) or r < 1.2:
                continue
            if 2 * r <= GUTTER_WIDTHS[1] and water.distance(p) > r + 2:
                item("lantern", x, y, a, FIRST_YEAR, OLD_UNTIL, r)
                lantern_pts.append((x, y))
    # Wide places (squares, quays): posts along the edge of the street space.
    wide = streets.buffer(-OLD_PAVEMENT_MIN_WIDTH / 2).buffer(OLD_PAVEMENT_MIN_WIDTH / 2).intersection(streets)
    for poly in _rings(wide):
        for x, y, a in along(list(poly.exterior.coords), LANTERN_SPACING):
            # Step 0.7 m into the street, away from the facade or parapet.
            nx, ny = -math.sin(a), math.cos(a)
            sign = 1 if poly.contains(Point(x + nx * 0.7, y + ny * 0.7)) else -1
            px, py = x + nx * 0.7 * sign, y + ny * 0.7 * sign
            p = Point(px, py)
            if not streets.contains(p) or in_any(old_index, old_shapes, p):
                continue
            facing = a + (math.pi / 2 if sign > 0 else -math.pi / 2)
            item("potence", px, py, facing, FIRST_YEAR, GAS_FROM)
            item("candelabra", px, py, facing, GAS_FROM, OLD_UNTIL, 3.6)

    # Pavements on the wide streets, from 1845.
    band = wide.difference(wide.buffer(-OLD_PAVEMENT_WIDTH)).intersection(streets.boundary.buffer(OLD_PAVEMENT_WIDTH + 0.05))
    band = band.buffer(0.05).buffer(-0.05).simplify(0.15)
    old_pavements = []
    edge_line = streets.boundary

    def old_blocked(p) -> bool:
        return edge_line.distance(p) < 0.32 or not streets.contains(p)

    for poly in _rings(band):
        if poly.area < 3:
            continue
        rings, flags = _polygon_out(poly, to_wgs, origin, old_blocked)
        if rings:
            old_pavements.append([0, OLD_PAVEMENTS_FROM, OLD_UNTIL, rings, flags])
    stats["old pavements"] = len(old_pavements)

    # Columns on the old pavements.
    _place_on_pavements([p for p in _rings(band)], "column", 180.0, 0.6, 0.8, [], RAMBUTEAU_FROM, OLD_UNTIL, item, kerb_side=lambda p: True)

    # Block corners: kerb stones and the street-name plaques on both facades.
    for poly in _rings(streets):
        for k, ring in enumerate([poly.exterior, *poly.interiors]):
            coords = list(ring.coords)[:-1]
            left = ring.is_ccw == (k == 0)  # is the street on the left of the ring?
            n = len(coords)
            for i in range(n):
                prev, at, nxt = coords[i - 1], coords[i], coords[(i + 1) % n]
                # A block corner sticks into the street: the ring turns away from the street.
                turn = corner_angle(prev, at, nxt) * (-1 if left else 1)
                if not (40 <= turn <= 130):
                    continue
                l1 = math.hypot(at[0] - prev[0], at[1] - prev[1])
                l2 = math.hypot(nxt[0] - at[0], nxt[1] - at[1])
                if l1 < 2.5 or l2 < 2.5:
                    continue
                u1 = ((at[0] - prev[0]) / l1, (at[1] - prev[1]) / l1)
                u2 = ((nxt[0] - at[0]) / l2, (nxt[1] - at[1]) / l2)
                # A real street corner: both facades' lines run on into the street past it.
                if not (streets.contains(Point(at[0] + u1[0] * 2.5, at[1] + u1[1] * 2.5)) and streets.contains(Point(at[0] - u2[0] * 2.5, at[1] - u2[1] * 2.5))):
                    continue
                bx, by = u1[0] - u2[0], u1[1] - u2[1]  # into the street, bisecting the corner
                bl = math.hypot(bx, by) or 1.0
                bx, by = bx / bl, by / bl
                kx, ky = at[0] + bx * 0.45, at[1] + by * 0.45
                if not streets.contains(Point(kx, ky)) or not in_any(old_index, old_shapes, Point(at[0] - bx, at[1] - by)):
                    continue  # no house at this corner
                item("kerb_stone", kx, ky, 0.0, FIRST_YEAR, OLD_UNTIL)
                for u, sgn in ((u1, -1), (u2, 1)):
                    # On the facade, 0.7 m from the corner, facing the street.
                    out = (-u[1], u[0]) if left else (u[1], -u[0])
                    fx, fy = at[0] + u[0] * 0.7 * sgn, at[1] + u[1] * 0.7 * sgn
                    item("plaque", fx + out[0] * 0.04, fy + out[1] * 0.04, math.atan2(out[1], out[0]), STONE_PLAQUES_FROM, OLD_UNTIL)

    # ---- the modern network (plan de voirie)
    pav_raw = ods_export("plan-de-voirie-trottoirs-emprises", bbox)
    pav_shapes = []
    for f in pav_raw["features"]:
        if not f.get("geometry"):
            continue
        g = make_valid(transform(to_m, shape(f["geometry"]))).buffer(0)
        for p in _rings(g):
            p = p.simplify(0.15)
            if p.is_valid and p.area >= 0.8:
                pav_shapes.append(p)
    pav_index = STRtree(pav_shapes)
    road_feats = roads(bbox)
    bridge_lines = []
    for f in road_feats:
        p = f["properties"]
        name = p.get("cpx_toponyme_route_nommee") or ""
        if str(p.get("position_par_rapport_au_sol")) == "1" and "PONT" in name.upper():
            bridge_lines.append((transform(to_m, LineString([c[:2] for c in f["geometry"]["coordinates"]])), name))

    modern_pavements = []
    for k, poly in enumerate(pav_shapes):
        def blocked(pt, k=k) -> bool:
            if water.contains(pt) and not any(ln.distance(pt) < 12 for ln, _ in bridge_lines):
                return True
            if in_any(today_index, today_shapes, pt):
                return True
            return any(j != k and pav_shapes[j].contains(pt) for j in pav_index.query(pt))

        land = poly.difference(water)
        wet = poly.intersection(water)
        for part in _rings(land.buffer(0)):
            if part.area < 0.8:
                continue
            rings, flags = _polygon_out(part, to_wgs, origin, blocked)
            if rings:
                modern_pavements.append([1, MODERN_FROM, OPEN, rings, flags])
        for part in _rings(wet.buffer(0)):
            if part.area < 0.8:
                continue
            c = part.representative_point()
            near = min(bridge_lines, key=lambda b: b[0].distance(c), default=None)
            if near is None or near[0].distance(c) > 15:
                continue
            rings, flags = _polygon_out(part, to_wgs, origin, blocked)
            if rings:
                modern_pavements.append([1, max(MODERN_FROM, bridge_year(near[1])), OPEN, rings, flags])
    stats["modern pavements"] = len(modern_pavements)
    pav_union = unary_union(pav_shapes)

    # Crossings: stripes run along the road, so take the nearest road's direction.
    road_lines = []
    for f in road_feats:
        p = f["properties"]
        if f["geometry"]["type"] != "LineString":
            continue
        road_lines.append((transform(to_m, LineString([c[:2] for c in f["geometry"]["coordinates"]])), p))
    road_index = STRtree([ln for ln, _ in road_lines])
    crossings = []
    for f in ods_export("plan-de-voirie-passages-pietons", bbox)["features"]:
        if not f.get("geometry"):
            continue
        g = make_valid(transform(to_m, shape(f["geometry"]))).buffer(0)
        for poly in _rings(g):
            poly = poly.simplify(0.1)
            if poly.area < 2:
                continue
            c = poly.centroid
            near = road_index.query_nearest(c, max_distance=25)
            if not len(near):
                continue
            ln = road_lines[int(near[0])][0]
            t = ln.project(c)
            a = ln.interpolate(max(0.0, t - 1.0))
            b = ln.interpolate(min(ln.length, t + 1.0))
            angle = math.degrees(math.atan2(b.y - a.y, b.x - a.x)) % 180
            ring = list(poly.exterior.coords)[:-1]
            crossings.append([STUDDED_CROSSINGS_FROM, round(angle), encode([to_wgs(x, y) for x, y in ring], origin)])
    stats["crossings"] = len(crossings)

    # Main roads (macadam, then asphalt, before the side streets) and centre lines.
    main_parts, centre = [], []
    for ln, p in road_lines:
        if str(p.get("position_par_rapport_au_sol")) != "0" or str(p.get("importance")) not in ("3", "4"):
            continue
        width = float(p.get("largeur_de_chaussee") or 0) or 6.0
        main_parts.append(ln.buffer(width / 2 + 0.5, cap_style="flat"))
        if p.get("sens_de_circulation") == "Double sens" and width >= 7:
            centre.append([CENTRE_LINES_FROM, encode([to_wgs(x, y) for x, y in ln.simplify(0.3).coords], origin)])
    main = unary_union(main_parts).difference(pav_union).difference(water).simplify(0.3)
    main_roads = []
    for poly in _rings(main):
        if poly.area < 6:
            continue
        poly = orient(poly, 1.0)
        main_roads.append([MODERN_FROM, [encode([to_wgs(x, y) for x, y in list(r.coords)[:-1]], origin) for r in [poly.exterior, *poly.interiors]]])
    stats["main road areas"] = len(main_roads)
    stats["centre lines"] = len(centre)

    # Today's street lamps.
    lamps = ods_export("eclairage-public", bbox, "lib_ouvrag,luminaire_libelle,support_hauteur,x_wgs84,y_wgs84", fmt="json")
    posts, consoles = [], []
    for r in lamps:
        try:
            x, y = to_m(float(r["x_wgs84"]), float(r["y_wgs84"]))
        except (TypeError, ValueError, KeyError):
            continue
        if r.get("lib_ouvrag") == "Candélabre":
            posts.append((x, y, r))
        elif r.get("lib_ouvrag") == "Console":
            consoles.append((x, y, r))
    furniture_pts: list[tuple[float, float]] = []
    for i in dedupe([(x, y) for x, y, _ in posts], 0.8):
        x, y, r = posts[i]
        p = Point(x, y)
        if in_any(today_index, today_shapes, p) or (water.contains(p) and not any(ln.distance(p) < 15 for ln, _ in bridge_lines)):
            continue
        try:
            h = float(r.get("support_hauteur") or 0)
        except ValueError:
            h = 0.0
        style = lamp_style(r.get("luminaire_libelle"))
        start = MODERN_FROM
        near_bridge = min(bridge_lines, key=lambda b: b[0].distance(p), default=None)
        if water.contains(p) and near_bridge is not None:
            start = max(start, bridge_year(near_bridge[1]))
        if style == "style":
            item("candelabra", x, y, 0.0, start, OPEN, h if 2.5 <= h <= 7 else 4.2)
        else:
            item("candelabra", x, y, 0.0, start, max(start, MODERN_LAMPS_FROM), 4.0)
            item("pole", x, y, _road_facing(p, road_index, road_lines), max(start, MODERN_LAMPS_FROM), OPEN, h if 5 <= h <= 14 else 8.0)
        furniture_pts.append((x, y))
    walls = unary_union([g.boundary for g in today_shapes])
    for i in dedupe([(x, y) for x, y, _ in consoles], 0.8):
        x, y, _ = consoles[i]
        p = Point(x, y)
        d = walls.distance(p)
        if d > 3.0:
            continue
        q = nearest_points(walls, p)[0]
        out = (p.x - q.x, p.y - q.y) if d > 0.05 else None
        if out is None:
            continue
        ol = math.hypot(*out)
        out = (out[0] / ol, out[1] / ol)
        if in_any(today_index, today_shapes, Point(q.x + out[0] * 0.3, q.y + out[1] * 0.3)):
            continue
        item("wall_lamp", q.x + out[0] * 0.02, q.y + out[1] * 0.02, math.atan2(out[1], out[0]), MODERN_FROM, OPEN, 4.6)

    # Wallace fountains and newspaper kiosks, today's places.
    for f in ods_export("fontaines-a-boire", bbox)["features"]:
        if f["properties"].get("type_objet") != "FONTNE_WALLACE" or not f.get("geometry"):
            continue
        x, y = to_m(*f["geometry"]["coordinates"][:2])
        item("wallace", x, y, 0.0, WALLACE_FROM, OPEN)
        furniture_pts.append((x, y))
    for f in ods_export("kiosques-de-presse", bbox)["features"]:
        if not f.get("geometry"):
            continue
        x, y = to_m(*f["geometry"]["coordinates"][:2])
        p = Point(x, y)
        item("kiosk", x, y, _road_facing(p, road_index, road_lines), max(KIOSKS_FROM, MODERN_FROM), OPEN)
        furniture_pts.append((x, y))

    # Bollards: the plan de voirie draws each as a small circle.
    bol_raw = ods_export("plan-de-voirie-mobiliers-urbains-bornes-barrieres-potelets", bbox, "lib_level,geo_point_2d", fmt="json")
    bpts = []
    for r in bol_raw:
        g = r.get("geo_point_2d") or {}
        if r.get("lib_level") == "BORNE" and "lon" in g:
            bpts.append(to_m(g["lon"], g["lat"]))
    for i in dedupe(bpts, 0.6):
        x, y = bpts[i]
        if in_any(today_index, today_shapes, Point(x, y)):
            continue
        item("bollard", x, y, 0.0, BOLLARDS_FROM, OPEN)

    # Trees, so benches and columns keep clear of them.
    try:
        greenery = json.loads((paths.DATA_DIR / "3d" / f"greenery-{area}.json").read_text())
        tf = greenery["trees"]["fields"]
        furniture_pts += [to_m(r[tf.index("lon")], r[tf.index("lat")]) for r in greenery["trees"]["rows"]]
    except (OSError, KeyError, ValueError):
        pass

    # Rule-placed furniture on the modern pavements.
    kerbs = pav_union.boundary.difference(unary_union(today_shapes).buffer(0.4)).difference(water.buffer(0.4))
    wide_pav = [p for p in pav_shapes if p.area > 20]
    _place_on_pavements(wide_pav, "column", 180.0, 0.6, 0.9, furniture_pts, MODERN_FROM, OPEN, item, kerbs=kerbs, depth=3.2)
    _place_on_pavements(wide_pav, "vespasienne", 300.0, 0.7, 1.1, furniture_pts, VESPASIENNES[0], VESPASIENNES[1], item, kerbs=kerbs, depth=3.5)
    _place_on_pavements(wide_pav, "bench", 35.0, 0.9, 1.2, furniture_pts, BENCHES_FROM, OPEN, item, kerbs=kerbs, depth=4.5, face_road=True)

    # Street-name plaques at the corners of today's blocks, where streets meet.
    blocks = unary_union([g.buffer(0.3, join_style="mitre") for g in today_shapes]).buffer(-0.3, join_style="mitre")
    near_pav = pav_union.buffer(4.0)
    ends: dict[tuple[float, float], int] = defaultdict(int)
    for ln, p in road_lines:
        if str(p.get("position_par_rapport_au_sol")) == "0":
            for c in (ln.coords[0], ln.coords[-1]):
                ends[(round(c[0], 1), round(c[1], 1))] += 1
    junctions = unary_union([Point(c).buffer(16.0, quad_segs=4) for c, n in ends.items() if n >= 3])
    for poly in _rings(blocks):
        ring = orient(poly.simplify(0.3), 1.0).exterior
        coords = list(ring.coords)[:-1]
        n = len(coords)
        for i in range(n):
            prev, at, nxt = coords[i - 1], coords[i], coords[(i + 1) % n]
            turn = corner_angle(prev, at, nxt)  # left turns are convex corners of a ccw block
            if not (40 <= turn <= 130) or not near_pav.contains(Point(at)) or not junctions.contains(Point(at)):
                continue
            l1 = math.hypot(at[0] - prev[0], at[1] - prev[1])
            l2 = math.hypot(nxt[0] - at[0], nxt[1] - at[1])
            if l1 < 3 or l2 < 3:
                continue
            u1 = ((at[0] - prev[0]) / l1, (at[1] - prev[1]) / l1)
            u2 = ((nxt[0] - at[0]) / l2, (nxt[1] - at[1]) / l2)
            # A real street corner: both facades' lines run on into the street past it.
            ahead = Point(at[0] + u1[0] * 3, at[1] + u1[1] * 3)
            behind = Point(at[0] - u2[0] * 3, at[1] - u2[1] * 3)
            if blocks.contains(ahead) or blocks.contains(behind) or not (near_pav.contains(ahead) and near_pav.contains(behind)):
                continue
            for u, sgn in ((u1, -1), (u2, 1)):
                fx, fy = at[0] + u[0] * 0.8 * sgn, at[1] + u[1] * 0.8 * sgn
                out = (u[1], -u[0])  # right of a ccw ring's edge is outside
                if not pav_union.buffer(1.0).contains(Point(fx + out[0] * 1.5, fy + out[1] * 1.5)):
                    continue
                item("plaque", fx + out[0] * 0.04, fy + out[1] * 0.04, math.atan2(out[1], out[0]), MODERN_FROM, OPEN)

    groups = group_items(items)
    out = paths.DATA_DIR / "3d" / f"streets-{area}.json"
    data = {
        "metadata": {
            "origin": list(origin),
            "scale": SCALE,
            "encoding": "Coordinates are integers: (lon - origin lon) x scale, (lat - origin lat) x scale. Lines and rings are flat [x, y, x, y...] arrays, each pair a delta from the previous one.",
            "sources": {
                "old_network": "Vasserot cadastre, street space (ALPAGE via Stanford Libraries, ODbL), about 1836",
                "pavements_crossings_bollards": "Ville de Paris, plan de voirie (Paris Data, ODbL)",
                "lamps": "Ville de Paris, éclairage public (Paris Data, ODbL)",
                "fountains_kiosks": "Ville de Paris, fontaines à boire and kiosques de presse (Paris Data, ODbL)",
                "roads_river": "IGN BD TOPO (Etalab 2.0)",
            },
            "history": HISTORY,
            "bridge_years": BRIDGE_YEARS,
            "item_types": ITEM,
        },
        "pavements": {"fields": ["kind", "from", "until", "rings", "kerbs"], "kinds": {"old_slabs": 0, "modern": 1}, "rows": old_pavements + modern_pavements},
        "gutters": {"fields": ["from", "until", "line"], "rows": gutters},
        "main_roads": {"fields": ["from", "rings"], "rows": main_roads},
        "crossings": {"fields": ["from", "stripe_angle_deg", "ring"], "rows": crossings},
        "centre_lines": {"fields": ["from", "line"], "rows": centre},
        "items": {
            "fields": ["type", "from", "until", "xy", "angle_deg", "param"],
            "note": "One row per type and life; xy is a flat delta-encoded list, angle_deg and param give one value per item (or are empty when all are 0).",
            "rows": groups,
        },
    }
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    size = out.stat().st_size
    log(f"streets: {dict(stats)} -> {out.relative_to(paths.REPO_ROOT)} ({size / 1000:.0f} kB)")
    return {"area": area, "file": f"3d/streets-{area}.json", "bytes": size, **{k: v for k, v in stats.items()}}


def group_items(items: list[list]) -> list[list]:
    """Items grouped by (type, from, until), sorted so that neighbours are
    close, with delta-encoded positions: [type, from, until, xy, angles, params]."""
    groups: dict[tuple[int, int, int], list[list]] = defaultdict(list)
    for t, x, y, a, start, end, param in items:
        groups[(t, start, end)].append([x, y, a, param])
    out = []
    for (t, start, end), rows in sorted(groups.items()):
        # Serpentine rows about 30 m high keep consecutive items near each other.
        band = 3000
        rows.sort(key=lambda r: (r[1] // band, r[0] if (r[1] // band) % 2 == 0 else -r[0]))
        xy: list[int] = []
        px = py = 0
        for x, y, _, _ in rows:
            xy += [x - px, y - py]
            px, py = x, y
        angles = [r[2] for r in rows]
        params = [r[3] for r in rows]
        out.append([t, start, end, xy, angles if any(angles) else [], params if any(params) else []])
    return out


def _road_facing(p, index, road_lines) -> float:
    """Direction from a point toward the nearest road centreline, radians."""
    near = index.query_nearest(p, max_distance=40)
    if not len(near):
        return 0.0
    ln = road_lines[int(near[0])][0]
    q = ln.interpolate(ln.project(p))
    return math.atan2(q.y - p.y, q.x - p.x)


def _place_on_pavements(polys, kind, spacing, radius, offset, avoid, start, end, item, kerbs=None, depth=0.0, face_road=False, kerb_side=None):
    """Rule-placed furniture: walk each pavement's kerb, every 2 m try a spot
    `offset` metres in from it, keep it if the pavement is at least `depth`
    deep there, a disc of `radius` fits, nothing else stands within 2 m and no
    item of the same kind within `spacing`."""
    from shapely.geometry import Point

    placed: list[tuple[float, float]] = []
    taken = list(avoid)
    for poly in polys:
        ring = list(poly.exterior.coords)
        ccw = poly.exterior.is_ccw
        for x, y, a in along(ring, 2.0, start=1.0):
            if kerbs is not None and kerbs.distance(Point(x, y)) > 0.3:
                continue
            nx, ny = (-math.sin(a), math.cos(a)) if ccw else (math.sin(a), -math.cos(a))  # into the pavement
            px, py = x + nx * offset, y + ny * offset
            p = Point(px, py)
            if not poly.contains(p.buffer(radius, quad_segs=4)):
                continue
            if depth and not poly.contains(Point(x + nx * depth, y + ny * depth)):
                continue
            if any((qx - px) ** 2 + (qy - py) ** 2 < spacing * spacing for qx, qy in placed):
                continue
            if any((qx - px) ** 2 + (qy - py) ** 2 < 4.0 for qx, qy in taken):
                continue
            facing = math.atan2(-ny, -nx) if face_road else a
            item(kind, px, py, facing, start, end)
            placed.append((px, py))
            taken.append((px, py))
    avoid.extend(placed)

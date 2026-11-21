"""Landmarks of the Île de la Cité through time.

Which buildings of the 3D massing model (python -m rpr model3d) are
landmarks, how the app draws them, and the dated parts no footprint holds:
spires, towers with pointed roofs, a dome, statues, flying buttresses, and
buildings that have since been demolished.

Buildings are found by name and location, not by hand: the APUR register of
public facilities (EQUIPEMENT_EMPRISE) names the Palais de Justice, the
Conciergerie, the Sainte-Chapelle, the Tribunal de commerce, the Préfecture
de police, the Hôtel-Dieu and the flower market, and every model building
lying mostly inside one of those outlines belongs to it. IGN BD TOPO marks
the round towers of the quai de l'Horloge ("Tour, donjon") and the octagonal
dome of the Tribunal de commerce.

Every date below is sourced or reasoned in a comment, and repeated in the
output so the app can show it. Where history gives no precise answer the
choice is conservative and says so.

Output: web/public/data/3d/landmarks-<area>.json
"""

from __future__ import annotations

import json
import math
import urllib.parse
from typing import Any, Callable, Iterable

from rpr import net, paths
from rpr.areas import area_file, manifest_file
from rpr.sources.model3d import AREAS

APUR_EQUIPMENT = "https://carto2.apur.org/apur/rest/services/OPENDATA/EQUIPEMENT_EMPRISE/MapServer/0/query"
WFS = "https://data.geopf.fr/wfs/ows"

# Wall styles drawn by landmarkFacade() in web/src/landmarkshaders.ts (20 and up).
STYLE = {
    "sainte-chapelle": 20,  # the chapel's side walls and apse: tall windows between buttresses
    "sainte-chapelle-front": 21,  # its west front: two-storey porch, the rose, the gable
    "tower": 22,  # medieval towers of the Conciergerie: ashlar, slit windows, machicolations
    "conciergerie": 23,  # gothic and gothic-revival walls of the Conciergerie
    "palais": 24,  # classical wings of the Palais de Justice
    "tribunal": 25,  # Tribunal de commerce
    "prefecture": 26,  # caserne de la Cité, now the Préfecture de police
    "hotel-dieu": 27,  # the new Hôtel-Dieu
    "dauphine": 28,  # brick and stone of the place Dauphine (1607)
    "morgue": 29,  # the morgue, a low classical building
    "pavilion-1873": 30,  # cast-iron and glass flower-market pavilions
    "pavilion-1924": 31,  # the low flower-market pavilions of 1924
    "stone": 32,  # plain dressed stone (buttresses, pedestals)
    "harlay": 33,  # Duc's west front of the Palais on the rue de Harlay
    "openwork": 34,  # lead-covered openwork of a spire's lower stages
}

# Facilities named in APUR's register (l_ee_maj, as spelled there) and the group each is.
EQUIPMENT = {
    "PALAIS DE JUSTICE": "palais",
    "CONCIERGERIE": "conciergerie",
    "SAINTE-CHAPELLE": "sainte-chapelle",
    "TRIBUNAL DE COMMERCE": "tribunal",
    "PRÉFECTURE DE POLICE": "prefecture",
    "HÔTEL DIEU": "hotel-dieu",
    "MARTCHÉ DE LA CITÉ": "flower-market",  # sic in the register
    "STATUE HENRI IV": "statue",
    "SQUARE DE LA PLACE DAUPHINE": "place-dauphine",
}
# A model building belongs to a facility when this share of it lies inside the outline.
INSIDE_SHARE = 0.5

# Dates of the landmark buildings. Sources:
# - Tribunal de commerce: Antoine-Nicolas Bailly, 1860-1865 (napoleon.org;
#   Wikipedia). Shown complete from 1865; the houses on its site go in 1860
#   with the rest of Haussmann's clearance, so the site is empty while it is built.
# - Caserne de la Cité (Préfecture de police since 1871): 1863-1867, Pierre-Victor
#   Calliat (Wikipedia; Structurae). Shown from 1867.
# - New Hôtel-Dieu: Émile Gilbert, then Arthur-Stanislas Diet, 1866-1877; the
#   Monuments historiques record gives the inauguration as 1877 (sources differ
#   between 1876 and 1878). Shown from 1877. APUR leaves the small buildings in
#   its courtyards undated; they cannot be older than the hospital, so they
#   appear with it.
# - Palais de Justice, west front on the rue de Harlay: Joseph-Louis Duc,
#   foundations 1857, the assize halls finished in 1868 (Structurae). Shown
#   from 1868 (the Commune's fire of 1871 and the vestibule's opening in 1875 are not modelled).
# - Conciergerie, the gothic-revival front on the quai de l'Horloge between the
#   Tour d'Argent and the Tour Bonbec: "the fortress-like appearance only dates
#   from about 1858" (Structurae). Shown from 1858.
# - Other wings of the Palais: APUR dates them 1851-1914 with the year 1900,
#   which is kept. The old buildings of the Palais they replaced (Vasserot
#   parcel PA3536 and the houses absorbed by the Palais) stay until the new
#   wing on their site appears, so the Palais never shows a gap.
# - Flower market: opened on the quai Desaix on 16 August 1809 (decree of 1808);
#   six cast-iron pavilions by André et Fleury in 1873; those were removed for
#   the Métro (Cité station, opened 1910), and the present low pavilions were
#   built in 1924, a few more in 1928 (Wikipedia, paris.fr, Paris la Douce).
#   The 1924 date is used for all six present pavilions.
TRIBUNAL_FROM = 1865
PREFECTURE_FROM = 1867
HOTEL_DIEU_FROM = 1877
HARLAY_FROM = 1868
QUAI_HORLOGE_FROM = 1858
FLOWER_MARKET = {"open": 1809, "pavilions": 1873, "metro": 1910, "today": 1924}

PALAIS_IDS = {
    # Duc's west front on the rue de Harlay (the place Dauphine side).
    "harlay": "apur:750050641",
    # The neo-gothic front on the quai de l'Horloge, from the twin towers to Bonbec.
    "quai_horloge": "apur:750067482",
    # The strip on the boulevard du Palais whose north end is the Tour de l'Horloge.
    "horloge_strip": "apur:750056836",
}
# Medieval and restored parts of the Conciergerie (APUR: before 1800 / 1801-1850).
CONCIERGERIE_STANDING = {"apur:750032832", "apur:750054239", "apur:750066113"}

# Place Dauphine (begun in 1607, last house finished 1616). Of its 32 houses only
# the two flanking the entrance from the Pont Neuf keep their brick and stone
# (Wikipedia; evous). The others were raised and refaced long before 1780 and
# keep the generic old-house facades.
DAUPHINE_PAVILIONS = ["apur:750072187", "apur:750050997"]
# The base of the triangle, the houses on the even side of the rue de Harlay,
# was demolished in 1874 to open the view of Duc's new front (Wikipedia: the
# houses had burned in the Commune's fighting of 1871). These are the Vasserot
# parcels of that block, read off the cadastre between the place and the
# rue de Harlay; the model otherwise drops every demolished house in 1860.
DAUPHINE_EAST_SIDE = [f"PA34{n}" for n in range(11, 28)]
DAUPHINE_EAST_UNTIL = 1874

# Notre-Dame: the high vessel (nave, transept, choir) and the aisles around it.
NOTRE_DAME_NAVE = "apur:750117318"
NOTRE_DAME_AISLES = ["apur:750072927", "apur:750078376", "apur:750040572"]
NOTRE_DAME_AXIS = 114.85  # compass bearing of the nave, west to east (as in site.py)

# Sainte-Chapelle: 36 m long, 17 m wide and 42.5 m high to the ridge; Lassus's
# spire rises 33.25 m above the ridge, to about 75.75 m (aviewoncities, MIT
# Dome record, ancient-history-sites). The medieval spire (rebuilt after the
# fire of 1630 on the 15th-century design) was pulled down in the Revolution:
# "about 1791" is the usual date, Hérodote gives 1793-94. Lassus's spire went
# up in 1853-1855 and is shown from 1855. The pre-Revolution spire is drawn
# with the same proportions, since Lassus followed the 15th-century design.
# The eaves height (28 m: the upper chapel's vault is 20.5 m high above a lower
# chapel of about 7 m) and the porch height are reasoned, not measured.
SAINTE_CHAPELLE = {
    "id": "apur:750039329",
    "eave": 28.0,
    "ridge": 42.5,
    "spire_tip": 75.75,
    "porch_depth": 4.5,
    "porch_height": 16.0,
    "old_spire_until": 1791,
    "new_spire_from": 1855,
}

# The towers on the quai de l'Horloge, east to west: Horloge, César, d'Argent,
# Bonbec (Wikipedia; visitparisregion). BD TOPO marks the three round ones.
# The Tour de l'Horloge (about 1350, 47 m) is square, with a steep roof; César
# and d'Argent (early 14th century) have conical roofs. Bonbec, the oldest
# (13th century), was raised by one storey and crenellated by Duc to match his
# new fronts (geneawiki; worldinparis): shown raised from 1858 with the quai
# front. Heights of the round towers are reasoned from APUR's maximum heights
# of the buildings around them (34-36 m), as no measured figure was found.
ROUND_TOWERS = ["Tour César", "Tour d’Argent", "Tour Bonbec"]
TOWER_WALL = {"Tour César": 23.0, "Tour d’Argent": 23.0, "Tour Bonbec": 21.0}
TOWER_TIP = {"Tour César": 34.5, "Tour d’Argent": 34.5, "Tour Bonbec": 31.0}
BONBEC_RAISED = {"wall": 26.0, "tip": 32.5, "from": QUAI_HORLOGE_FROM}
HORLOGE = {"size": 9.5, "wall": 30.0, "roof_tip": 43.5, "tip": 47.0, "clock_z": 14.0}

# Tribunal de commerce: an octagonal dome over the corner of the boulevard du
# Palais and the quai, on the axis of the boulevard de Sébastopol (sortiraparis).
# BD TOPO gives the octagon; APUR's maximum height of the building (46.7 m) is
# taken as the top of its lantern. The drum and dome proportions are reasoned.
DOME = {"lantern": 46.7, "drum_base": 22.0, "drum_top": 31.0, "dome_top": 42.5}

# Equestrian statue of Henri IV on the Pont Neuf. The first, placed in 1614
# (horse by Giambologna and Tacca), was pulled down and melted in 1792; its four
# bronze captives (Francheville) went with the pedestal and are now in the
# Louvre. Lemot's bronze was inaugurated on 25 August 1818 (paris.fr). Both
# face the place Dauphine (evous; sources differ, see README). Sizes are an
# estimate: a larger-than-life horse on a pedestal about 4 m high.
STATUES = [
    {"name": "Henri IV, first statue (1614)", "variant": 1614, "from": None, "until": 1792},
    {"name": "Henri IV, by Lemot (1818)", "variant": 1818, "from": 1818, "until": None},
]

# The morgue. From 1804 it stood at the start of the quai du Marché-Neuf, by the
# Pont Saint-Michel, at the water's edge so bodies could come by boat, "where the
# Préfecture now stands" (National Gallery of Art notes on Meryon's etching La
# Morgue; Mental Floss). In 1864 Haussmann had it rebuilt on the quai de
# l'Archevêché, at the eastern point of the island; it became the Institut
# médico-légal and moved to the quai de la Rapée in 1914, and the square de
# l'Île-de-France was laid out on its site that year (sortiraparis; pariszigzag).
# No plan was found: both are drawn as low classical buildings of a plausible
# size, placed by reasoning from those descriptions (centre, bearing, length,
# width in metres).
MORGUES = [
    {
        "name": "The Morgue, quai du Marché-Neuf",
        "centre": (2.34517, 48.85416),
        "bearing": 125.0,
        "size": (12.0, 8.0),
        "height": 6.0,
        "from": 1804,
        "until": 1864,
    },
    {
        "name": "The Morgue, quai de l’Archevêché",
        "centre": (2.35222, 48.85196),
        "bearing": 108.5,
        "size": (26.0, 12.0),
        "height": 7.5,
        "from": 1864,
        "until": 1914,
    },
]


# ---------------------------------------------------------------- geometry


class LonLat(tuple):
    """A longitude and latitude, written to the file at full (7-decimal) precision."""


class Local:
    """A flat frame in metres around a point (x east, y north), good to a few
    centimetres across the island."""

    def __init__(self, lon0: float, lat0: float):
        self.lon0, self.lat0 = lon0, lat0
        self.kx = 111320.0 * math.cos(math.radians(lat0))
        self.ky = 110574.0

    def xy(self, lon: float, lat: float) -> tuple[float, float]:
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def lonlat(self, x: float, y: float) -> LonLat:
        return LonLat((round(self.lon0 + x / self.kx, 7), round(self.lat0 + y / self.ky, 7)))

    def ring(self, coords: Iterable) -> list[tuple[float, float]]:
        return [self.xy(c[0], c[1]) for c in coords]


def heading(bearing: float) -> tuple[float, float]:
    """Unit vector (x east, y north) of a compass bearing in degrees."""
    r = math.radians(bearing)
    return (math.sin(r), math.cos(r))


def rectangle(centre: tuple[float, float], bearing: float, length: float, width: float) -> list[tuple[float, float]]:
    """Corners (counter-clockwise) of a rectangle whose long side follows a bearing."""
    ax, ay = heading(bearing)
    nx, ny = -ay, ax
    cx, cy = centre
    out = []
    for s, t in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        out.append((cx + ax * s * length / 2 + nx * t * width / 2, cy + ay * s * length / 2 + ny * t * width / 2))
    return out


def oriented(polygon) -> dict:
    """Centre, long-axis bearing (0-180°), length and width of a shapely
    polygon's minimum rotated rectangle."""
    rect = polygon.minimum_rotated_rectangle
    c = list(rect.exterior.coords)
    edges = [(c[i], c[i + 1]) for i in range(4)]
    (ax, ay), (bx, by) = max(edges, key=lambda e: math.dist(*e))
    length = math.dist((ax, ay), (bx, by))
    width = min(math.dist(*e) for e in edges)
    bearing = math.degrees(math.atan2(bx - ax, by - ay)) % 180
    return {"centre": (rect.centroid.x, rect.centroid.y), "bearing": bearing, "length": length, "width": width}


def share_inside(building, outline) -> float:
    """Share of a building's area inside an outline (0 for an empty building)."""
    if building.is_empty or building.area == 0:
        return 0.0
    return building.intersection(outline).area / building.area


def east_to_west(points: list[tuple[str, float, float]]) -> list[str]:
    """Keys of (key, x, y) points ordered from east to west."""
    return [k for k, _, _ in sorted(points, key=lambda p: -p[1])]


def regular_radius(area: float, sides: int) -> float:
    """Circumradius of a regular polygon of the given area (sides=0: a circle)."""
    if sides <= 0:
        return math.sqrt(area / math.pi)
    return math.sqrt(2 * area / (sides * math.sin(2 * math.pi / sides)))


def grid_points(polygon, step: float, margin: float = 1.0, offset: float = 0.5) -> list[tuple[float, float]]:
    """Points on a square grid inside a polygon, at least `margin` from its edge."""
    inner = polygon.buffer(-margin)
    if inner.is_empty:
        return []
    from shapely.geometry import Point

    x0, y0, x1, y1 = inner.bounds
    out = []
    y = y0 + step * offset
    while y <= y1:
        x = x0 + step * offset
        while x <= x1:
            if inner.contains(Point(x, y)):
                out.append((x, y))
            x += step
        y += step
    return out


def free_years(point, life: tuple[float, float], buildings: list[tuple[Any, float, float]]) -> tuple[float, float] | None:
    """The part of `life` (from, until) when no building stands on a point.

    `buildings` holds (geometry, from, until). A building raised during the
    span ends it; one pulled down during it starts it. None if nothing is left.
    """
    lo, hi = life
    for geom, b_from, b_until in buildings:
        if not geom.contains(point) or b_until <= lo or b_from >= hi:
            continue
        if b_from > lo:
            hi = min(hi, b_from)
        elif b_until < hi:
            lo = max(lo, b_until)
        else:
            return None
    return (lo, hi) if hi > lo else None


def cross_section(polygon, along: tuple[float, float], s: float, reach: float = 200.0) -> float:
    """Length of the polygon's cut across the axis `along` at position s."""
    from shapely.geometry import LineString

    ax, ay = along
    nx, ny = -ay, ax
    line = LineString([(ax * s - nx * reach, ay * s - ny * reach), (ax * s + nx * reach, ay * s + ny * reach)])
    return polygon.intersection(line).length


def farthest_hit(boundary, origin: tuple[float, float], direction: tuple[float, float], reach: float) -> float | None:
    """Distance from origin to the farthest crossing of a ray with a boundary."""
    from shapely.geometry import LineString

    ox, oy = origin
    dx, dy = direction
    hit = boundary.intersection(LineString([(ox, oy), (ox + dx * reach, oy + dy * reach)]))
    if hit.is_empty:
        return None
    pts = [g for g in getattr(hit, "geoms", [hit])]
    coords = [c for g in pts for c in g.coords]
    return max(math.dist(origin, c) for c in coords) if coords else None


def flying_buttresses(nave, aisles, bearing: float, spacing: float = 6.4, min_span: float = 4.0, max_span: float = 22.0) -> list[dict]:
    """Flying buttresses of a cathedral, from the outer edge of its aisles to
    the wall of its high vessel, in the footprints' own metres.

    Along the nave and the choir there is one on each side every `spacing`
    metres, skipping the crossing (the widest cut across the axis); around the
    apse they radiate from its centre. Returns {foot, head, apse} dicts.
    """
    from shapely.ops import unary_union

    a = heading(bearing)
    n = (-a[1], a[0])
    union = unary_union([nave, *aisles]).buffer(0.05).buffer(-0.05)
    vs = list(nave.exterior.coords)
    s_of = lambda p: p[0] * a[0] + p[1] * a[1]  # noqa: E731
    t_of = lambda p: p[0] * n[0] + p[1] * n[1]  # noqa: E731
    s0 = min(s_of(p) for p in vs)
    s1 = max(s_of(p) for p in vs)
    samples = [s0 + 0.5 * i for i in range(int((s1 - s0) / 0.5) + 1)]
    widths = [cross_section(nave, a, s) for s in samples]
    wmax = max(widths)
    st = samples[widths.index(wmax)]
    # The crossing and transept arms: where the cut is much wider than the nave.
    typical = sorted(widths)[len(widths) // 2]
    arms = [s for s, w in zip(samples, widths) if w > (typical + wmax) / 2 and abs(s - st) < 20]
    t_lo, t_hi = (min(arms), max(arms)) if arms else (st - 6, st + 6)
    # The apse: a half-circle as wide as the choir, ending at s1.
    choir_s = min(s1 - 2, t_hi + (s1 - t_hi) * 0.6)
    radius = cross_section(nave, a, choir_s) / 2
    mid_pts = [p for p in vs if abs(s_of(p) - choir_s) < 3] or vs
    t_c = (min(t_of(p) for p in mid_pts) + max(t_of(p) for p in mid_pts)) / 2
    s_apse = s1 - radius
    centre = lambda s: (a[0] * s + n[0] * t_c, a[1] * s + n[1] * t_c)  # noqa: E731

    out: list[dict] = []

    def add(origin, direction, apse: bool):
        head = farthest_hit(nave.exterior, origin, direction, 40)
        foot = farthest_hit(union.exterior if union.geom_type == "Polygon" else union.boundary, origin, direction, 50)
        if head is None or foot is None or not (min_span <= foot - head <= max_span):
            return
        h = (origin[0] + direction[0] * head, origin[1] + direction[1] * head)
        f = (origin[0] + direction[0] * foot, origin[1] + direction[1] * foot)
        out.append({"foot": f, "head": h, "apse": apse})

    stations = []
    s = s0 + 3.0
    while s < t_lo - 2.5:
        stations.append(s)
        s += spacing
    s = t_hi + 3.0
    while s <= s_apse + 0.01:
        stations.append(s)
        s += spacing
    for s in stations:
        for side in (1, -1):
            add(centre(s), (n[0] * side, n[1] * side), False)
    for deg in (-60, -30, 0, 30, 60):
        r = math.radians(deg)
        d = (a[0] * math.cos(r) - n[0] * math.sin(r), a[1] * math.cos(r) - n[1] * math.sin(r))
        add(centre(s_apse), d, True)
    return out


# ---------------------------------------------------------------- sources


def fetch_equipment(bbox: tuple[float, float, float, float]) -> list[dict]:
    params = {
        "where": "1=1",
        "geometry": ",".join(str(v) for v in bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "n_sq_ee,l_ee_maj",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": "2000",
    }
    return net.fetch_json(f"{APUR_EQUIPMENT}?{urllib.parse.urlencode(params)}", timeout=120).get("features", [])


def fetch_bdtopo_buildings(bbox: tuple[float, float, float, float], limit: int = 5000) -> list[dict]:
    """BD TOPO buildings in a box, in one request (paging without a sort order is refused)."""
    x0, y0, x1, y1 = bbox
    params = {
        "SERVICE": "WFS",
        "VERSION": "2.0.0",
        "REQUEST": "GetFeature",
        "TYPENAMES": "BDTOPO_V3:batiment",
        "BBOX": f"{y0},{x0},{y1},{x1},urn:ogc:def:crs:EPSG::4326",  # lat,lon order for this CRS
        "OUTPUTFORMAT": "application/json",
        "COUNT": str(limit),
    }
    out = net.fetch_json(f"{WFS}?{urllib.parse.urlencode(params)}", timeout=180).get("features", [])
    if len(out) >= limit:
        raise RuntimeError("BD TOPO query hit its record limit; use a smaller area")
    return out


def flower_market_1836(local: Local):
    """The Vasserot open space named "Marché aux Fleurs" (the quai Desaix), in local metres."""
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import Polygon

    from rpr.sources.model3d import VASSEROT_EPSG, VASSEROT_STEM, fix_text

    shp = paths.REPO_ROOT / "pipeline" / "cache" / "vasserot" / f"{VASSEROT_STEM}.shp"
    if not shp.exists():
        return None
    t = Transformer.from_crs(VASSEROT_EPSG, 4326, always_xy=True).transform
    reader = shapefile.Reader(str(shp), encoding="latin-1")
    fields = [f[0] for f in reader.fields[1:]]
    for sr in reader.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        if fix_text(rec.get("NOM_CODE2")) == "Marché aux Fleurs":
            pts = [local.xy(*t(x, y)) for x, y in sr.shape.points]
            return Polygon(pts).buffer(0)
    return None


# ---------------------------------------------------------------- build


def _plain(v: Any) -> Any:
    """Round lengths and angles to the centimetre for a compact file; keep coordinates whole."""
    if isinstance(v, LonLat):
        return list(v)
    if isinstance(v, float):
        return round(v, 2)
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    return v


def assign_buildings(model: list[dict], facilities: dict[str, list], local: Local) -> list[dict]:
    """Style and dates for each model building that is part of a landmark.

    `model` holds the model's features as {id, kind, from, geometry (local
    shapely)}; `facilities` maps a group to its outlines (local shapely).
    """
    out: dict[str, dict] = {}

    def put(bid: str, **kw):
        entry = out.setdefault(bid, {"id": bid})
        entry.update({k: v for k, v in kw.items() if v is not None})

    for b in model:
        if not b["id"].startswith("apur:"):
            continue
        group = next((g for g, outlines in facilities.items() if any(share_inside(b["geometry"], o) >= INSIDE_SHARE for o in outlines)), None)
        if group is None:
            continue
        later = b["kind"] in ("later", "undated")
        if group == "sainte-chapelle":
            put(b["id"], landmark="Sainte-Chapelle", style=STYLE["sainte-chapelle"], draw="custom", note="Drawn in full by the landmarks module.")
        elif group in ("palais", "conciergerie"):
            if b["id"] == PALAIS_IDS["harlay"]:
                put(b["id"], landmark="Palais de Justice", style=STYLE["harlay"], **{"from": HARLAY_FROM}, replaces=True, note="West front by Joseph-Louis Duc, 1857-1868.")
            elif b["id"] == PALAIS_IDS["quai_horloge"]:
                put(b["id"], landmark="Conciergerie", style=STYLE["conciergerie"], **{"from": QUAI_HORLOGE_FROM}, replaces=True, note="Gothic-revival front on the quai de l'Horloge, about 1858.")
            elif b["id"] in CONCIERGERIE_STANDING or (group == "conciergerie" and not later):
                put(b["id"], landmark="Conciergerie", style=STYLE["conciergerie"])
            elif later:
                put(b["id"], landmark="Palais de Justice", style=STYLE["palais"], replaces=True, note="Date from APUR (1851-1914).")
            else:
                put(b["id"], landmark="Palais de Justice", style=STYLE["palais"])
        elif group == "tribunal" and later:
            main = b["kind"] == "later" and (b.get("from") or 0) < 1915
            put(b["id"], landmark="Tribunal de commerce", style=STYLE["tribunal"], **({"from": TRIBUNAL_FROM} if main else {}))
        elif group == "prefecture" and later:
            put(b["id"], landmark="Préfecture de police", style=STYLE["prefecture"], **{"from": PREFECTURE_FROM})
        elif group == "hotel-dieu" and later:
            put(b["id"], landmark="Hôtel-Dieu", style=STYLE["hotel-dieu"], **{"from": HOTEL_DIEU_FROM})
        elif group == "flower-market" and later:
            put(b["id"], landmark="Flower market", style=STYLE["pavilion-1924"], **{"from": FLOWER_MARKET["today"]}, roof="hip", roof_material="zinc", height=4.5)
    ids = {b["id"] for b in model}
    for bid in DAUPHINE_PAVILIONS:
        if bid in ids:
            put(bid, landmark="Place Dauphine", style=STYLE["dauphine"], note="One of the two houses at the entrance that keep their brick and stone of 1607.")
    # Notre-Dame's aisles get low roofs so the flying buttresses clear them.
    for bid in NOTRE_DAME_AISLES:
        if bid in ids:
            put(bid, landmark="Notre-Dame de Paris", roof="hip")
    return sorted(out.values(), key=lambda e: e["id"])


def build(area: str = "cite", log: Callable[[str], Any] = print) -> dict:
    from shapely.geometry import Point, Polygon, shape

    cfg = AREAS[area]
    bbox = cfg["bbox"]
    local = Local((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2)

    def to_local(geom: dict):
        from shapely.ops import unary_union

        g = shape(geom)
        parts = [Polygon(local.ring(p.exterior.coords), [local.ring(h.coords) for h in p.interiors]) for p in getattr(g, "geoms", [g])]
        u = unary_union(parts)
        return u if u.is_valid else u.buffer(0)

    model_path = area_file(area, "model")
    features = json.loads(model_path.read_text())["features"]
    model = [
        {
            "id": f["properties"]["id"],
            "kind": f["properties"]["kind"],
            "from": f["properties"].get("from"),
            "until": f["properties"].get("until"),
            "height": f["properties"].get("height"),
            "geometry": to_local(f["geometry"]),
        }
        for f in features
    ]
    by_id = {b["id"]: b for b in model}

    # 1. Facilities by name.
    facilities: dict[str, list] = {}
    for f in fetch_equipment(bbox):
        group = EQUIPMENT.get((f["properties"].get("l_ee_maj") or "").strip())
        if group and f.get("geometry"):
            facilities.setdefault(group, []).append(to_local(f["geometry"]))
    missing = [g for g in set(EQUIPMENT.values()) if g not in facilities]
    if missing:
        log(f"landmarks: facilities not found in APUR: {', '.join(sorted(missing))}")
    buildings = assign_buildings(model, {k: v for k, v in facilities.items() if k not in ("statue", "place-dauphine")}, local)

    parts: list[dict] = []
    notes: list[str] = []

    # 2. The Sainte-Chapelle, from its footprint.
    sc = by_id.get(SAINTE_CHAPELLE["id"])
    if sc is not None:
        o = oriented(sc["geometry"])
        # The apse is at the east end: point the axis between north-east and south-west.
        bearing = o["bearing"] if 45 <= o["bearing"] <= 225 else (o["bearing"] + 180) % 360
        parts.append(
            {
                "kind": "chapel",
                "name": "Sainte-Chapelle",
                "id": SAINTE_CHAPELLE["id"],
                "centre": local.lonlat(*o["centre"]),
                "bearing": bearing,
                "length": o["length"],
                "width": o["width"],
                "eave": SAINTE_CHAPELLE["eave"],
                "ridge": SAINTE_CHAPELLE["ridge"],
                "porch": [SAINTE_CHAPELLE["porch_depth"], SAINTE_CHAPELLE["porch_height"]],
                "spires": [
                    {"tip": SAINTE_CHAPELLE["spire_tip"], "from": None, "until": SAINTE_CHAPELLE["old_spire_until"], "note": "Medieval spire, pulled down in the Revolution (about 1791)."},
                    {"tip": SAINTE_CHAPELLE["spire_tip"], "from": SAINTE_CHAPELLE["new_spire_from"], "until": None, "note": "Spire by Jean-Baptiste Lassus, 1853-1855."},
                ],
            }
        )

    # 3. Towers of the quai de l'Horloge.
    bd = fetch_bdtopo_buildings(bbox)
    conc = facilities.get("conciergerie", []) + facilities.get("palais", [])
    round_towers = []
    for f in bd:
        if f["properties"].get("nature") != "Tour, donjon":
            continue
        g = to_local(f["geometry"])
        if any(o.buffer(3).contains(g.centroid) for o in conc):
            round_towers.append((g.centroid.x, g.centroid.y, g.area))
    names = east_to_west([(str(i), x, y) for i, (x, y, _) in enumerate(round_towers)])
    if len(names) == 3:
        for name, key in zip(ROUND_TOWERS, names):
            x, y, a = round_towers[int(key)]
            r = regular_radius(a, 0) + 0.3  # a little wider than the BD TOPO outline, so the tower covers the wall it stands in
            base = {"kind": "tower", "name": name, "at": local.lonlat(x, y), "radius": r}
            if name == "Tour Bonbec":
                parts.append({**base, "wall": TOWER_WALL[name], "tip": TOWER_TIP[name], "roof": "cone", "from": None, "until": BONBEC_RAISED["from"], "note": "Before Duc raised it by one storey."})
                parts.append({**base, "wall": BONBEC_RAISED["wall"], "tip": BONBEC_RAISED["tip"], "roof": "battlements", "from": BONBEC_RAISED["from"], "until": None, "note": "Raised and crenellated by Duc, about 1858."})
            else:
                parts.append({**base, "wall": TOWER_WALL[name], "tip": TOWER_TIP[name], "roof": "cone", "from": None, "until": None})
    else:
        notes.append(f"expected 3 round towers on the quai de l'Horloge, found {len(round_towers)}")
    strip = by_id.get(PALAIS_IDS["horloge_strip"])
    if strip is not None:
        o = oriented(strip["geometry"])
        ax, ay = heading(o["bearing"])
        # The strip runs along the boulevard; the tower is its end toward the quai (north).
        if ay < 0:
            ax, ay = -ax, -ay
        cx, cy = o["centre"]
        size = HORLOGE["size"]
        ex, ey = ay, -ax  # to the right of the strip's northward axis: east, the boulevard side
        # The tower is the strip's north end, its east face on the boulevard, as wide as it is deep.
        shift = (o["width"] - size) / 2
        centre = (cx + ax * (o["length"] - size) / 2 + ex * shift, cy + ay * (o["length"] - size) / 2 + ey * shift)
        bearing = math.degrees(math.atan2(ax, ay))
        corners = rectangle(centre, bearing, size + 0.6, size + 0.6)
        parts.append(
            {
                "kind": "square-tower",
                "name": "Tour de l’Horloge",
                "corners": [local.lonlat(*c) for c in corners],
                "wall": HORLOGE["wall"],
                "roof_tip": HORLOGE["roof_tip"],
                "tip": HORLOGE["tip"],
                "clock": {"facing": [round(ex, 4), round(ey, 4)], "z": HORLOGE["clock_z"]},
                "from": None,
                "until": None,
                "note": "About 1350; Paris's first public clock, its dial decorated by Germain Pilon (1585).",
            }
        )

    # 4. The dome of the Tribunal de commerce.
    trib = facilities.get("tribunal", [])
    octagons = []
    for f in bd:
        g = to_local(f["geometry"])
        # An octagon: 8 corners (9 points closing the ring), give or take a split edge.
        if g.geom_type == "Polygon" and 120 < g.area < 300 and len(g.exterior.coords) in range(8, 12) and any(o.contains(g.centroid) for o in trib):
            octagons.append(g)
    if octagons:
        g = max(octagons, key=lambda q: q.area)
        c = g.centroid
        first = g.exterior.coords[0]
        rotation = math.degrees(math.atan2(first[0] - c.x, first[1] - c.y))
        parts.append(
            {
                "kind": "dome",
                "name": "Dome of the Tribunal de commerce",
                "at": local.lonlat(c.x, c.y),
                "radius": regular_radius(g.area, 8),
                "rotation": rotation,
                **DOME,
                "from": TRIBUNAL_FROM,
                "until": None,
            }
        )
    else:
        notes.append("no octagonal dome found in BD TOPO inside the Tribunal de commerce")

    # 5. Henri IV on the Pont Neuf, facing the place Dauphine.
    statue = facilities.get("statue", [])
    square = facilities.get("place-dauphine", [])
    if statue:
        sp = statue[0].centroid
        hd = 120.0
        if square:
            q = square[0].centroid
            hd = math.degrees(math.atan2(q.x - sp.x, q.y - sp.y)) % 360
        for s in STATUES:
            parts.append({"kind": "statue", **s, "at": local.lonlat(sp.x, sp.y), "heading": hd})

    # 6. The two morgues.
    for m in MORGUES:
        c = local.xy(*m["centre"])
        ring = rectangle(c, m["bearing"], *m["size"])
        parts.append(
            {
                "kind": "building",
                "name": m["name"],
                "polygon": [local.lonlat(*p) for p in ring],
                "height": m["height"],
                "roof": "hip",
                "roof_material": "zinc",
                "style": STYLE["morgue"],
                "from": m["from"],
                "until": m["until"],
                "note": "Position and size reasoned from descriptions; no plan found.",
            }
        )

    # 7. The flower market: stalls on the quai Desaix, the 1873 pavilions, stalls again during the Métro works.
    pavilion_ids = [b["id"] for b in buildings if b.get("landmark") == "Flower market"]
    if pavilion_ids:
        parts.append(
            {
                "kind": "pavilions",
                "name": "Flower market pavilions (André et Fleury, 1873)",
                "ids": pavilion_ids,
                "height": 7.5,
                "style": STYLE["pavilion-1873"],
                "from": FLOWER_MARKET["pavilions"],
                "until": FLOWER_MARKET["metro"],
                "note": "Six cast-iron pavilions; drawn on the footprints of today's six, which stand on the same ground.",
            }
        )
    # Stalls stand only where no building does: a building raised on the spot ends them.
    overrides = {b["id"]: b for b in buildings}
    standing = []
    for b in model:
        o = overrides.get(b["id"], {})
        if b["kind"] == "standing":
            life = (-1e4, 1e4)
        elif b["kind"] == "reconstructed":
            life = (-1e4, float(b.get("until") or 1860))
        else:
            life = (float(o.get("from", b.get("from") or 1851)), 1e4)
        standing.append((b["geometry"], *life))

    def stall_items(points, frm: int, until: int) -> list:
        items = []
        for x, y in points:
            span = free_years(Point(x, y), (frm, until), standing)
            if span:
                items.append([local.lonlat(x, y), int(span[0]), int(span[1])])
        return items

    quai = flower_market_1836(local)
    if quai is not None:
        parts.append(
            {
                "kind": "stalls",
                "name": "Flower market on the quai Desaix",
                "fields": ["at", "from", "until"],
                "items": stall_items(grid_points(quai, 4.0, margin=1.5), FLOWER_MARKET["open"], FLOWER_MARKET["pavilions"]),
                "note": "Open-air stalls from 1809; the outline is the Vasserot cadastre's \"Marché aux Fleurs\".",
            }
        )
    market = facilities.get("flower-market", [])
    if market:
        from shapely.ops import unary_union

        free = market[0].difference(unary_union([by_id[i]["geometry"].buffer(1.0) for i in pavilion_ids if i in by_id]))
        parts.append(
            {
                "kind": "stalls",
                "name": "Flower market stalls during the Métro works",
                "fields": ["at", "from", "until"],
                "items": stall_items(grid_points(free, 4.0, margin=1.0), FLOWER_MARKET["metro"], FLOWER_MARKET["today"]),
                "note": "Reasoned: the 1873 pavilions went with the Métro works (Cité station, 1910) and new ones came in 1924.",
            }
        )

    # 8. Notre-Dame's flying buttresses.
    nave = by_id.get(NOTRE_DAME_NAVE)
    aisles = [by_id[i] for i in NOTRE_DAME_AISLES if i in by_id]
    if nave is not None and aisles:
        fl = flying_buttresses(nave["geometry"], [b["geometry"] for b in aisles], NOTRE_DAME_AXIS)
        items = []
        for f in fl:
            fx, fy = f["foot"]
            hx, hy = f["head"]
            # The pier stands on the aisle's outer wall: as high as that aisle, plus a little.
            probe = Point(fx - (fx - hx) * 0.05, fy - (fy - hy) * 0.05)
            under = next((b for b in aisles if b["geometry"].buffer(0.5).contains(probe)), aisles[0])
            z_foot = float(under["height"]) + 1.5
            z_head = float(nave["height"]) * 0.78
            items.append([local.lonlat(fx, fy), local.lonlat(hx, hy), round(z_foot, 1), round(z_head, 1), 1 if f["apse"] else 0])
        parts.append(
            {
                "kind": "flyers",
                "name": "Flying buttresses of Notre-Dame",
                "fields": ["foot", "head", "foot_z", "head_z", "apse"],
                "items": items,
                "note": "Placed from the APUR footprints: one per bay along nave and choir, radiating round the apse. Heights from the aisle and nave heights.",
            }
        )

    vasserot = [{"parcels": DAUPHINE_EAST_SIDE, "until": DAUPHINE_EAST_UNTIL, "note": "East side of the place Dauphine (even side of the rue de Harlay), demolished in 1874."}]
    out = {
        "metadata": {
            "area": cfg["name"],
            "styles": STYLE,
            "sources": "APUR EQUIPEMENT_EMPRISE and EMPRISE_BATIE_PARIS (ODbL), IGN BD TOPO (Etalab 2.0), Vasserot cadastre/ALPAGE (ODbL); dates from the sources cited in rpr/sources/landmarks.py and the README.",
            "notes": notes,
        },
        "buildings": buildings,
        "vasserot": vasserot,
        "parts": parts,
    }
    path = area_file(area, "landmarks")
    text = json.dumps(_plain(out), ensure_ascii=False, separators=(",", ":"))
    path.write_text(text + "\n")
    for n in notes:
        log(f"landmarks: {n}")
    log(f"landmarks: {len(buildings)} buildings, {len(parts)} parts -> {path.relative_to(paths.REPO_ROOT)} ({len(text) / 1e3:.0f} kB)")
    return {"area": area, "file": manifest_file(area, "landmarks"), "buildings": len(buildings), "parts": len(parts)}

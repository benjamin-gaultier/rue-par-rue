"""Period vehicles and boats for the 3D city: where they stand, and when.

Nothing here is a record of a particular cart or boat. The types, their
dates and their density come from the archive photographs (see README,
"Vehicles and boats") and from transport history; the places are street
kerbs, junctions, bridges and quays of the right period:

- 1780-1859: the street space of the Vasserot cadastre (1810-1836, ALPAGE,
  "Emprise de la voirie"), the only street plan of the old Cité we have.
  Vehicles stand along its edges; moving ones follow today's centrelines
  only where they run inside that street space.
- 1860 onwards: IGN BD TOPO road centrelines (troncon_de_route), with
  their carriageway width: parked along both kerbs of wide streets, one
  kerb of narrow ones, none in lanes under 4.5 m.
- Boats: moored along the banks of today's river (BD TOPO), clear of the
  bridges; moving boats follow lanes some way out from the banks.

Every vehicle is checked against the buildings of the massing model
(cite-1836.geojson): its life is cut to the years when no building stands
on its footprint, so nothing stands inside a house. Only boats go on the
water, and vehicles go on a bridge only in years when that bridge carried
traffic (BRIDGES below).
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Callable, Iterable

from rpr import net, paths
from rpr.areas import area_file, file_name, manifest_file
from rpr.sources.model3d import AREAS

CACHE = paths.REPO_ROOT / "pipeline" / "cache" / "vehicles"
VOIRIE_DRUID = "gy980ch3900"
VOIRIE_STEM = "Vasserot_Emprise_de_la_voirie"
VASSEROT_EPSG = 27561
STACKS = "https://stacks.stanford.edu/file/druid:{druid}/{name}"
OPEN = 10000

# --------------------------------------------------------------- types
#
# Each type: years it is shown (from, until), footprint (length, width in
# metres, horses included) and a note giving the source of the dates. The
# app draws each type with its own model (web/src/vehiclemodels.ts); the
# order of this list is the type index in the data file.

TYPES: list[dict[str, Any]] = [
    # Street
    {"id": "handcart", "from": 1780, "until": 1940, "length": 2.6, "width": 1.3,
     "note": "Voiture à bras. Marville 1865-68 (rue Constantine, rue du Fouarre); Atget 1898 (quai aux Fleurs); "
             "a 'Location de voitures à bras' sign rue des Chantres in 1923 (Atget). End reasoned: rare after the 1930s."},
    {"id": "cart", "from": 1780, "until": 1935, "length": 5.4, "width": 1.9,
     "note": "Two-wheeled horse cart or tip-cart (tombereau). Marville 1858 (place du Châtelet); Atget: coal cart quai de la "
             "Tournelle, carts at the port de l'Hôtel-de-Ville, tombereaux 1913. Often unhitched, shafts down. End reasoned."},
    {"id": "tiltcart", "from": 1780, "until": 1930, "length": 5.6, "width": 2.0,
     "note": "Covered cart with a canvas tilt (charrette bâchée). Marville 1865-68, rue Constantine and rue de la Cité."},
    {"id": "fiacre", "from": 1780, "until": 1930, "length": 5.6, "width": 1.8,
     "note": "Horse cab (fiacre, coupé), one horse. Atget c.1910: Compagnie générale des voitures cabs with taximeters; "
             "a cab rank on the quai Malaquais. Horse cabs dwindled in the 1920s; end reasoned."},
    {"id": "omnibus", "from": 1828, "until": 1913, "length": 8.6, "width": 2.2,
     "note": "Horse omnibus. Paris omnibuses from 1828 (Entreprise générale des omnibus); Compagnie générale des omnibus "
             "from 1855; upper deck (impériale) from 1853; last horse omnibus 11 January 1913. Marville 1858 (CGO office, "
             "Madeleine-Bastille omnibus), Atget 1898 (omnibus, place Saint-Sulpice)."},
    {"id": "car_early", "from": 1900, "until": 1936, "length": 3.9, "width": 1.6,
     "note": "Early motor car. Rare before 1900; an Atget view of the quai d'Orléans shows one parked (catalogued 1885-1925). "
             "Albert-Kahn 1917: a Renault parked on a quay."},
    {"id": "taxi", "from": 1905, "until": 1932, "length": 3.9, "width": 1.6,
     "note": "Motor taxi of the Renault AG kind. Motor cabs with taximeters from 1905; the type was common until the "
             "later 1920s. Colours reasoned (red and black)."},
    {"id": "motorbus", "from": 1906, "until": 1937, "length": 8.2, "width": 2.3,
     "note": "Early motor bus (Schneider kind). First CGO motor bus line in June 1906; Schneider PB2 buses from 1911 "
             "to the 1930s; green and cream (Albert-Kahn 1920, bus station place de la Madeleine)."},
    {"id": "van_early", "from": 1910, "until": 1955, "length": 4.6, "width": 1.8,
     "note": "Motor delivery van. Reasoned: motor vans replaced carts from the 1910s."},
    {"id": "car_mid", "from": 1934, "until": 1980, "length": 4.3, "width": 1.7,
     "note": "Mid-century car (Traction, 4CV, 2CV, DS shapes). Reasoned from the general history of Paris traffic."},
    {"id": "bus_mid", "from": 1934, "until": 1971, "length": 9.4, "width": 2.4,
     "note": "Platform bus of the Renault TN kind: from the early 1930s until the last rear-platform buses in 1971."},
    {"id": "van_mid", "from": 1950, "until": 1990, "length": 4.4, "width": 1.8,
     "note": "Corrugated or rounded delivery van (Citroën H, 2CV van shapes). Reasoned."},
    {"id": "car_modern", "from": 1972, "until": OPEN, "length": 4.2, "width": 1.8,
     "note": "Modern car. Reasoned."},
    {"id": "bus_modern", "from": 1971, "until": OPEN, "length": 11.5, "width": 2.5,
     "note": "Modern city bus. Many RATP lines cross the Cité (rue de la Cité, boulevard du Palais)."},
    {"id": "van_modern", "from": 1985, "until": OPEN, "length": 5.0, "width": 2.0,
     "note": "Modern van. Reasoned."},
    # River
    {"id": "barge", "from": 1780, "until": OPEN, "length": 36.0, "width": 5.0,
     "note": "Péniche. Atget 1903 (quai des Orfèvres, quai des Célestins, quai des Grands-Augustins): wooden barges "
             "moored at the ports, often with a mast; today moored as houseboats."},
    {"id": "lavoir", "from": 1780, "until": 1936, "length": 26.0, "width": 6.4,
     "note": "Wash-boat (bateau-lavoir): open washing deck, drying loft above. Atget before 1906 by the pont Saint-Michel; "
             "Albert-Kahn 1914 (pont Marie) and 1923 (quai de Bourbon). The last Paris wash-boats went in the 1930s; end "
             "reasoned."},
    {"id": "bath", "from": 1780, "until": 1930, "length": 42.0, "width": 9.0,
     "note": "Floating baths (bains Vigier, bains de la Samaritaine): Atget c.1900-1910. End reasoned."},
    {"id": "steamer", "from": 1867, "until": 1934, "length": 30.0, "width": 4.4,
     "note": "Steam river bus (bateau-mouche, bateau-omnibus): introduced for the 1867 Exposition universelle; the "
             "Compagnie des bateaux parisiens ran its last services in 1934 (approximate)."},
    {"id": "skiff", "from": 1780, "until": OPEN, "length": 5.5, "width": 1.6,
     "note": "Small rowing boat: alongside barges and baths in Atget's views."},
    {"id": "tourboat", "from": 1950, "until": OPEN, "length": 36.0, "width": 7.0,
     "note": "Glass-roofed sightseeing boat: bateaux-mouches again from 1949, landings at the square du Vert-Galant "
             "and the port de Montebello."},
]
TYPE_INDEX = {t["id"]: i for i, t in enumerate(TYPES)}
BOATS = {"barge", "lavoir", "bath", "steamer", "skiff", "tourboat"}
LONG = {"omnibus", "motorbus", "bus_mid", "bus_modern"}  # never parked in narrow streets
HORSE_DRAWN = {"cart", "tiltcart", "fiacre", "omnibus"}
UNHITCH = {"cart": 0.55, "tiltcart": 0.3}  # share of parked carts standing without their horse

# ---------------------------------------------------------------- eras
#
# What stands in the street in each period, as relative weights, and how
# often a kerb is taken. Before 1906 the photographs show few vehicles in
# the narrow streets of the Cité (Marville's long exposures also lose the
# moving ones), more on the quays and bridges. Parked cars fill the kerbs
# from the 1950s; today the Cité's streets are partly closed to traffic.

ERAS: list[dict[str, Any]] = [
    {"from": 1780, "until": 1828, "kerb": (0.05, 0.10), "move": 0.5,
     "mix": {"handcart": 3, "cart": 4, "tiltcart": 2, "fiacre": 2}},
    {"from": 1828, "until": 1860, "kerb": (0.06, 0.12), "move": 0.7,
     "mix": {"handcart": 3, "cart": 4, "tiltcart": 2, "fiacre": 2.5, "omnibus": 0.8}},
    {"from": 1860, "until": 1890, "kerb": (0.07, 0.14), "move": 1.0,
     "mix": {"handcart": 3, "cart": 4, "tiltcart": 2, "fiacre": 3, "omnibus": 1.2}},
    {"from": 1890, "until": 1906, "kerb": (0.08, 0.16), "move": 1.2,
     "mix": {"handcart": 3, "cart": 3.5, "tiltcart": 2, "fiacre": 3.5, "omnibus": 1.2, "car_early": 0.3}},
    {"from": 1906, "until": 1913, "kerb": (0.09, 0.18), "move": 1.4,
     "mix": {"handcart": 2.5, "cart": 3, "tiltcart": 1.5, "fiacre": 2.5, "omnibus": 0.7, "motorbus": 0.5, "taxi": 1.5,
             "car_early": 1, "van_early": 0.4}},
    {"from": 1913, "until": 1925, "kerb": (0.10, 0.20), "move": 1.6,
     "mix": {"handcart": 2, "cart": 2, "tiltcart": 1, "fiacre": 1, "motorbus": 1, "taxi": 2.5, "car_early": 2.5,
             "van_early": 1}},
    {"from": 1925, "until": 1935, "kerb": (0.16, 0.26), "move": 1.8,
     "mix": {"handcart": 1, "cart": 1, "motorbus": 1, "taxi": 2, "car_early": 4, "van_early": 1.5}},
    {"from": 1935, "until": 1950, "kerb": (0.25, 0.35), "move": 1.6,
     "mix": {"car_mid": 5, "van_early": 1.5, "bus_mid": 0.8, "handcart": 0.3}},
    {"from": 1950, "until": 1975, "kerb": (0.55, 0.70), "move": 2.0,
     "mix": {"car_mid": 7, "van_mid": 1.5, "bus_mid": 0.8, "car_modern": 0.6, "bus_modern": 0.3}},
    {"from": 1975, "until": 2000, "kerb": (0.50, 0.62), "move": 2.0,
     "mix": {"car_modern": 7, "car_mid": 0.6, "van_mid": 0.6, "van_modern": 1, "bus_modern": 0.8}},
    {"from": 2000, "until": OPEN, "kerb": (0.30, 0.38), "move": 1.6,
     "mix": {"car_modern": 5, "van_modern": 1.5, "bus_modern": 0.8}},
]
VASSEROT_UNTIL = 1860  # the model's old houses go in 1860, and BD TOPO streets take over

# Boats moored along the banks, per period.
BOAT_ERAS: list[dict[str, Any]] = [
    {"from": 1780, "until": 1867, "moor": 0.40, "move": 0.6, "mix": {"barge": 4, "lavoir": 2.5, "bath": 0.7, "skiff": 2}},
    {"from": 1867, "until": 1906, "moor": 0.40, "move": 1.0,
     "mix": {"barge": 4, "lavoir": 2, "bath": 0.6, "skiff": 2, "steamer": 0.4}},
    {"from": 1906, "until": 1936, "moor": 0.35, "move": 1.0,
     "mix": {"barge": 4, "lavoir": 1, "bath": 0.3, "skiff": 1.5, "steamer": 0.4}},
    {"from": 1936, "until": 1950, "moor": 0.30, "move": 0.6, "mix": {"barge": 5, "skiff": 1}},
    {"from": 1950, "until": OPEN, "moor": 0.20, "move": 0.6, "mix": {"barge": 3, "tourboat": 0.5, "skiff": 0.4}},
]
MOVING_BOATS = {"barge": 2, "steamer": 3, "tourboat": 3, "skiff": 0.5}  # weights among moving boats
SPEED = {"handcart": 1.2, "cart": 1.6, "tiltcart": 1.6, "fiacre": 2.6, "omnibus": 2.0, "car_early": 3.5, "taxi": 3.8,
         "motorbus": 3.0, "van_early": 3.3, "car_mid": 4.5, "bus_mid": 4.0, "van_mid": 4.3, "car_modern": 5.0,
         "bus_modern": 4.5, "van_modern": 4.8, "barge": 1.6, "steamer": 3.2, "tourboat": 2.8, "skiff": 1.0}

# Years each bridge carried wheeled traffic on its present line (names as
# site.bridge_name gives them). Missing bridges get no vehicles.
BRIDGES: dict[str, tuple[int, int, str]] = {
    "Pont Neuf": (-OPEN, OPEN, "1607"),
    "Pont Notre-Dame": (-OPEN, OPEN, "1507; rebuilt 1853 and 1910-1919"),
    "Pont au Change": (-OPEN, OPEN, "rebuilt 1858-1860 on the same line"),
    "Pont Saint-Michel": (-OPEN, OPEN, "rebuilt 1857"),
    "Petit-Pont": (-OPEN, OPEN, "rebuilt 1853"),
    "Pont de la Tournelle": (-OPEN, OPEN, "1656; rebuilt 1928"),
    "Pont Marie": (-OPEN, OPEN, "1635"),
    "Pont de l’Archevêché": (1828, OPEN, "opened 1828"),
    "Pont d’Arcole": (1856, OPEN, "a footbridge from 1828; the iron road bridge opened in 1856 (works 1854-1856)"),
    "Pont Louis-Philippe": (1862, OPEN, "rebuilt 1860-1862; the earlier suspension bridge burned in 1848"),
    "Pont au Double": (1883, OPEN, "a footbridge before the cast-iron road bridge of 1883"),
    # Pont Saint-Louis: a series of footbridges, closed to cars today.
}

# Structures the island model draws (site.BRIDGES) that carried no carts:
# footbridges, and the years houses lined the roadway (vehicles are placed
# by the parapets, where the houses stood).
FOOTBRIDGE_KINDS = {"suspension", "truss", "timber"}


def traffic_spans(key: str, outer: tuple[float, float]) -> list[tuple[float, float]]:
    """Years wheeled traffic crossed a bridge: `outer` (BRIDGES above), cut to
    the years the island model draws a road bridge there with no houses. A
    bridge being rebuilt is a gap; a crossing with no history keeps `outer`."""
    from rpr.sources.site import BRIDGES as STRUCTURES

    history = (STRUCTURES.get(key.upper()) or {}).get("history")
    if not history:
        return [outer]
    spans = []
    for h in history:
        if h.get("kind") in FOOTBRIDGE_KINDS:
            continue
        s = h.get("from") if h.get("from") is not None else -OPEN
        e = h.get("until") if h.get("until") is not None else OPEN
        if h.get("houses_until"):
            s = max(s, h["houses_until"])
        span = intersect((s, e), outer)
        if span:
            spans.append(span)
    merged: list[tuple[float, float]] = []
    for s, e in sorted(spans):
        if merged and s <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return merged


# Road segments that are not streets at the level of the 3D ground.
SKIP_NATURES = {"Sentier", "Escalier", "Bac ou liaison maritime"}
SKIP_PREFIXES = ("PORT ", "VOIE GEORGES POMPIDOU", "QUAI MADELEINE DELBREL", "QUAI MADELEINE DELBRÊL", "PROM ")

KERB_GAP = 0.25  # between a parked vehicle and the kerb line
SLOT = 6.5  # length of an empty kerb slot when walking along a kerb
JUNCTION_CLEAR = 7.0  # no parking this close to the end of a road segment
BRIDGE_CLEAR = 6.0  # moored boats keep this far from bridge decks


# ------------------------------------------------------- pure helpers


def stable(*parts: Any) -> float:
    """A stable number in [0, 1) from any values (same run to run)."""
    h = hashlib.sha1(":".join(str(p) for p in parts).encode()).hexdigest()
    return int(h[:8], 16) / 0x100000000


def pick(weights: dict[str, float], u: float) -> str | None:
    """The key whose share of the total weight covers u (0..1)."""
    total = sum(w for w in weights.values() if w > 0)
    if total <= 0:
        return None
    acc = 0.0
    for k, w in weights.items():
        if w <= 0:
            continue
        acc += w / total
        if u < acc:
            return k
    return next(k for k, w in reversed(list(weights.items())) if w > 0)


def subtract(spans: list[tuple[float, float]], cut: tuple[float, float]) -> list[tuple[float, float]]:
    """Remove the years [cut) from a list of [from, until) spans."""
    a, b = cut
    out = []
    for s, e in spans:
        if b <= s or a >= e:
            out.append((s, e))
            continue
        if s < a:
            out.append((s, a))
        if b < e:
            out.append((b, e))
    return out


def intersect(span: tuple[float, float], other: tuple[float, float]) -> tuple[float, float] | None:
    s, e = max(span[0], other[0]), min(span[1], other[1])
    return (s, e) if s < e else None


def building_life(props: dict) -> tuple[float, float]:
    """Years a model building stands, as the app reads them (lifeOf in city3d.ts)."""
    kind = props.get("kind")
    if kind == "standing":
        return (-OPEN, OPEN)
    if kind == "reconstructed":
        return (-OPEN, props.get("until") or 1860)
    return (props.get("from") or 1851, OPEN)


def era_type_mix(mix: dict[str, float], span: tuple[float, float], allow: Callable[[str], bool]) -> dict[str, float]:
    """The weights of the types alive during part of `span` that pass `allow`."""
    out = {}
    for k, w in mix.items():
        t = TYPES[TYPE_INDEX[k]]
        if intersect(span, (t["from"], t["until"])) and allow(k):
            out[k] = w
    return out


def kerb_density(era: dict, width: float, restricted: bool) -> float:
    narrow, wide = era["kerb"]
    p = wide if width >= 9 else narrow if width < 6 else (narrow + wide) / 2
    if restricted and era["from"] >= 1975:
        p *= 0.35  # residents and services only today
    return p


def heading_deg(dx: float, dy: float) -> float:
    """Counter-clockwise from east, in degrees, 0..360."""
    return math.degrees(math.atan2(dy, dx)) % 360


def rect(x: float, y: float, heading: float, length: float, width: float):
    """A vehicle's footprint: a rectangle centred on (x, y) along `heading` (degrees)."""
    from shapely.geometry import Polygon

    r = math.radians(heading)
    ux, uy = math.cos(r), math.sin(r)
    vx, vy = -uy, ux
    hl, hw = length / 2, width / 2
    return Polygon(
        [
            (x + ux * hl + vx * hw, y + uy * hl + vy * hw),
            (x - ux * hl + vx * hw, y - uy * hl + vy * hw),
            (x - ux * hl - vx * hw, y - uy * hl - vy * hw),
            (x + ux * hl - vx * hw, y + uy * hl - vy * hw),
        ]
    )


def walk_line(line, start: float, end: float, steps: Iterable[tuple[float, Any]]):
    """Walk along a line from `start` to `end` (metres): each step asks for
    a length; yields (centre distance, step payload) for steps that fit."""
    s = start
    for length, payload in steps:
        if s + length > end:
            return
        yield s + length / 2, payload
        s += length


# ------------------------------------------------------- spatial helpers


class Buildings:
    """The model's buildings with the years they stand, for footprint checks."""

    def __init__(self, shapes: list, lives: list[tuple[float, float]]):
        from shapely.strtree import STRtree

        self.shapes = shapes
        self.lives = lives
        self.tree = STRtree(shapes)

    def free_years(self, footprint, span: tuple[float, float]) -> list[tuple[float, float]]:
        """The parts of `span` when no building stands on the footprint."""
        spans = [span]
        for i in self.tree.query(footprint):
            if self.shapes[i].intersects(footprint) and self.shapes[i].intersection(footprint).area > 0.3:
                spans = subtract(spans, self.lives[i])
                if not spans:
                    break
        return spans


def tmerc(lon0: float, lat0: float):
    """Local metres around the area's centre, as the app's local frame (conformal, true scale)."""
    from pyproj import Transformer

    proj = f"+proj=tmerc +lat_0={lat0} +lon_0={lon0} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs"
    fwd = Transformer.from_crs(4326, proj, always_xy=True).transform
    inv = Transformer.from_crs(proj, 4326, always_xy=True).transform
    return fwd, inv


def lines_of(geom) -> list:
    """The LineStrings in any (multi)line or polygon boundary geometry."""
    if geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type == "LinearRing":
        from shapely.geometry import LineString

        return [LineString(geom.coords)]
    if geom.geom_type in ("Polygon",):
        return lines_of(geom.exterior) + [x for r in geom.interiors for x in lines_of(r)]
    out = []
    for g in getattr(geom, "geoms", []):
        out += lines_of(g)
    return out


# ---------------------------------------------------------------- data


def fetch_cached(name: str, fetch: Callable[[], Any], refresh: bool = False) -> Any:
    path = CACHE / name
    if path.exists() and not refresh:
        return json.loads(path.read_text())
    data = fetch()
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def voirie_polygons(log: Callable[[str], Any]) -> list:
    """Vasserot street space (1810-1836) as WGS84 shapely polygons."""
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform

    CACHE.mkdir(parents=True, exist_ok=True)
    for ext in ("shp", "shx", "dbf", "prj"):
        dest = CACHE / f"{VOIRIE_STEM}.{ext}"
        if not dest.exists():
            net.download(STACKS.format(druid=VOIRIE_DRUID, name=dest.name), dest, timeout=300)
            log(f"vehicles: downloaded {dest.name}")
    to_wgs = Transformer.from_crs(VASSEROT_EPSG, 4326, always_xy=True).transform
    reader = shapefile.Reader(str(CACHE / f"{VOIRIE_STEM}.shp"), encoding="latin-1")
    out = []
    for sr in reader.iterShapeRecords():
        g = shape(sr.shape.__geo_interface__)
        if not g.is_valid:
            g = g.buffer(0)
        out.append(transform(to_wgs, g))
    return out


def road_name(p: dict) -> str:
    return (p.get("cpx_toponyme_route_nommee") or p.get("nom_collaboratif_gauche") or "").strip()


def is_street(p: dict) -> bool:
    if p.get("nature") in SKIP_NATURES or p.get("acces_vehicule_leger") == "Physiquement impossible":
        return False
    if p.get("fictif"):
        return False
    name = road_name(p).upper()
    return not name.startswith(SKIP_PREFIXES)


def carriageway(p: dict) -> float:
    w = p.get("largeur_de_chaussee")
    try:
        w = float(w)
    except (TypeError, ValueError):
        w = 0.0
    if w <= 0:
        w = {"1": 12.0, "2": 10.0, "3": 9.0, "4": 6.0, "5": 4.0, "6": 3.0}.get(str(p.get("importance")), 4.0)
    return w


def reproject(geom, fn):
    """Apply a pyproj transform (array in, arrays out) to a shapely geometry."""
    import numpy as np
    import shapely

    def f(c):
        x, y = fn(c[:, 0], c[:, 1])
        return np.column_stack([x, y])

    return shapely.transform(geom, f)


# ------------------------------------------------------------ placement


class Placer:
    """Collects rows, checking each footprint against water, bridges and buildings."""

    def __init__(self, buildings: Buildings, river, decks: list[tuple[Any, list[tuple[float, float]]]], inv):
        from shapely.prepared import prep

        self.buildings = buildings
        self.river = river
        self.river_p = prep(river)
        self.river_in = prep(river.buffer(-0.2))
        self.decks = decks
        self.inv = inv
        self.parked: list[list] = []
        self.moving: list[list] = []
        self.paths: list[list[list[float]]] = []
        self.path_keys: dict[str, int] = {}

    def bridge_span(self, footprint) -> list[tuple[float, float]] | None:
        """[(-OPEN, OPEN)] off bridges; on a deck, the years it carries traffic; None if over open water."""
        on = [spans for deck, spans in self.decks if deck.intersects(footprint)]
        if on:
            common = on[0]
            for other in on[1:]:
                common = [x for a in common for b in other if (x := intersect(a, b))]
            return common or None
        if self.river_p.intersects(footprint) and self.river.intersection(footprint).area > 0.2:
            return None
        return [(-OPEN, OPEN)]

    def street(self, kind: str, x: float, y: float, heading: float, span: tuple[float, float], flags: int = 0,
               bridge_ok: bool = False) -> int:
        """Place a street vehicle; returns how many rows were written."""
        t = TYPES[TYPE_INDEX[kind]]
        span = intersect(span, (t["from"], t["until"]))
        if not span:
            return 0
        fp = rect(x, y, heading, t["length"], t["width"])
        b = self.bridge_span(fp)
        if b is None or (not bridge_ok and b != [(-OPEN, OPEN)]):
            return 0
        n = 0
        for part in b:
            sub = intersect(span, part)
            if sub:
                n += self._emit(kind, x, y, heading, self.buildings.free_years(fp, sub), flags)
        return n

    def boat(self, kind: str, x: float, y: float, heading: float, span: tuple[float, float]) -> int:
        t = TYPES[TYPE_INDEX[kind]]
        span = intersect(span, (t["from"], t["until"]))
        if not span:
            return 0
        fp = rect(x, y, heading, t["length"], t["width"])
        if not self.river_in.contains(fp):
            return 0
        if any(deck.distance(fp) < BRIDGE_CLEAR for deck, _ in self.decks):
            return 0
        # The old Hôtel-Dieu and a few other buildings stood over the water.
        return self._emit(kind, x, y, heading, self.buildings.free_years(fp, span), 0)

    def _emit(self, kind: str, x: float, y: float, heading: float, spans: list[tuple[float, float]], flags: int) -> int:
        lon, lat = self.inv(x, y)
        n = 0
        for s, e in spans:
            if e - s < 2:
                continue  # a vehicle that would flicker for a year is left out
            self.parked.append([TYPE_INDEX[kind], round(lon, 6), round(lat, 6), round(heading, 1), int(s), int(e), flags])
            n += 1
        return n

    def path(self, line) -> int:
        coords = [[round(c, 6) for c in self.inv(x, y)] for x, y in line.coords]
        key = json.dumps(coords)
        if key not in self.path_keys:
            self.path_keys[key] = len(self.paths)
            self.paths.append(coords)
        return self.path_keys[key]


def tangent(line, s: float) -> tuple[float, float]:
    a = line.interpolate(max(0.0, s - 1.0))
    b = line.interpolate(min(line.length, s + 1.0))
    dx, dy = b.x - a.x, b.y - a.y
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def fill_kerb(placer: Placer, key: str, line, side: int, offset_of: Callable[[float], float], span: tuple[float, float],
              density: float, mix: dict[str, float], facing: int, start: float, end: float) -> int:
    """Walk a kerb line and park vehicles along it, each era on its own.

    `side` +1 parks on the left of the line's direction, -1 on the right;
    `offset_of(width)` gives the distance of a vehicle's centre from the
    line; `facing` +1 points vehicles along the line, -1 against it, 0
    lets each choose (two-way streets: they face the traffic of their side).
    """
    rows = 0
    s, k = start, 0
    while s < end:
        k += 1
        u = stable(key, side, span[0], k)
        kind = pick(mix, stable(key, side, span[0], k, "type")) if u < density else None
        if kind is None:
            s += SLOT
            continue
        t = TYPES[TYPE_INDEX[kind]]
        length = t["length"]
        if s + length > end:
            break
        c = s + length / 2
        p = line.interpolate(c)
        tx, ty = tangent(line, c)
        nx, ny = -ty, tx  # left normal
        off = offset_of(t["width"]) * side
        x, y = p.x + nx * off, p.y + ny * off
        f = facing or (-side if side else 1)
        heading = heading_deg(tx * f, ty * f)
        flags = 1 if stable(key, side, span[0], k, "unhitch") < UNHITCH.get(kind, 0.0) else 0
        rows += placer.street(kind, x, y, heading, span, flags)
        s += length + 0.6 + 1.2 * stable(key, side, span[0], k, "gap")
    return rows


# ----------------------------------------------------------------- roads


class Road:
    def __init__(self, i: int, line, props: dict, deck_life: list[tuple[float, float]] | None):
        self.i = i
        self.line = line
        self.width = carriageway(props)
        self.name = road_name(props)
        self.importance = int(props.get("importance") or 5)
        sens = (props.get("sens_de_circulation") or "").lower()
        self.oneway = 1 if sens.startswith("sens direct") else -1 if sens.startswith("sens inverse") else 0
        self.restricted = props.get("acces_vehicule_leger") not in (None, "Libre")
        self.bridge = deck_life  # spans of years the bridge carries traffic, None off bridges


def load_roads(raw: list[dict], fwd, decks: list[tuple[Any, list[tuple[float, float]]]]) -> list[Road]:
    from shapely.geometry import LineString

    roads = []
    for f in raw:
        p = f["properties"]
        if not is_street(p) or not f.get("geometry"):
            continue
        coords = [c[:2] for c in f["geometry"]["coordinates"]]
        if len(coords) < 2:
            continue
        line = reproject(LineString(coords), fwd)
        if line.length < 2:
            continue
        deck = None
        mid = line.interpolate(0.5, normalized=True)
        on = [life for d, life in decks if d.contains(mid)]
        if str(p.get("position_par_rapport_au_sol")) == "1" or on:
            deck = on[0] if on else None
            if deck is None:
                continue  # a raised segment on no known bridge: left out
        roads.append(Road(len(roads), line, p, deck))
    return roads


def park_roads(placer: Placer, roads: list[Road], busy: set[tuple[int, int]], log: Callable[[str], Any]) -> int:
    """Kerbside parking, vehicles standing at junctions and on bridges (BD TOPO,
    from 1860). Vehicles stand in the carriageway only on segments where no
    traffic moves in that era (`busy`), so nothing drives through them."""
    rows = 0
    for road in roads:
        line, w = road.line, road.width
        for era in ERAS:
            span = intersect((era["from"], era["until"]), (VASSEROT_UNTIL, OPEN))
            if not span:
                continue
            key = f"road{road.i}"
            if road.bridge is not None:
                # A few vehicles stopped in the traffic on bridges, never parked.
                if w < 5:
                    continue
                mix = era_type_mix(era["mix"], span, lambda k: k != "handcart")
                kerb = (span[0], road.i) in busy  # traffic on the bridge: stop by the parapet
                for k, s in enumerate(range(6, int(line.length) - 6, 14)):
                    if stable(key, span[0], k, "b") > 0.12 * era["move"]:
                        continue
                    kind = pick(mix, stable(key, span[0], k, "bt"))
                    if not kind:
                        continue
                    d = 1 if stable(key, span[0], k, "bd") < 0.5 else -1
                    if road.oneway and era["from"] >= 1935:
                        d = road.oneway
                    p = line.interpolate(s)
                    tx, ty = tangent(line, s)
                    vw = TYPES[TYPE_INDEX[kind]]["width"]
                    lane = w / 2 - KERB_GAP - vw / 2 if kerb else max(1.0, min(w / 4, w / 2 - 3.6))
                    off = -lane * d  # keep right
                    rows += placer.street(kind, p.x - ty * off, p.y + tx * off, heading_deg(tx * d, ty * d), span,
                                          bridge_ok=True)
                continue
            # Narrow lanes take a vehicle on one side; today's narrow streets of
            # the Cité are mostly kept clear (residents, deliveries).
            if w < (4.5 if era["from"] >= 2000 else 3.5):
                continue
            restricted = road.restricted
            density = kerb_density(era, w, restricted)
            long_ok = w >= 9
            mix = era_type_mix(era["mix"], span, lambda k: k not in LONG or long_ok)
            sides = [1, -1] if w >= 6 else [1 if stable(key, "side") < 0.5 else -1]
            facing = road.oneway if road.oneway and era["from"] >= 1935 else 0
            # Now and then a vehicle stands in the carriageway near a junction,
            # where no traffic runs through it; the kerb beside it stays clear.
            clear = {(1, 0): JUNCTION_CLEAR, (-1, 0): JUNCTION_CLEAR, (1, 1): JUNCTION_CLEAR, (-1, 1): JUNCTION_CLEAR}
            if w >= 7 and road.importance <= 4 and line.length > 40 and (span[0], road.i) not in busy:
                movers = era_type_mix(era["mix"], span, lambda k: k != "handcart")
                for end in (0, 1):
                    if stable(key, span[0], end, "j") > 0.18 * era["move"]:
                        continue
                    kind = pick(movers, stable(key, span[0], end, "jt"))
                    if not kind:
                        continue
                    t = TYPES[TYPE_INDEX[kind]]
                    s = 4 + t["length"] / 2
                    s = line.length - s if end else s
                    d = 1 if end else -1  # travelling toward the junction at that end
                    if road.oneway and era["from"] >= 1935 and d != road.oneway:
                        continue
                    p = line.interpolate(s)
                    tx, ty = tangent(line, s)
                    lane = min(w / 4, 1.8)  # keep right
                    if placer.street(kind, p.x + ty * d * lane, p.y - tx * d * lane, heading_deg(tx * d, ty * d), span):
                        rows += 1
                        # The kerb on its right (the line's right when heading to the end, its left otherwise).
                        clear[(-d, end)] = 4 + t["length"] + 2
            for side in sides:
                rows += fill_kerb(placer, key, line, side, lambda vw: w / 2 - KERB_GAP - vw / 2, span, density, mix,
                                  facing, clear[(side, 0)], line.length - clear[(side, 1)])
    log(f"vehicles: {rows} rows from BD TOPO kerbs, junctions and bridges")
    return rows


def park_voirie(placer: Placer, voirie, river, log: Callable[[str], Any]) -> int:
    """Vehicles along the edges of the Vasserot street space, before 1860."""
    from shapely.geometry import Point
    from shapely.prepared import prep

    base = KERB_GAP + 0.95  # the kerb line runs this far inside the street space
    inner = voirie.buffer(-base)
    vp = prep(voirie)
    rows = 0
    for li, line in enumerate(lines_of(inner.boundary)):
        if line.length < 12:
            continue
        key = f"vas{li}:{round(line.coords[0][0])}:{round(line.coords[0][1])}"
        # Sample the street width once per 10 m, for the density.
        for era in ERAS:
            span = intersect((era["from"], era["until"]), (-OPEN, VASSEROT_UNTIL))
            if not span:
                continue
            s, k = 4.0, 0
            while s < line.length - 4:
                k += 1
                p = line.interpolate(s)
                tx, ty = tangent(line, s)
                # Which side is the street? The kerb line has the street on one side only.
                nx, ny = -ty, tx
                if not vp.contains(Point(p.x + nx * (base + 0.3), p.y + ny * (base + 0.3))):
                    nx, ny = ty, -tx
                width = 0.0
                for d in range(1, 31):
                    if not vp.contains(Point(p.x + nx * d, p.y + ny * d)):
                        break
                    width = d
                width += base
                # Corners: no parking where the kerb turns sharply.
                ax, ay = tangent(line, max(0.0, s - 3))
                bx, by = tangent(line, min(line.length, s + 3))
                corner = ax * bx + ay * by < 0.92
                if width < 4.5 or corner or river.distance(p) < 0.5:
                    s += SLOT / 2
                    continue
                density = kerb_density(era, width, False)
                if stable(key, span[0], k) >= density:
                    s += SLOT
                    continue
                mix = era_type_mix(era["mix"], span, lambda kk: kk not in LONG or width >= 10)
                kind = pick(mix, stable(key, span[0], k, "t"))
                if not kind:
                    s += SLOT
                    continue
                t = TYPES[TYPE_INDEX[kind]]
                c = s + t["length"] / 2
                if c + t["length"] / 2 > line.length - 4:
                    break
                p = line.interpolate(c)
                shift = KERB_GAP + t["width"] / 2 - base
                x, y = p.x + nx * shift, p.y + ny * shift
                tx, ty = tangent(line, c)
                f = 1 if stable(key, span[0], k, "f") < 0.5 else -1
                flags = 1 if stable(key, span[0], k, "u") < UNHITCH.get(kind, 0.0) else 0
                fp = rect(x, y, heading_deg(tx * f, ty * f), t["length"], t["width"])
                if vp.contains(fp):
                    rows += placer.street(kind, x, y, heading_deg(tx * f, ty * f), span, flags, bridge_ok=True)
                s += t["length"] + 0.6 + 1.2 * stable(key, span[0], k, "g")
    log(f"vehicles: {rows} rows along the Vasserot street space (before {VASSEROT_UNTIL})")
    return rows


# ---------------------------------------------------------------- moving


def chains(segments: list[Road], min_turn: float = 0.75) -> list[list[tuple[Road, int]]]:
    """Join road segments into through-routes: at each node, carry on along
    the straightest unused segment (cosine of the turn above `min_turn`).
    Each chain is a list of (segment, direction) with direction +1 when the
    segment is walked as digitised."""
    def node(pt) -> tuple[int, int]:
        return (round(pt[0] * 2), round(pt[1] * 2))

    ends: dict[tuple[int, int], list[tuple[Road, int]]] = {}
    for r in segments:
        c = list(r.line.coords)
        ends.setdefault(node(c[0]), []).append((r, 1))
        ends.setdefault(node(c[-1]), []).append((r, -1))

    def out_dir(r: Road, d: int) -> tuple[float, float]:
        """Unit direction leaving the segment's far end when walked in direction d."""
        c = list(r.line.coords)
        (ax, ay), (bx, by) = (c[-2], c[-1]) if d == 1 else (c[1], c[0])
        n = math.hypot(bx - ax, by - ay) or 1
        return (bx - ax) / n, (by - ay) / n

    def in_dir(r: Road, d: int) -> tuple[float, float]:
        c = list(r.line.coords)
        (ax, ay), (bx, by) = (c[0], c[1]) if d == 1 else (c[-1], c[-2])
        n = math.hypot(bx - ax, by - ay) or 1
        return (bx - ax) / n, (by - ay) / n

    used: set[int] = set()

    def extend(r: Road, d: int) -> list[tuple[Road, int]]:
        out = []
        while True:
            c = list(r.line.coords)
            far = node(c[-1] if d == 1 else c[0])
            ox, oy = out_dir(r, d)
            best, best_cos = None, min_turn
            for nr, side in ends.get(far, []):
                if nr.i in used:
                    continue
                nd = side  # side +1: the segment starts here, walk it as digitised
                ix, iy = in_dir(nr, nd)
                cos = ox * ix + oy * iy
                if cos > best_cos:
                    best, best_cos = (nr, nd), cos
            if not best:
                return out
            used.add(best[0].i)
            out.append(best)
            r, d = best

    result = []
    for r in sorted(segments, key=lambda r: (r.importance, -r.line.length)):
        if r.i in used:
            continue
        used.add(r.i)
        fwd = extend(r, 1)
        back = extend(r, -1)
        chain = [(s, -d) for s, d in reversed(back)] + [(r, 1)] + fwd
        result.append(chain)
    return result


def chain_line(chain: list[tuple[Road, int]]):
    from shapely.geometry import LineString

    coords: list[tuple[float, float]] = []
    for r, d in chain:
        c = list(r.line.coords)
        if d == -1:
            c.reverse()
        if coords and math.dist(coords[-1], c[0]) < 1.0:
            c = c[1:]
        coords += c
    return LineString(coords)


def segment_ok(placer: Placer, r: Road, span: tuple[float, float], voirie_p) -> bool:
    """Can traffic run along this segment for the whole of `span`?"""
    if r.bridge is not None and not any(b[0] <= span[0] and span[1] <= b[1] for b in r.bridge):
        return False
    line = r.line
    if line.length > 8:
        from shapely.ops import substring

        line = substring(line, 3, line.length - 3)
    fp = line.buffer(1.1, cap_style="flat")
    if r.bridge is None and placer.river.intersection(fp).area > 1.0:
        return False
    if span[1] <= VASSEROT_UNTIL and not voirie_p.contains(line.buffer(0.6, cap_style="flat")):
        return False
    free = placer.buildings.free_years(fp, span)
    return free == [span]


TWO_WAY_WIDTH = 10.0  # narrower streets carry one line of moving traffic, down the middle
MOVING_WIDTH = 6.0  # narrower ones have parked vehicles in the way


def drive(placer: Placer, roads: list[Road], voirie, log: Callable[[str], Any]) -> set[tuple[int, int]]:
    """Vehicles moving along through-routes, era by era. Returns the (era
    start, segment) pairs that carry traffic, so nothing stands in its way."""
    from shapely.prepared import prep

    voirie_p = prep(voirie.buffer(1.0))
    rows = 0
    busy: set[tuple[int, int]] = set()
    for era in ERAS:
        span = (era["from"], era["until"])
        ok = [r for r in roads if r.width >= MOVING_WIDTH and segment_ok(placer, r, span, voirie_p)]
        movers = era_type_mix(era["mix"], span, lambda k: k != "handcart")
        for ci, chain in enumerate(chains(ok)):
            line = chain_line(chain)
            if line.length < 60:
                continue
            width = min(r.width for r, _ in chain)
            importance = min(r.importance for r, _ in chain)
            per_100m = era["move"] * (0.5 if importance <= 3 else 0.25 if importance == 4 else 0.12)
            n = per_100m * line.length / 100
            n = int(n) + (1 if stable("drive", span[0], ci, line.length) < n - int(n) else 0)
            if not n:
                continue
            path = placer.path(line)
            two_way = width >= TWO_WAY_WIDTH
            # Two lanes between the parked rows (a parked cart takes 0.25 + 1.9 m of each kerb).
            lane = max(1.0, min(width / 4, width / 2 - 3.6)) if two_way else 0.0
            oneway = 0
            if era["from"] >= 1935:
                votes = sum(r.oneway * d for r, d in chain)
                oneway = 1 if votes > 0 else -1 if votes < 0 else 0
            if not two_way and not oneway:
                oneway = 1 if stable("drive", span[0], ci, "one") < 0.5 else -1
            busy.update((span[0], r.i) for r, _ in chain)
            groups: dict[int, list[str]] = {}
            for k in range(n):
                kind = pick(movers, stable("drive", span[0], ci, k))
                if not kind or (kind in LONG and width < 7):
                    continue
                d = oneway or (1 if stable("drive", span[0], ci, k, "d") < 0.5 else -1)
                groups.setdefault(d, []).append(kind)
            for d, kinds in groups.items():
                speed = min(SPEED[k] for k in kinds)  # one speed per lane, so nobody drives through anybody
                for k, kind in enumerate(kinds):
                    t = TYPES[TYPE_INDEX[kind]]
                    life = intersect(span, (t["from"], t["until"]))
                    if not life:
                        continue
                    phase = (k + 0.3 * stable("drive", span[0], ci, d, k, "p")) / len(kinds)
                    placer.moving.append([TYPE_INDEX[kind], path, int(life[0]), int(life[1]), round(speed, 2),
                                          round(phase, 3), d, round(lane, 2)])
                    rows += 1
    log(f"vehicles: {rows} moving vehicles")
    return busy


# ----------------------------------------------------------------- river


def moor(placer: Placer, river, clip, log: Callable[[str], Any]) -> int:
    """Boats moored along the banks, era by era."""
    from shapely.geometry import Point
    from shapely.prepared import prep

    base = 3.2
    inner = river.buffer(-base)
    rp = prep(river)
    rows = 0
    for li, line in enumerate(x for b in lines_of(inner.boundary) for x in lines_of(b.intersection(clip))):
        if line.length < 30:
            continue
        key = f"bank{li}:{round(line.coords[0][0])}:{round(line.coords[0][1])}"
        for era in BOAT_ERAS:
            span = (era["from"], era["until"])
            mix = era_type_mix(era["mix"], span, lambda k: True)
            s, k = 2.0, 0
            while s < line.length - 2:
                k += 1
                if stable(key, span[0], k) >= era["moor"]:
                    s += 12
                    continue
                kind = pick(mix, stable(key, span[0], k, "t"))
                if not kind:
                    s += 12
                    continue
                t = TYPES[TYPE_INDEX[kind]]
                c = s + t["length"] / 2
                if c + t["length"] / 2 > line.length - 2:
                    break
                p = line.interpolate(c)
                tx, ty = tangent(line, c)
                nx, ny = -ty, tx  # toward open water? (the bank is `base` away on the other side)
                if not rp.contains(Point(p.x + nx * (base + 1.5), p.y + ny * (base + 1.5))):
                    nx, ny = ty, -tx
                # Leave a channel: the river must go on well beyond the boat.
                if not rp.contains(Point(p.x + nx * (t["width"] + 14), p.y + ny * (t["width"] + 14))):
                    s += 12
                    continue
                shift = t["width"] / 2 + 0.6 - base
                f = 1 if stable(key, span[0], k, "f") < 0.5 else -1
                written = placer.boat(kind, p.x + nx * shift, p.y + ny * shift, heading_deg(tx * f, ty * f), span)
                rows += written
                s += t["length"] + (3 if written else 1) + 6 * stable(key, span[0], k, "g")
    log(f"vehicles: {rows} moored boats")
    return rows


def sail(placer: Placer, river, clip, log: Callable[[str], Any]) -> int:
    """Boats moving along lanes out from the banks. Before 1950 only where the
    river is wide (the grand bras): the petit bras was the wash-boats' arm."""
    from shapely.geometry import Point

    rows = 0
    for era in BOAT_ERAS:
        span = (era["from"], era["until"])
        clear = 14.0 if era["from"] >= 1950 else 26.0
        lanes = [x for b in lines_of(river.buffer(-clear).boundary) for x in lines_of(b.intersection(clip))]
        lanes = [ln for ln in lanes if ln.length > 150]
        mix = era_type_mix(MOVING_BOATS, span, lambda k: True)
        for li, line in enumerate(lanes):
            n = era["move"] * line.length / 400
            n = int(n) + (1 if stable("sail", span[0], li) < n - int(n) else 0)
            if not n:
                continue
            # Keep to the right: the nearer bank on the starboard side.
            p = line.interpolate(line.length / 2)
            tx, ty = tangent(line, line.length / 2)
            right = Point(p.x + ty * (clear + 4), p.y - tx * (clear + 4))
            d = 1 if not river.contains(right) else -1
            path = placer.path(line)
            kinds = [pick(mix, stable("sail", span[0], li, k)) for k in range(n)]
            kinds = [k for k in kinds if k]
            if not kinds:
                continue
            speed = min(SPEED[k] for k in kinds)
            for k, kind in enumerate(kinds):
                t = TYPES[TYPE_INDEX[kind]]
                life = intersect(span, (t["from"], t["until"]))
                if not life:
                    continue
                phase = (k + 0.4 * stable("sail", span[0], li, k, "p")) / len(kinds)
                placer.moving.append([TYPE_INDEX[kind], path, int(life[0]), int(life[1]), round(speed, 2),
                                      round(phase, 3), d, 0.0])
                rows += 1
    log(f"vehicles: {rows} moving boats")
    return rows


# ------------------------------------------------------------- conflicts


def resolve(parked: list[list], moving: list[list], paths: list, fwd) -> list[list]:
    """Last pass: no parked vehicle in the lane of a moving one, nor two
    parked vehicles on the same spot, in the same years. Earlier rows win;
    a later one keeps only its years free of conflict."""
    from shapely.geometry import LineString
    from shapely.strtree import STRtree

    lines = [LineString([fwd(*c) for c in p]) for p in paths]
    bands, band_years = [], []
    for m in moving:
        t = TYPES[m[0]]
        if t["id"] in BOATS:
            continue
        lane = m[7] * (1 if m[6] > 0 else -1)
        line = lines[m[1]]
        off = line.offset_curve(-lane) if lane else line
        bands.append(off.buffer(t["width"] / 2 + 0.2))
        band_years.append((m[2], m[3]))
    tree = STRtree(bands) if bands else None
    out: list[list] = []
    taken: dict[tuple[int, int], list[tuple[Any, tuple[int, int]]]] = {}
    for r in parked:
        t = TYPES[r[0]]
        x, y = fwd(r[1], r[2])
        fp = rect(x, y, r[3], t["length"], t["width"])
        spans = [(r[4], r[5])]
        if tree is not None and t["id"] not in BOATS:
            for i in tree.query(fp):
                if bands[i].intersection(fp).area > 0.3:
                    spans = [s for sp in spans for s in subtract([sp], band_years[i])]
        cells = {(int(x // 20) + dx, int(y // 20) + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
        for c in cells:
            for other, years in taken.get(c, []):
                if spans and other.intersects(fp) and other.intersection(fp).area > 0.3:
                    spans = [s for sp in spans for s in subtract([sp], years)]
        for s0, s1 in spans:
            if s1 - s0 < 2:
                continue
            row = [*r[:4], int(s0), int(s1), r[6]]
            out.append(row)
            taken.setdefault((int(x // 20), int(y // 20)), []).append((fp, (s0, s1)))
    return out


# ----------------------------------------------------------------- build


def build(area: str = "cite", log: Callable[[str], Any] = print, refresh: bool = False) -> dict:
    from shapely.geometry import box, shape
    from shapely.ops import unary_union

    from rpr.sources.site import bridge_decks, flat, wfs

    cfg = AREAS[area]
    bbox = cfg["bbox"]
    lon0, lat0 = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    fwd, inv = tmerc(lon0, lat0)
    clip_wgs = box(*bbox)
    clip = reproject(clip_wgs, fwd)

    # The river (BD TOPO) and the bridge decks over it.
    water = fetch_cached(f"water-{area}.json", lambda: wfs("BDTOPO_V3:surface_hydrographique", bbox), refresh)
    river_wgs = unary_union(
        [shape(flat(f["geometry"])) for f in water if f["properties"].get("nature") == "Ecoulement naturel"]
    ).intersection(box(bbox[0] - 0.003, bbox[1] - 0.003, bbox[2] + 0.003, bbox[3] + 0.003))
    river = reproject(river_wgs, fwd)
    raw_roads = fetch_cached(f"roads-{area}.json", lambda: wfs("BDTOPO_V3:troncon_de_route", bbox), refresh)
    decks = []
    unknown = []
    for d in bridge_decks(raw_roads, river_wgs, fwd, inv):
        name = d["name"]
        if name in BRIDGES:
            s, e, _ = BRIDGES[name]
            spans = traffic_spans(d["key"], (s, e))
            if spans:
                decks.append((reproject(d["deck"], fwd), spans))
        elif name not in unknown:
            unknown.append(name)
    if unknown:
        log(f"vehicles: no traffic dates for {', '.join(sorted(unknown))}: no vehicles on them")

    # Buildings of the massing model, with the years they stand.
    model = json.loads((area_file(area, "model")).read_text())
    shapes, lives = [], []
    for f in model["features"]:
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        shapes.append(reproject(g, fwd))
        lives.append(building_life(f["properties"]))
    placer = Placer(Buildings(shapes, lives), river, decks, inv)

    # The Vasserot street space, inside the area.
    voirie = reproject(unary_union([g.buffer(0) for g in voirie_polygons(log)]).intersection(clip_wgs), fwd)

    roads = [r for r in load_roads(raw_roads, fwd, decks) if r.line.intersects(clip)]
    park_voirie(placer, voirie, river, log)
    busy = drive(placer, roads, voirie, log)
    park_roads(placer, roads, busy, log)
    moor(placer, river, clip, log)
    sail(placer, river, clip, log)

    # Keep what lies inside the area.
    inside = lambda lon, lat: bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]
    parked = sorted(r for r in resolve(placer.parked, placer.moving, placer.paths, fwd) if inside(r[1], r[2]))
    counts: dict[str, int] = {}
    for r in parked + placer.moving:
        counts[TYPES[r[0]]["id"]] = counts.get(TYPES[r[0]]["id"], 0) + 1
    out = area_file(area, "vehicles")
    out.write_text(
        json.dumps(
            {
                "metadata": {
                    "area": area,
                    "sources": {
                        "streets": "IGN BD TOPO troncon_de_route (Etalab 2.0), from 1860",
                        "streets_before_1860": "Vasserot cadastre, Emprise de la voirie (ALPAGE, ODbL)",
                        "river": "IGN BD TOPO surface_hydrographique (Etalab 2.0)",
                        "buildings": f"{file_name(area, 'model')} (vehicles never stand inside a building of their year)",
                    },
                    "notes": "Types, dates and density from the archive photographs and transport history (README, "
                             "Vehicles and boats). Positions are plausible, not recorded: no particular cart or boat "
                             "is documented here.",
                    "bridges": {k: v[2] for k, v in BRIDGES.items()},
                    "counts": counts,
                },
                "types": [{k: t[k] for k in ("id", "from", "until", "length", "width", "note")} for t in TYPES],
                "paths": placer.paths,
                "parked": {"fields": ["type", "lon", "lat", "heading", "from", "until", "flags"], "rows": parked},
                "moving": {
                    "fields": ["type", "path", "from", "until", "speed", "phase", "dir", "lane"],
                    "rows": placer.moving,
                },
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    size = out.stat().st_size
    log(f"vehicles: {len(parked)} parked, {len(placer.moving)} moving on {len(placer.paths)} paths "
        f"({size / 1e3:.0f} kB) -> {out.relative_to(paths.REPO_ROOT)}")
    return {"area": area, "file": manifest_file(area, "vehicles"), "parked": len(parked), "moving": len(placer.moving),
            "bytes": size}

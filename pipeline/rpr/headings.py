"""Which way each photo faces.

A heading is a compass bearing in degrees (0 = north, 90 = east) with the
method that gave it and a confidence. It is never a recorded value unless the
archive recorded it.

Methods:

- ``recorded``: the archive gives the direction.
- ``facade``: the caption gives a house number ("13 quai d'Anjou"), so the
  photo shows that building, taken from the street in front of it. The
  heading points from the street at the building, square to the facade.
  The facade is the edge of today's street outline (City of Paris,
  "Dénominations des emprises des voies actuelles", ODbL) nearest the
  address point. Address points sit about a metre outside that edge (median
  0.97 m over the Paris Musées captions), so its direction is well defined.

No facade heading is given when:

- the address is an 1836 one on a street since demolished;
- the caption says the view was taken from somewhere else, or shows a
  courtyard, a park, a staircase or an interior;
- the address point lies more than 15 m from its street (a building set
  back behind a courtyard) or more than 2 m inside the street's outline.

The bearings are worked out once by ``python -m rpr headings`` and kept in
``pipeline/cache/facade-bearings.json``, keyed by address point, so that
``python -m rpr parismusees --offline`` needs no download.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Callable, Iterable

from rpr import net, paths

HEADING_METHODS = ("recorded", "facade")
CONFIDENCE = {"recorded": 0.9, "facade": 0.5}

FACADE_PATH = paths.REPO_ROOT / "pipeline" / "cache" / "facade-bearings.json"
OUTLINES_URL = (
    "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/"
    "denominations-emprises-voies-actuelles/exports/geojson?select=typo_min,largeur,geo_shape"
)
OUTLINES_CACHE = "denominations-emprises-voies-actuelles-all.geojson"
CREDIT = "Ville de Paris, Dénominations des emprises des voies actuelles (ODbL)"
METRIC_EPSG = 2154  # Lambert-93

MAX_OUTSIDE_M = 15.0  # farther from the street: set back, the view is unknown
MAX_INSIDE_M = 2.0  # deeper inside the street outline: which side is unclear
SEARCH_M = 200.0  # parts of a street farther than this are another street of the same name

# The caption says the photo is not of the front of the building.
NOT_A_FACADE = re.compile(
    r"\b(?:vue?s?\s+(?:prise|depuis|de\s+la|du|des)|vu\s+d|depuis|cours?|courette|escaliers?|"
    r"int[ée]rieur|salon|salle|chambre|cuisine|atelier|boutique\s+int|jardin|parc|toits?|"
    r"perspective|panorama|plafond|d[ée]tail|rampe|porte\s+d['’]entr[ée]e\s+int)\b",
    re.IGNORECASE,
)


def key(lon: float, lat: float) -> str:
    return f"{lon:.6f},{lat:.6f}"


def wrap360(deg: float) -> float:
    d = deg % 360.0
    return 0.0 if d >= 360.0 else d


def facade_street(extra: dict, title: str) -> str | None:
    """The street whose outline gives the facade, or None when the photo may not show a facade."""
    if extra.get("precision") != "number" or extra.get("method") != "ban":
        return None
    if NOT_A_FACADE.search(title or ""):
        return None
    label = re.sub(r"\s+\d{5}\s.*$", "", str(extra.get("geocoded_street", ""))).strip()
    street = re.sub(r"^\d+\s*(?:bis|ter|quater|[a-z])?\s+", "", label, flags=re.IGNORECASE).strip()
    return street or None


def facade_bearing(house: tuple[float, float], outline: Any) -> float | None:
    """Bearing (degrees) from the street to the building at `house`, square to the edge of the
    street `outline` nearest it. Both in metres (x east, y north). None when it cannot be told."""
    from shapely.geometry import LineString, Point

    p = Point(house)
    inside = outline.contains(p)
    edge = outline.boundary
    d = edge.distance(p)
    if (inside and d > MAX_INSIDE_M) or (not inside and d > MAX_OUTSIDE_M):
        return None
    # The segment of the edge nearest the house.
    best, best_d = None, math.inf
    for line in getattr(edge, "geoms", [edge]):
        cs = list(line.coords)
        for a, b in zip(cs, cs[1:]):
            if a == b:
                continue
            sd = LineString([a, b]).distance(p)
            if sd < best_d:
                best, best_d = (a, b), sd
    if best is None:
        return None
    (ax, ay), (bx, by) = best
    length = math.hypot(bx - ax, by - ay)
    nx, ny = (by - ay) / length, -(bx - ax) / length  # one of the two normals
    # Point it out of the street: the photographer stands in the street and looks out at the facade.
    seg = LineString(best)
    foot = seg.interpolate(seg.project(p))
    probe = Point(foot.x + 0.25 * nx, foot.y + 0.25 * ny)
    if outline.contains(probe):
        nx, ny = -nx, -ny
    return round(wrap360(math.degrees(math.atan2(nx, ny))), 1)


class Facades:
    """The saved facade bearings, looked up by address point."""

    def __init__(self, bearings: dict[str, float] | None = None):
        self.bearings = bearings or {}

    @classmethod
    def load(cls, path: Path = FACADE_PATH) -> "Facades":
        if not path.exists():
            return cls()
        return cls(json.loads(path.read_text(encoding="utf-8")).get("bearings", {}))

    def heading(self, lon: float, lat: float, extra: dict, title: str) -> float | None:
        if facade_street(extra, title) is None:
            return None
        return self.bearings.get(key(lon, lat))


def build_table(points: Iterable[tuple[float, float, str]], outlines: list[dict], log: Callable[[str], Any] = print) -> dict:
    """Facade bearings for (lon, lat, street) address points, from today's street outlines (GeoJSON features)."""
    import numpy as np
    import shapely
    from pyproj import Transformer
    from shapely.geometry import Point, shape

    from rpr.sources.streetnames import norm

    to_m = Transformer.from_crs(4326, METRIC_EPSG, always_xy=True)

    def metres(g):
        return shapely.transform(g, lambda c: np.column_stack(to_m.transform(c[:, 0], c[:, 1])))

    by_name: dict[str, list] = {}
    for f in outlines:
        name = (f.get("properties") or {}).get("typo_min")
        if name and f.get("geometry"):
            by_name.setdefault(norm(name), []).append(metres(shape(f["geometry"])))
    bearings: dict[str, float] = {}
    stats = {"no outline": 0, "too far or too deep": 0}
    for lon, lat, street in points:
        x, y = to_m.transform(lon, lat)
        near = [g for g in by_name.get(norm(street), []) if g.distance(Point(x, y)) <= SEARCH_M]
        if not near:
            stats["no outline"] += 1
            continue
        b = facade_bearing((x, y), shapely.union_all(near))
        if b is None:
            stats["too far or too deep"] += 1
            continue
        bearings[key(lon, lat)] = b
    log(f"headings: {len(bearings)} facade bearings; none for {stats}")
    return {"source": CREDIT, "bearings": dict(sorted(bearings.items()))}


def build(log: Callable[[str], Any] = print) -> dict:
    """Work out the facade bearing of every Paris Musées photo placed at a house number."""
    from rpr.sources import streets

    photos = json.loads((paths.PHOTOS_DIR / "parismusees.geojson").read_text(encoding="utf-8"))["features"]
    points = []
    for f in photos:
        extra = json.loads(f["properties"].get("extra") or "{}")
        street = facade_street(extra, f["properties"].get("title", ""))
        if street:
            lon, lat = f["geometry"]["coordinates"]
            points.append((lon, lat, street))
    log(f"headings: {len(points)} photos at a house number whose caption may show the facade")
    raw = streets.cached(OUTLINES_CACHE, lambda: net.fetch_bytes(OUTLINES_URL, timeout=300, retries=10))
    table = build_table(points, json.loads(raw)["features"], log)
    FACADE_PATH.write_text(json.dumps(table, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    return {"facade": len(table["bearings"])}

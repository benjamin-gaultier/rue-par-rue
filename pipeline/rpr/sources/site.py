"""The ground of the detailed area: the Seine, its bridges through time, and
a few hand-placed landmark details. From IGN BD TOPO, plus notes from history.

The river polygon carries the water level (27 m around the Cité; the streets
are near 34 m), which the app uses to sink the river between quay walls.

Bridges: today's decks (BD TOPO road segments marked as above ground) stand
in for every structure that has crossed at the same place since 1780, each
with its own dated history (BRIDGES below): what kind of structure it was,
how many arches, how wide where it differed, and the houses it carried. The
first Pont Louis-Philippe (1834-1860) crossed on another line, which is
added by hand (OLD_LINES).
"""

from __future__ import annotations

import json
import math
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

# ------------------------------------------------------------------ bridges
#
# Kinds of structure, as the app draws them (citygen.ts, BRIDGE_KIND):
#   stone-old   masonry of the 16th-18th centuries: round arches, thick piers with cutwaters
#   stone       19th-century masonry: elliptical arches, slender piers, a cornice
#   iron        cast- or wrought-iron arch(es) between stone abutments
#   suspension  a deck hung from chains or cables between masonry pylons
#   timber      wooden spans on piers
#   iron-centre stone side arches around one wide iron arch
#   truss       a steel lattice footbridge
#   steel       a modern steel span
#   wide-centre concrete faced with stone: one wide arch between two small ones
#
# Each generation: years [from, until) (None: open-ended; before 1780 the app
# starts anyway), kind, arches (a list for a bridge that crosses both arms:
# longest crossing first), width in metres where it differed from today's
# deck, and `houses_until` for the rows of houses it carried (`houses`: how
# many, where a source counts them; `house_height` when built alike). Dates were
# checked against the sources listed with each bridge; where a figure is an
# estimate the note says so. Search results consulted in November 2026.
BRIDGES: dict[str, dict[str, Any]] = {
    "PONT NEUF": {
        "sources": "structurae.net/fr/ouvrages/pont-neuf; fr.wikipedia.org/wiki/Pont_Neuf",
        "history": [
            {
                "from": 1607,
                "until": None,
                "kind": "stone-old",
                "arches": [7, 5],
                "note": "Built 1578-1607: seven round arches over the main arm, five over the small arm. "
                "Arches rebuilt and the roadway lowered in the 1850s on the same piers; drawn unchanged.",
            }
        ],
    },
    "PONT AU CHANGE": {
        "sources": "structurae.net/en/structures/pont-au-change; paperblog.fr (Le pont au Change, vieille sentinelle); "
        "Hubert Robert's paintings of the demolition (musée Carnavalet)",
        "history": [
            {
                "from": None,
                "until": 1858,
                "kind": "stone-old",
                "arches": 7,
                "houses_until": 1788,
                "note": "Stone bridge of 1639-1647 lined with two rows of houses, cleared 1786-1788. "
                "Seven arches is an estimate.",
            },
            {
                "from": 1860,
                "until": None,
                "kind": "stone",
                "arches": 3,
                "note": "Vaudrey and Lagalisserie, 1858-1860 (opened 15 August 1860): three elliptical arches of 31 m.",
            },
        ],
    },
    "PONT NOTRE-DAME": {
        "sources": "techno-science.net (Pont Notre-Dame); sortiraparis.com (History of the Pont Notre-Dame); "
        "structurae.net/fr/ouvrages/pont-notre-dame",
        "history": [
            {
                "from": None,
                "until": 1853,
                "kind": "stone-old",
                "arches": 6,
                "houses_until": 1787,
                "houses": 68,
                "house_height": 14.0,
                "note": "Stone bridge of 1500-1507 (Fra Giocondo) carrying 68 uniform houses; their demolition was "
                "ordered in 1786 and done in 1786-1787, so 1786 is the last year shown with houses. "
                "Six arches and the houses' height (14 m, built alike) are estimates.",
            },
            {
                "from": 1853,
                "until": 1919,
                "kind": "stone",
                "arches": 5,
                "note": "Rebuilt in 1853 with five arches.",
            },
            {
                "from": 1919,
                "until": None,
                "kind": "iron-centre",
                "arches": 3,
                "note": "The three middle arches replaced by one iron arch of about 60 m for navigation: decided "
                "1912, opened 1919 (works years not shown).",
            },
        ],
    },
    "PETIT PONT CARDINAL LUSTIGER": {
        "sources": "fr.wikisource.org (Dictionnaire administratif et historique des rues de Paris, Pont (Petit)); "
        "en.wikipedia.org/wiki/Petit_Pont",
        "history": [
            {
                "from": None,
                "until": 1853,
                "kind": "stone-old",
                "arches": 3,
                "note": "Rebuilt without houses after the fire of 1718 (order of 5 September 1718). "
                "Three arches is an estimate.",
            },
            {
                "from": 1853,
                "until": None,
                "kind": "stone",
                "arches": 1,
                "note": "Rebuilt in 1853 as a single stone arch (Michal and Gariel), about 32 m long.",
            },
        ],
    },
    "PONT AU DOUBLE": {
        "sources": "structurae.net/fr/ouvrages/pont-au-double; structurae.net/fr/ouvrages/pont-au-double-1883",
        "history": [
            {
                "from": None,
                "until": 1847,
                "kind": "stone-old",
                "arches": 2,
                "note": "Hôtel-Dieu's bridge, opened 1634 (its toll of a double denier gave the name), rebuilt after "
                "its collapse in 1709. The Hôtel-Dieu's rooms above it are left to the Hôtel-Dieu model. "
                "Two arches is an estimate.",
            },
            {
                "from": 1848,
                "until": 1883,
                "kind": "stone",
                "arches": 1,
                "note": "Demolished in 1847 because its narrow spans hindered boats; rebuilt as one masonry "
                "span of 31 m (Gariel and Garnier), centring struck early 1848.",
            },
            {
                "from": 1883,
                "until": None,
                "kind": "iron",
                "arches": 1,
                "note": "Today's cast-iron arch, 1883 (Structurae gives 1882 for the start of the replacement).",
            },
        ],
    },
    "PONT SAINT-MICHEL": {
        "sources": "evous.fr (Pont Saint-Michel à Paris); en.wikipedia.org/wiki/Pont_Saint-Michel; "
        "structurae.net",
        "history": [
            {
                "from": None,
                "until": 1857,
                "kind": "stone-old",
                "arches": 4,
                "houses_until": 1808,
                "houses": 32,
                "note": "Stone bridge of 1616 carrying 32 houses, removed after an imperial decree of 1807 "
                "(demolished 1808). Four arches is an estimate.",
            },
            {
                "from": 1857,
                "until": None,
                "kind": "stone",
                "arches": 3,
                "note": "Rebuilt in 1857 (Vaudrey and Lagalisserie) with three round arches.",
            },
        ],
    },
    "PONT D'ARCOLE": {
        "sources": "paris.fr (Le pont d'Arcole, un pont qui porte le poids de l'histoire); "
        "structurae.net/fr/ouvrages/passerelle-arcole; structurae.net/en/structures/arcole-bridge",
        "history": [
            {
                "from": 1828,
                "until": 1854,
                "kind": "suspension",
                "arches": 2,
                "width": 3.5,
                "note": "Suspension footbridge of December 1828, called pont de la Grève at first: two spans of "
                "about 40 m, 3.5 m wide.",
            },
            {
                "from": 1856,
                "until": None,
                "kind": "iron",
                "arches": 1,
                "note": "Ordered by decree of 31 August 1854, built 1854-1856 (Oudry and Cadiat): one wrought-iron "
                "arch of 80 m.",
            },
        ],
    },
    "PONT SAINT-LOUIS": {
        "sources": "structurae.net/fr/ouvrages/pont-saint-louis; list of Paris bridges in fr.wikipedia.org "
        "(pont Rouge 1717-1795, pont de la Cité 1804-1811, first pont Saint-Louis 1842-1861)",
        "history": [
            {
                "from": None,
                "until": 1795,
                "kind": "timber",
                "arches": 3,
                "width": 6.0,
                "note": "The wooden pont Rouge (1717-1795). Spans and width are estimates.",
            },
            {
                "from": 1804,
                "until": 1811,
                "kind": "timber",
                "arches": 2,
                "width": 8.0,
                "note": "The pont de la Cité, a two-arch bridge of 1804, demolished in 1811. Drawn as timber "
                "arches; width estimated.",
            },
            {
                "from": 1842,
                "until": 1861,
                "kind": "suspension",
                "arches": 1,
                "width": 4.0,
                "note": "A suspension footbridge closed to carriages (1842). Width estimated.",
            },
            {
                "from": 1862,
                "until": 1939,
                "kind": "iron",
                "arches": 1,
                "note": "An iron arch of 64 m carrying a road (1861-1862), sunk on 22 December 1939 after a "
                "barge struck it.",
            },
            {
                "from": 1941,
                "until": 1968,
                "kind": "truss",
                "arches": 1,
                "width": 4.0,
                "note": "A temporary lattice footbridge bought from Neuilly (1941). Width estimated.",
            },
            {
                "from": 1970,
                "until": None,
                "kind": "steel",
                "arches": 1,
                "note": "Today's steel bridge, built 1968-1970, 67 m long.",
            },
        ],
    },
    "PONT DE L'ARCHEVECHE": {
        "sources": "structurae.net/en/structures/bridge-of-the-archbishopric; waymarking.com (Pont de "
        "l'Archevêché - 1828)",
        "history": [
            {
                "from": 1828,
                "until": None,
                "kind": "stone",
                "arches": 3,
                "note": "Built 1826-1828: three masonry arches of 15, 17 and 15 m; the narrowest road bridge of Paris.",
            }
        ],
    },
    "PONT LOUIS-PHILIPPE": {
        "sources": "structurae.net/fr/ouvrages/pont-louis-philippe; en.wikipedia.org/wiki/Pont_Louis-Philippe",
        "history": [
            {
                "from": 1862,
                "until": None,
                "kind": "stone",
                "arches": 3,
                "note": "Built August 1860 - April 1862 (Féline-Romany and Savarin) a little upstream of the first "
                "bridge, straight across to the Île Saint-Louis.",
            }
        ],
    },
    "PONT DE LA TOURNELLE": {
        "sources": "parisjetaime.com (Pont de la Tournelle); pariszigzag.fr; structurae.net/structures/tournelle-bridge-1656",
        "history": [
            {
                "from": None,
                "until": 1918,
                "kind": "stone-old",
                "arches": 6,
                "note": "Stone bridge of 1656 with six round arches, pulled down from 1918 to let floods through.",
            },
            {
                "from": 1928,
                "until": None,
                "kind": "wide-centre",
                "arches": 3,
                "note": "Concrete faced with stone, 1924-1928: arches of 12, 74 and 11 m.",
            },
        ],
    },
}

# A crossing BD TOPO no longer holds. The first Pont Louis-Philippe (begun
# 29 July 1833, opened 26 July 1834; burned in 1848 and repaired, demolished
# from 1 August 1860) was a suspension bridge of two spans and three pylons,
# crossing obliquely from the right bank to the quai aux Fleurs by the north-
# west point of the Île Saint-Louis (structurae.net/fr/ouvrages/pont-louis-
# philippe; fr.wikipedia.org/wiki/Pont_Louis-Philippe; stereotheque.fr). The
# line below runs from the quai aux Fleurs through that point; the landing
# places are estimated, and so is the width.
OLD_LINES = {
    "cite": [
        {
            "key": "PONT LOUIS-PHILIPPE (1834)",
            "name": "Pont Louis-Philippe",
            "through": [(2.35226, 48.85300), (2.35299, 48.85368)],
            "width": 7.0,
            "sources": "structurae.net/fr/ouvrages/pont-louis-philippe; fr.wikipedia.org/wiki/Pont_Louis-Philippe",
            "history": [
                {
                    "from": 1834,
                    "until": 1860,
                    "kind": "suspension",
                    "arches": 2,
                    "note": "Two-span suspension bridge (Seguin brothers), right bank to the quai aux Fleurs over "
                    "the point of the Île Saint-Louis, drawn as one deck with its middle pylon on the point. "
                    "Landings and width estimated.",
                }
            ],
        }
    ]
}

KINDS = ("stone-old", "stone", "iron", "suspension", "timber", "iron-centre", "truss", "steel", "wide-centre")


def history_for(history: list[dict], span: int, spans: int) -> list[dict]:
    """The generations of one crossing, with the arch count for that crossing.

    `arches` given as a list is per crossing, longest crossing first; a
    crossing beyond the list (BD TOPO split one) takes the last value.
    """
    out = []
    for g in history:
        arches = g["arches"]
        if isinstance(arches, list):
            arches = arches[min(span, len(arches) - 1)] if spans > 1 else arches[0]
        out.append({k: v for k, v in {**g, "arches": int(arches)}.items() if v is not None or k in ("from", "until")})
    return out


def check_history(history: list[dict]) -> list[str]:
    """Problems with a bridge's dated history (empty when it is sound)."""
    problems = []
    last_until = None
    for g in history:
        start, end = g.get("from"), g.get("until")
        if g.get("kind") not in KINDS:
            problems.append(f"unknown kind {g.get('kind')}")
        if start is not None and end is not None and start >= end:
            problems.append(f"{start} is not before {end}")
        if last_until is not None and start is not None and start < last_until:
            problems.append(f"generations overlap at {start}")
        if last_until is None and start is None and g is not history[0]:
            problems.append("only the first generation may start open-ended")
        h = g.get("houses_until")
        if h is not None and ((start is not None and h <= start) or (end is not None and h > end)):
            problems.append(f"houses until {h} outside the bridge's years")
        if not g.get("note"):
            problems.append("no note")
        last_until = end if end is not None else 1e9
    return problems


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
        url = f"{WFS}?{urllib.parse.urlencode(params)}"
        for attempt in range(3):
            try:
                page = net.fetch_json(url, timeout=120).get("features", [])
                break
            except json.JSONDecodeError:  # the service sometimes answers with an empty body
                if attempt == 2:
                    raise
        out += page
        if len(page) < PAGE:
            return out


def clusters(lines: list, tolerance: float = 3.0) -> list[list]:
    """Group line segments that touch (within `tolerance` metres): one group per crossing."""
    groups: list[list] = []
    for ln in lines:
        touching = [g for g in groups if any(ln.distance(other) <= tolerance for other in g)]
        merged = [ln] + [x for g in touching for x in g]
        groups = [g for g in groups if g not in touching] + [merged]
    return groups


def crossings(lines: list, river, reach: float = 10.0) -> list:
    """Where the line through a group of segments crosses the river.

    The line runs through the group's two farthest points, extended across
    the water (some segments span only part of it); each crossing is cut to
    the water plus a few metres onto each bank. Only crossings within
    `reach` metres of the segments themselves are kept, so a bridge's line
    extended over the island does not invent a second crossing.
    """
    from shapely.geometry import LineString, MultiLineString, MultiPoint

    pts = MultiPoint([c for ln in lines for c in ln.coords])
    a, b = max(((p, q) for p in pts.geoms for q in pts.geoms), key=lambda pq: pq[0].distance(pq[1]))
    length = a.distance(b)
    if length < 3:
        return []
    ux, uy = (b.x - a.x) / length, (b.y - a.y) / length
    c = pts.centroid
    axis = LineString([(c.x - ux * 400, c.y - uy * 400), (c.x + ux * 400, c.y + uy * 400)])
    crossing = axis.intersection(river.buffer(4))
    parts = [crossing] if crossing.geom_type == "LineString" else list(getattr(crossing, "geoms", []))
    segments = MultiLineString(lines)
    return [p for p in parts if p.geom_type == "LineString" and p.length > 5 and p.distance(segments) <= reach]


def deck_of(span, width: float):
    """A deck polygon: the crossing line widened to `width` metres, square ends."""
    return span.buffer(width / 2, cap_style="flat")


def bridge_decks(roads: list[dict], water, to_metric, to_wgs, old_lines: list[dict] | None = None) -> list[dict]:
    """Bridge decks from the road segments BD TOPO marks as above ground,
    plus old crossings given by hand. One dict per crossing of the water:
    key (BD TOPO name), name, span (0 = longest crossing of that bridge),
    spans, deck (WGS 84 polygon) and its width and length in metres."""
    from shapely.geometry import LineString
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
        named.setdefault(name.upper(), []).append(line)
        widths[name.upper()] = max(widths.get(name.upper(), 0.0), float(p.get("largeur_de_chaussee") or 6.0))
    found: list[tuple[str, str, Any, float]] = []
    for key, lines in named.items():
        width = widths[key] * 1.2 + SIDEWALKS_M
        for group in clusters(lines):
            for span in crossings(group, river):
                found.append((key, bridge_name(key), span, width))
    for old in old_lines or []:
        (ax, ay), (bx, by) = (to_metric(*p) for p in old["through"])
        n = math.hypot(bx - ax, by - ay)
        ux, uy = (bx - ax) / n, (by - ay) / n
        axis = LineString([(ax - ux * 400, ay - uy * 400), (ax + ux * 400, ay + uy * 400)])
        crossing = axis.intersection(river.buffer(4))
        parts = [crossing] if crossing.geom_type == "LineString" else list(getattr(crossing, "geoms", []))
        # The arm before the first point and the one after the second, as one
        # deck: the middle pylon stood on the point between them.
        near = LineString([(ax - ux * 40, ay - uy * 40), (bx + ux * 160, by + uy * 160)])
        kept = [p for p in parts if p.length > 5 and p.intersection(near.buffer(1)).length > 5]
        if kept:
            along = [(c[0] - ax) * ux + (c[1] - ay) * uy for p in kept for c in p.coords]
            t0, t1 = min(along), max(along)
            span = LineString([(ax + ux * t0, ay + uy * t0), (ax + ux * t1, ay + uy * t1)])
            found.append((old["key"], old["name"], span, old["width"]))
    decks = []
    for key in dict.fromkeys(k for k, *_ in found):
        spans = sorted((f for f in found if f[0] == key), key=lambda f: -f[2].length)
        for i, (_, name, span, width) in enumerate(spans):
            deck = deck_of(span, width)
            if math.isfinite(deck.area) and deck.area > 0:
                decks.append(
                    {
                        "key": key,
                        "name": name,
                        "span": i,
                        "spans": len(spans),
                        "deck": transform(to_wgs, deck),
                        "width": round(width, 1),
                        "length": round(span.length, 1),
                    }
                )
    return decks


def bridge_features(decks: list[dict], ground_box, old_lines: list[dict], log: Callable[[str], Any] = print) -> list[dict]:
    """Site features for the decks that have a known history."""
    from shapely.geometry import mapping

    known = {**BRIDGES, **{o["key"]: o for o in old_lines}}
    out, skipped = [], set()
    for d in decks:
        entry = known.get(d["key"])
        if entry is None:
            skipped.add(d["name"])
            continue
        if not d["deck"].intersects(ground_box):
            continue
        out.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "bridge",
                    "name": d["name"],
                    "span": d["span"],
                    "width": d["width"],
                    "history": history_for(entry["history"], d["span"], d["spans"]),
                    "sources": entry["sources"],
                },
                "geometry": mapping(d["deck"]),
            }
        )
    if skipped:
        log(f"site: no history for {', '.join(sorted(skipped))}: left out")
    return out


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


# The ground box is the focus box plus this margin, where the detail fades
# out (the app fades over the outer 70 m).
GROUND_MARGIN = (0.0012, 0.0008)  # degrees, about 90 m
STREET_LEVEL_M = 34.0


def ground_box_of(area: str):
    from shapely.geometry import box

    fx0, fy0, fx1, fy1 = AREAS[area]["focus"]
    return box(fx0 - GROUND_MARGIN[0], fy0 - GROUND_MARGIN[1], fx1 + GROUND_MARGIN[0], fy1 + GROUND_MARGIN[1])


def fetch_river(bbox: tuple[float, float, float, float]):
    """The Seine (BD TOPO natural flow surfaces) and its mean water level in metres."""
    from shapely.geometry import shape
    from shapely.ops import unary_union

    shapes, levels = [], []
    for f in wfs("BDTOPO_V3:surface_hydrographique", bbox):
        if f["properties"].get("nature") != "Ecoulement naturel":
            continue  # the river, not fountain basins
        levels += zs(f["geometry"])
        shapes.append(shape(flat(f["geometry"])))
    if not shapes:
        return None, None
    return unary_union(shapes), (round(sum(levels) / len(levels), 1) if levels else None)


def riverside(water, within, distance_m: float, to_metric, to_wgs):
    """The islands in the river and everything within `distance_m` of the
    water, inside `within`: what the app draws in detail."""
    from shapely.geometry import Polygon
    from shapely.ops import transform, unary_union

    metric = transform(to_metric, water)
    islands = [Polygon(h) for p in getattr(metric, "geoms", [metric]) for h in p.interiors]
    zone = unary_union([metric.buffer(distance_m), *islands])
    return transform(to_wgs, zone).intersection(within)


def focus_area(area: str):
    """The detailed area of a model area (WGS 84 shapely geometry): its focus
    box, or, with `focus_river_m`, the islands and the banks that far from the
    Seine inside it. Used by model3d to flag the buildings drawn in detail."""
    from pyproj import Transformer
    from shapely.geometry import box

    cfg = AREAS[area]
    focus = box(*cfg["focus"])
    if not cfg.get("focus_river_m"):
        return focus
    water, _ = fetch_river(cfg["bbox"])
    if water is None:
        return focus
    to_metric = Transformer.from_crs(4326, 2154, always_xy=True).transform
    to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform
    return riverside(water, focus, cfg["focus_river_m"], to_metric, to_wgs)


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
    from shapely.geometry import box

    cfg = AREAS[area]
    x0, y0, x1, y1 = cfg["bbox"]
    ground_box = ground_box_of(area)
    gx0, gy0, gx1, gy1 = ground_box.bounds
    fetch = (min(x0, gx0) - 0.002, min(y0, gy0) - 0.002, max(x1, gx1) + 0.002, max(y1, gy1) + 0.002)
    water, level = fetch_river(fetch)
    features: list[dict] = []
    bridges = 0
    old_lines = OLD_LINES.get(area, [])
    if water is not None:
        water = water.intersection(box(*fetch))
        features = ground_features(water, ground_box)
        to_metric = Transformer.from_crs(4326, 2154, always_xy=True).transform
        to_wgs = Transformer.from_crs(2154, 4326, always_xy=True).transform
        decks = bridge_decks(wfs("BDTOPO_V3:troncon_de_route", fetch), water, to_metric, to_wgs, old_lines)
        found = bridge_features(decks, ground_box, old_lines, log)
        bridges = len(found)
        features += found
    for lm in LANDMARKS.get(area, []):
        props = {k: v for k, v in lm.items() if k != "at"}
        features.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": list(lm["at"])}})

    out = paths.DATA_DIR / "3d" / f"site-{area}.geojson"
    text = json.dumps(
        {
            "type": "FeatureCollection",
            "metadata": {
                "water_level_m": level,
                "street_level_m": STREET_LEVEL_M,
                "ground_box": [round(v, 6) for v in ground_box.bounds],
                "source": "IGN BD TOPO (Etalab 2.0); bridge histories from the sources listed with each bridge",
            },
            "features": features,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    import re

    text = re.sub(r"(-?\d+\.\d{7})\d+", r"\1", text)  # about 1 cm
    out.write_text(text)
    log(f"site: river at {level} m, {bridges} bridge crossing(s), {len(LANDMARKS.get(area, []))} landmark detail(s) -> {out.relative_to(paths.REPO_ROOT)} ({len(text) / 1e3:.0f} kB)")
    return {"area": area, "file": f"3d/site-{area}.geojson", "water_level_m": level, "bridges": bridges}

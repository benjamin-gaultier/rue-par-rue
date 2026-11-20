"""Named places that are not streets, for placing captions that name them.

Captions often name a garden, a square, a bridge, a market or a gate of the
city rather than a street: "jardin des Tuileries", "square René-Viviani",
"Pont Neuf", "porte d'Italie". The national address base has none of these,
so a small gazetteer is built once and committed under pipeline/cache:

* IGN BD TOPO (Licence Ouverte / Etalab 2.0), through the Géoplateforme WFS:
  the named public spaces of `zone_d_activite_ou_d_interet` (parks, gardens,
  squares, places, esplanades, promenades, forecourts), markets and market
  halls, monuments (the porte Saint-Denis), and bridges
  (`construction_surfacique` and `construction_lineaire` of nature "Pont");
* the City of Paris street outlines ("Dénominations des emprises des voies
  actuelles", ODbL, the table rpr.sources.streetnames reads), for the
  bridges, river ports, places, squares and courtyards that are public ways,
  and for the avenues and places named after the gates of the Thiers wall
  ("avenue de la Porte d'Italie"), which run out from where the gate stood.

Each place keeps its centre, its spread (half the diagonal of its outline's
bounding box, in metres) and the arrondissements it lies in. Only places
inside Paris are kept. A caption is matched on the whole name, never on part
of it, so "jardin du Luxembourg" is the garden and not the Musée du
Luxembourg.

Run `python -m rpr places` to rebuild pipeline/cache/paris-places.json.
"""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any, Callable, Iterable

from rpr import net, paths
from rpr.sources.streetnames import ARRONDISSEMENTS_DATASET, CURRENT_DATASET, ODS, norm

PLACES_PATH = paths.REPO_ROOT / "pipeline" / "cache" / "paris-places.json"
RAW = paths.REPO_ROOT / "pipeline" / "cache" / "places"  # downloads, not committed (`rpr places --refresh` fetches again)
PARIS_BBOX = (2.224, 48.815, 2.470, 48.903)  # lon, lat; trimmed to the arrondissements afterwards

BDTOPO_CREDIT = "IGN BD TOPO (Licence Ouverte / Etalab 2.0)"
VOIES_CREDIT = "Ville de Paris, Dénominations des emprises des voies actuelles (ODbL)"

# BD TOPO public-interest areas kept, by (nature, nature_detaillee); None matches any.
BDTOPO_KINDS = {
    ("Espace public", None): "public space",
    ("Marché", None): "market",
    ("Monument", None): "monument",
    ("Monument", "Porte"): "monument",
}
BDTOPO_SKIP_DETAIL = {"Statue", "Stèle", "Mémorial", "Monument aux morts", "Croix de Lorraine", "Jardins familiaux"}
# City of Paris ways kept: the kinds of way a caption names as a place.
VOIE_TYPES = {
    "place", "placette", "square", "cour", "cours", "promenade", "pont", "passerelle", "port", "esplanade",
    "galerie", "porte", "carrefour", "parvis", "rond-point", "jardin", "terrasse",
}
GATE_WAY = re.compile(r"^(?:avenue|place) de la porte\b", re.IGNORECASE)  # named after a gate of the Thiers wall


# ------------------------------------------------------------ geometry


def _parts(geom: dict) -> list[tuple[list[list[float]], bool]]:
    """(points, is_area) for each outer ring of a (multi)polygon and each line or point."""
    t, c = geom.get("type"), geom.get("coordinates") or []
    if t == "Polygon":
        return [(c[0], True)] if c else []
    if t == "MultiPolygon":
        return [(q[0], True) for q in c if q]
    if t == "LineString":
        return [(c, False)]
    if t == "MultiLineString":
        return [(line, False) for line in c]
    if t == "Point":
        return [([c], False)]
    return []


def _rings(geom: dict) -> list[list[list[float]]]:
    return [pts for pts, _ in _parts(geom)]


def _area_centroid(ring: list[list[float]]) -> tuple[float, float, float]:
    """(x, y, area) of a closed ring by the shoelace formula, in degrees."""
    a = cx = cy = 0.0
    for (x0, y0, *_), (x1, y1, *_) in zip(ring, ring[1:] + ring[:1]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-14:
        return 0.0, 0.0, 0.0
    return cx / (3 * a), cy / (3 * a), abs(a) / 2


def centre_and_spread(parts: list[tuple[list[list[float]], bool]]) -> tuple[tuple[float, float], float] | None:
    """Centre (area-weighted over polygons, else length-weighted over lines) and half the bounding-box diagonal in metres."""
    parts = [(pts, area) for pts, area in parts if pts]
    if not parts:
        return None
    areas = [_area_centroid(pts) for pts, area in parts if area]
    total = sum(w for _, _, w in areas)
    if total > 0:
        cx, cy = sum(x * w for x, _, w in areas) / total, sum(y * w for _, y, w in areas) / total
    else:
        segs = [(a, b) for pts, _ in parts for a, b in zip(pts, pts[1:])]
        lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in segs]
        if sum(lengths) > 0:
            cx = sum((a[0] + b[0]) / 2 * w for (a, b), w in zip(segs, lengths)) / sum(lengths)
            cy = sum((a[1] + b[1]) / 2 * w for (a, b), w in zip(segs, lengths)) / sum(lengths)
        else:
            pts = [q for pts, _ in parts for q in pts]
            cx, cy = sum(q[0] for q in pts) / len(pts), sum(q[1] for q in pts) / len(pts)
    xs = [q[0] for pts, _ in parts for q in pts]
    ys = [q[1] for pts, _ in parts for q in pts]
    k = math.cos(math.radians(cy))
    diag = math.hypot((max(xs) - min(xs)) * 111_320 * k, (max(ys) - min(ys)) * 110_540)
    return (round(cx, 6), round(cy, 6)), round(diag / 2)


def _inside(x: float, y: float, ring: list[list[float]]) -> bool:
    """Ray casting point-in-polygon test."""
    hit = False
    for (x0, y0, *_), (x1, y1, *_) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


class Arrondissements:
    """Which arrondissement a point lies in, from the City of Paris outlines."""

    def __init__(self, features: list[dict]):
        self.polys = [(int(f["properties"]["c_ar"]), _rings(f["geometry"])) for f in features]

    def of(self, x: float, y: float) -> int | None:
        for arr, rings in self.polys:
            if any(_inside(x, y, r) for r in rings):
                return arr
        return None

    def touched(self, parts: list[tuple[list[list[float]], bool]], centre: tuple[float, float], samples: int = 40) -> list[int]:
        """Arrondissements of the centre and of points spread along the outline."""
        points = [q for pts, _ in parts for q in pts]
        step = max(1, len(points) // samples)
        found = {self.of(*centre)} | {self.of(p[0], p[1]) for p in points[::step]}
        return sorted(a for a in found if a)


# ------------------------------------------------------------ building


def bdtopo_kind(props: dict) -> str | None:
    nature, detail = props.get("nature"), props.get("nature_detaillee")
    if nature == "Pont":
        return "bridge"
    if detail in BDTOPO_SKIP_DETAIL:
        return None
    return BDTOPO_KINDS.get((nature, detail)) or BDTOPO_KINDS.get((nature, None))


def _distance_m(a: list[float] | tuple[float, float], b: list[float] | tuple[float, float]) -> float:
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * 111_320 * k, (a[1] - b[1]) * 110_540)


def build_places(
    bdtopo: Iterable[dict], voies: Iterable[dict], arrondissements: Arrondissements, merge_m: float = 300
) -> dict[str, list[dict]]:
    """Gazetteer keyed by normalised name.

    Pieces of one source with the same name less than merge_m apart are one
    place (the two arms of the Pont Neuf). A City of Paris way that BD TOPO
    already has under that name, within merge_m, is left out.
    """
    pieces: dict[tuple[str, str], list[dict]] = {}  # (key, source) -> places being gathered

    def add(name: str, kind: str, geom: dict, source: str) -> None:
        parts = _parts(geom)
        cs = centre_and_spread(parts)
        if not cs:
            return
        group = pieces.setdefault((norm(name), source), [])
        for g in group:
            if _distance_m(g["first"], cs[0]) <= merge_m:
                g["parts"] += parts
                return
        group.append({"name": name, "kind": kind, "first": cs[0], "parts": parts})

    for f in bdtopo:
        p = f.get("properties") or {}
        name, kind = (p.get("toponyme") or "").strip(), bdtopo_kind(p)
        if name and kind and f.get("geometry"):
            add(name, kind, f["geometry"], "bdtopo")
    for f in voies:
        p = f.get("properties") or {}
        name, typ = (p.get("typo_min") or "").strip(), (p.get("typvoie") or "").lower()
        if not name or not f.get("geometry"):
            continue
        if typ in VOIE_TYPES or GATE_WAY.match(name):
            add(name[0].upper() + name[1:], "gate way" if GATE_WAY.match(name) else typ, f["geometry"], "voies")

    table: dict[str, list[dict]] = {}
    for key, source in sorted(pieces, key=lambda ks: (ks[0], ks[1] != "bdtopo")):
        for g in pieces[(key, source)]:
            centre, spread = centre_and_spread(g["parts"])
            arr = arrondissements.touched(g["parts"], centre)
            if not arr:
                continue  # outside Paris
            if source != "bdtopo" and any(_distance_m(e["center"], centre) <= merge_m for e in table.get(key, [])):
                continue
            table.setdefault(key, []).append(
                {"name": g["name"], "kind": g["kind"], "center": list(centre), "spread": spread, "arr": arr, "source": source}
            )
    return {k: table[k] for k in sorted(table)}


def _cached(name: str, fetch: Callable[[], Any], refresh: bool) -> Any:
    path = RAW / name
    if refresh or not path.exists():
        RAW.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        tmp.write_text(json.dumps(fetch(), ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    return json.loads(path.read_text(encoding="utf-8"))


def build(log: Callable[[str], Any] = print, refresh: bool = False) -> dict:
    from rpr.sources.site import wfs

    arr_geo = _cached(
        "arrondissements.geojson", lambda: net.fetch_json(ODS.format(id=ARRONDISSEMENTS_DATASET, fmt="geojson"), timeout=180), refresh
    )
    arrondissements = Arrondissements(arr_geo["features"])
    bdtopo: list[dict] = []
    for layer in ("zone_d_activite_ou_d_interet", "construction_surfacique", "construction_lineaire"):
        feats = _cached(f"bdtopo-{layer}.json", lambda layer=layer: wfs(f"BDTOPO_V3:{layer}", PARIS_BBOX), refresh)
        bdtopo += [f for f in feats if (f.get("properties") or {}).get("toponyme")]
        log(f"places: BD TOPO {layer}: {len(feats)} features")
    voies = _cached(
        "voies.geojson",
        lambda: net.fetch_json(ODS.format(id=CURRENT_DATASET, fmt="geojson") + "?select=typo_min,typvoie,geo_shape", timeout=300),
        refresh,
    )["features"]
    log(f"places: {len(voies)} City of Paris ways")
    table = build_places(bdtopo, voies, arrondissements)
    PLACES_PATH.parent.mkdir(parents=True, exist_ok=True)
    PLACES_PATH.write_text(
        json.dumps({"source": [BDTOPO_CREDIT, VOIES_CREDIT], "places": table}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    n = sum(len(v) for v in table.values())
    log(f"places: {n} places under {len(table)} names -> {PLACES_PATH.name}")
    return {"places": n, "names": len(table), "file": PLACES_PATH.relative_to(paths.REPO_ROOT).as_posix()}


# ------------------------------------------------------------ lookups

_PARTICLES = {"de", "la", "le", "les", "des", "du", "d", "l", "aux", "au", "a", "en"}


def _skeleton(key: str) -> str:
    return " ".join(w for w in key.split() if w not in _PARTICLES)



class Places:
    """Lookups in the gazetteer by a caption's name for a place."""

    def __init__(self, places: dict[str, list[dict]] | None = None):
        self.places = places or {}
        # Names with their particles dropped ("square Vert-Galant"), where only one name has that form.
        loose: dict[str, set[str]] = {}
        for key in self.places:
            loose.setdefault(_skeleton(key), set()).add(key)
        self.loose = {k: next(iter(v)) for k, v in loose.items() if len(v) == 1}

    @classmethod
    def load(cls, path: Path = PLACES_PATH) -> "Places":
        if not path.exists():
            return cls()
        return cls(json.loads(path.read_text(encoding="utf-8")).get("places", {}))

    def find(self, name: str, arrondissement: int | None = None) -> list[dict]:
        """Places with this name (accents, case, hyphens and particles aside), in the arrondissement when given."""
        key = norm(name)
        entries = self.places.get(key) or self.places.get(self.loose.get(_skeleton(key), ""), [])
        if arrondissement:
            entries = [e for e in entries if arrondissement in e["arr"]]
        return entries

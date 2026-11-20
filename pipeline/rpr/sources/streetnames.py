"""Historical street names, for placing captions that name old streets.

Two reference tables, built once and committed under pipeline/cache so that
harvests (including the GitHub Actions one) need no extra downloads:

* former-street-names.json: the City of Paris "Dénominations caduques des
  voies" (ODbL). Each retired name points to the street(s) that carry it
  today, read from the record's history ("Actuellement rue de la Tacherie",
  "Dénommée rue de Lutèce par arrêté ...", "Voir : Harpe (rue de la)").
  Streets that were simply demolished have no successor and are marked
  removed; the 1836 table below is what places those.
* vasserot-1836.json: the ALPAGE address points of the Vasserot cadastre
  (1810-1836, ODbL), grouped by street. Each street keeps its numbered
  points, its centre and how far its points spread, and the arrondissements
  of today it falls in. A street name used in two places becomes two entries.

Run `python -m rpr streetnames` (needs the [geo] extras) to rebuild them.
"""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from rpr import net, paths

ODS = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/{id}/exports/{fmt}"
FORMER_DATASET = "denominations-des-voies-caduques"
CURRENT_DATASET = "denominations-emprises-voies-actuelles"
ARRONDISSEMENTS_DATASET = "arrondissements"

CACHE_DIR = paths.REPO_ROOT / "pipeline" / "cache"
FORMER_PATH = CACHE_DIR / "former-street-names.json"
VASSEROT_PATH = CACHE_DIR / "vasserot-1836.json"

VASSEROT_EPSG = 27561  # NTF (Paris) Lambert Nord, as in rpr.sources.vasserot_plans
CLUSTER_GAP_M = 250  # address points of one street further apart than this are two streets

FORMER_CREDIT = "Ville de Paris, Dénominations caduques des voies (ODbL)"
VASSEROT_CREDIT = "ALPAGE, Vasserot address points 1810-1836 (ODbL)"

# Abbreviations used in the histories ("Actuellement av. de New York").
_ABBREVIATIONS = [
    (r"\bav\.?(?=\s)", "avenue"),
    (r"\bbd\.?(?=\s)", "boulevard"),
    (r"\bimp\.?(?=\s)", "impasse"),
    (r"\bpas\.?(?=\s)", "passage"),
    (r"\bpl\.?(?=\s)", "place"),
    (r"\bsq\.?(?=\s)", "square"),
]
# Phrases that introduce where a retired name went, latest state first.
_SUCCESSOR = re.compile(
    r"(Actuellement|Dénommée?s?|Devenue?s?|Englobée?s? dans|Absorbée?s? par|Réunie?s? à|"
    r"Incorporée?s? (?:à|dans)|correspond actuellement (?:à|au|aux))",
    re.IGNORECASE,
)
_SEE = re.compile(r"Voir\s*:\s*([^.(]+?)\s*\(([^)]+)\)")
_LEGAL = re.compile(r"\s+(?:par|suivant)\s+(?:un\s+|l['’]\s*|le\s+)?(?:arrêté|décret|délibération|ordonnance|lettres|loi|décision)", re.IGNORECASE)


def norm(s: str) -> str:
    """Accent-, case- and punctuation-free form used as the lookup key."""
    s = s.replace("œ", "oe").replace("Œ", "Oe").replace("æ", "ae")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\bst\b", "saint", s)
    s = re.sub(r"\bste\b", "sainte", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


_PARTICLES = {"de", "la", "le", "les", "des", "du", "d", "l", "aux", "au", "a", "en"}


def sound(key: str) -> str:
    """A spelling-free form of a normalised name: Georgeau = Georgeot, Grammont = Gramont."""
    words = []
    for w in key.split():
        if w in _PARTICLES:
            continue
        w = re.sub(r"[sx]$", "", w) if len(w) > 3 else w
        w = re.sub(r"(?:eau|eot|aut|aud|ault|ot|au)$", "o", w)
        w = w.replace("eau", "o").replace("ph", "f").replace("qu", "k").replace("y", "i")
        w = re.sub(r"c(?=[aou])", "k", w)
        w = re.sub(r"(.)\1+", r"\1", w)
        words.append(w)
    return " ".join(words)


def _arrondissements(text: str | None) -> list[int]:
    return sorted({int(m) for m in re.findall(r"(\d{1,2})\s*e\b", text or "") if 1 <= int(m) <= 20})


def parse_history(history: str | None) -> dict:
    """Read where a retired street name went from its history text.

    Returns {"to": [current street, ...], "part": bool, "see": str | None,
    "removed": bool}. "part" means the old street is now only a part of the
    named one(s); "see" redirects to another retired name.
    """
    from rpr.geocode import _STREET, _clean  # local import: geocode imports this module

    text = history or ""
    for pattern, full in _ABBREVIATIONS:
        text = re.sub(pattern, full, text, flags=re.IGNORECASE)
    out: dict[str, Any] = {"to": [], "part": False, "see": None, "removed": bool(re.match(r"\s*Supprim", text, re.IGNORECASE))}
    see = _SEE.search(text)
    if see and not _SUCCESSOR.search(text):
        out["see"] = f"{see.group(2).strip()} {see.group(1).strip()}"
        return out
    # The last successor phrase that names a street is the current state. In
    # the history of a demolished street, "dénommée" introduces its own older
    # names, so only phrases about today count there.
    for m in reversed(list(_SUCCESSOR.finditer(text))):
        if out["removed"] and re.match(r"(?:Dénommé|Devenu)", m.group(1), re.IGNORECASE):
            continue
        segment = _LEGAL.split(text[m.start():])[0]
        segment = re.split(r"\.\s", segment)[0]
        names = [_clean(x.group(1)) for x in _STREET.finditer(segment)]
        names = [n for n in names if len(n.split()) >= 2]
        if names:
            out["to"] = list(dict.fromkeys(names))
            out["part"] = bool(re.search(r"\bparties?\b", segment, re.IGNORECASE))
            return out
    return out


def build_former(records: list[dict], current: set[str]) -> dict[str, list[dict]]:
    """Index retired names by key, following chains to names in use today."""
    entries: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        name = (r.get("typo_min") or "").strip()
        if not name:
            continue
        h = parse_history(r.get("historique"))
        until = (r.get("date_voie_ancienne") or "")[:4]
        entry = {"name": name, "arr": _arrondissements(r.get("arrdt"))}
        if until.isdigit():
            entry["until"] = int(until)
        if h["to"]:
            entry["to"] = h["to"]
            if h["part"]:
                entry["part"] = True
        elif h["see"]:
            entry["see"] = h["see"]
        else:
            entry["removed"] = True
        entries[norm(name)].append(entry)

    def resolve(names: list[str], depth: int = 0) -> list[str]:
        out = []
        for n in names:
            k = norm(n)
            if k in current or k not in entries or depth > 4:
                out.append(n)
                continue
            nxt = [t for e in entries[k] for t in e.get("to", [])]
            out.extend(resolve(nxt, depth + 1) if nxt else [n])
        return list(dict.fromkeys(out))

    for key, items in entries.items():
        for e in items:
            if "see" in e:
                target = entries.get(norm(e["see"]), [])
                to = [t for t2 in target for t in t2.get("to", [])]
                if to:
                    e["to"] = to
                    e.pop("see")
                    if any(t2.get("part") for t2 in target):
                        e["part"] = True
                elif any(t2.get("removed") for t2 in target):
                    e["removed"] = True
                    e.pop("see")
                else:
                    e.pop("see")
                    e["removed"] = True
            if "to" in e:
                e["to"] = resolve(e["to"])
        # Identical entries (same name, same successor) add nothing.
        seen, unique = set(), []
        for e in items:
            sig = json.dumps(e, sort_keys=True, ensure_ascii=False)
            if sig not in seen:
                seen.add(sig)
                unique.append(e)
        entries[key] = unique
    return dict(sorted(entries.items()))


def _cluster(points: list[tuple[float, float, Any]], gap: float) -> list[list[tuple[float, float, Any]]]:
    """Single-linkage clusters of projected points (metres)."""
    left = list(range(len(points)))
    clusters = []
    while left:
        seed = left.pop()
        group, frontier = [seed], [seed]
        while frontier:
            i = frontier.pop()
            xi, yi = points[i][0], points[i][1]
            near = [j for j in left if (points[j][0] - xi) ** 2 + (points[j][1] - yi) ** 2 <= gap * gap]
            for j in near:
                left.remove(j)
            group.extend(near)
            frontier.extend(near)
        clusters.append([points[i] for i in group])
    return clusters


def build_vasserot(records: list[dict], arrondissement_of: Callable[[float, float], int | None], to_wgs: Callable) -> dict:
    """Group address points by street name and place.

    `records` carry NOM_ENTIER, NUM_VOIES, QUARTIER and x, y in EPSG:27561.
    """
    by_name: dict[str, list[tuple[float, float, dict]]] = defaultdict(list)
    names: dict[str, str] = {}
    quarters: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for r in records:
        quarters[r["QUARTIER"]].append((r["x"], r["y"]))
        name = re.sub(r"\s+", " ", str(r.get("NOM_ENTIER") or "")).replace("' ", "'").strip()
        if not name:
            continue
        key = norm(name)
        names.setdefault(key, name)
        by_name[key].append((r["x"], r["y"], r))

    def wgs(x: float, y: float) -> list[float]:
        lon, lat = to_wgs(x, y)
        return [round(lon, 6), round(lat, 6)]

    streets: dict[str, list[dict]] = {}
    for key, pts in sorted(by_name.items()):
        out = []
        for group in _cluster(pts, CLUSTER_GAP_M):
            cx = sum(p[0] for p in group) / len(group)
            cy = sum(p[1] for p in group) / len(group)
            spread = max(math.hypot(p[0] - cx, p[1] - cy) for p in group)
            numbers: dict[str, list[tuple[float, float]]] = defaultdict(list)
            arr: dict[int, int] = defaultdict(int)
            q: dict[str, int] = defaultdict(int)
            for x, y, r in group:
                num = str(r.get("NUM_VOIES") or "").strip().lower().replace(" ", "")
                if num:
                    numbers[num].append((x, y))
                a = arrondissement_of(x, y)
                if a:
                    arr[a] += 1
                q[r["QUARTIER"]] += 1
            out.append(
                {
                    "name": names[key],
                    "quarter": max(q, key=lambda k: q[k]),
                    "arr": sorted(arr, key=lambda a: -arr[a]),
                    "center": wgs(cx, cy),
                    "spread": round(spread),
                    "numbers": {
                        n: wgs(sum(p[0] for p in v) / len(v), sum(p[1] for p in v) / len(v))
                        for n, v in sorted(numbers.items(), key=lambda kv: _num_sort(kv[0]))
                    },
                }
            )
        out.sort(key=lambda e: -len(e["numbers"]))
        streets[key] = out
    quarter_centres = {}
    for qname, pts in sorted(quarters.items()):
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)
        quarter_centres[norm(qname)] = {
            "name": qname,
            "center": wgs(cx, cy),
            "spread": round(max(math.hypot(p[0] - cx, p[1] - cy) for p in pts)),
        }
    return {"streets": streets, "quarters": quarter_centres}


def _num_sort(n: str) -> tuple[int, str]:
    m = re.match(r"\d+", n)
    return (int(m.group()) if m else 10**6, n)


def _write(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, sort_keys=False, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")


def build(log: Callable[[str], Any] = print) -> dict:
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import Point, shape
    from shapely.strtree import STRtree

    from rpr.sources import vasserot_plans

    former = net.fetch_json(ODS.format(id=FORMER_DATASET, fmt="json"), timeout=180)
    current_rows = net.fetch_json(ODS.format(id=CURRENT_DATASET, fmt="json") + "?select=typo_min", timeout=180)
    current = {norm(r["typo_min"]) for r in current_rows if r.get("typo_min")}
    table = build_former(former, current)
    _write(FORMER_PATH, {"source": FORMER_CREDIT, "names": table})
    log(f"streetnames: {len(former)} retired names, {len(table)} keys -> {FORMER_PATH.name}")

    arr_geo = net.fetch_json(ODS.format(id=ARRONDISSEMENTS_DATASET, fmt="geojson"), timeout=180)
    polys = [(shape(f["geometry"]), int(f["properties"]["c_ar"])) for f in arr_geo["features"]]
    tree = STRtree([p for p, _ in polys])
    to_wgs = Transformer.from_crs(VASSEROT_EPSG, 4326, always_xy=True).transform

    def arrondissement_of(x: float, y: float) -> int | None:
        pt = Point(*to_wgs(x, y))
        for i in tree.query(pt):
            if polys[int(i)][0].contains(pt):
                return polys[int(i)][1]
        return None

    shp = vasserot_plans.download_layer(vasserot_plans.ADDRESS_DRUID, vasserot_plans.ADDRESS_STEM, log)
    reader = shapefile.Reader(str(shp), encoding="latin-1")
    fields = [f[0] for f in reader.fields[1:]]
    records = []
    for sr in reader.iterShapeRecords():
        d = dict(zip(fields, sr.record))
        x, y = sr.shape.points[0]
        records.append({**d, "x": x, "y": y})
    v = build_vasserot(records, arrondissement_of, to_wgs)
    _write(VASSEROT_PATH, {"source": VASSEROT_CREDIT, **v})
    n_entries = sum(len(e) for e in v["streets"].values())
    log(f"streetnames: {len(records)} address points, {n_entries} streets of 1836 -> {VASSEROT_PATH.name}")
    return {
        "former_names": len(table),
        "streets_1836": n_entries,
        "files": [str(FORMER_PATH.relative_to(paths.REPO_ROOT)), str(VASSEROT_PATH.relative_to(paths.REPO_ROOT))],
    }


class StreetHistory:
    """Lookups in the two tables: former names, and streets of 1836."""

    def __init__(self, former: dict[str, list[dict]] | None = None, vasserot: dict | None = None):
        self.former = former or {}
        self.streets: dict[str, list[dict]] = (vasserot or {}).get("streets", {})
        self.quarters: dict[str, dict] = (vasserot or {}).get("quarters", {})
        self.sounds: dict[str, list[str]] = defaultdict(list)  # spelling-free key -> 1836 keys
        for key in self.streets:
            self.sounds[sound(key)].append(key)

    @classmethod
    def load(cls, former_path: Path = FORMER_PATH, vasserot_path: Path = VASSEROT_PATH) -> "StreetHistory":
        former = json.loads(former_path.read_text(encoding="utf-8"))["names"] if former_path.exists() else {}
        vasserot = json.loads(vasserot_path.read_text(encoding="utf-8")) if vasserot_path.exists() else {}
        return cls(former, vasserot)

    def streets_1836(self, name: str, arrondissement: int | None = None) -> list[dict]:
        """Places a street of this name had in 1836, biggest first, within the arrondissement of today.

        Spelling variants count ("Clos-Georgeau" is "Clos Georgeot" in the
        cadastre), and so does a retired name the caption's one became
        ("rue des Orties-Saint-Honoré", later "rue des Orties").
        """
        key = norm(name)
        keys = [key] if key in self.streets else self.sounds.get(sound(key), [])
        if not keys:
            for e in self.former_names(name, arrondissement):
                for t in e.get("to", []):
                    if any(x.get("removed") for x in self.former.get(norm(t), [])):
                        keys.extend(k for k in ([norm(t)] if norm(t) in self.streets else self.sounds.get(sound(norm(t)), [])) if k not in keys)
        entries = [e for k in keys for e in self.streets[k]]
        if arrondissement:
            entries = [e for e in entries if arrondissement in e["arr"]]
        return sorted(entries, key=lambda e: -len(e["numbers"]))

    def former_names(self, name: str, arrondissement: int | None = None) -> list[dict]:
        """Retired streets of this name; those known to be in the arrondissement when it is given."""
        entries = self.former.get(norm(name), [])
        if arrondissement:
            located = [e for e in entries if arrondissement in e["arr"]]
            entries = located or [e for e in entries if not e["arr"]]
        return entries

    def quarter(self, name: str) -> dict | None:
        key = norm(name)
        key = re.sub(r"^(?:quartier|ile)\s+(?:de la |de l |du |des |de |d )?", "", key) if key.startswith("quartier") else key
        key = {"ile de la cite": "cite"}.get(key, key)
        return self.quarters.get(key)

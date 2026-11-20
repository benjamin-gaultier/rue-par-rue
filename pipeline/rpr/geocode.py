"""Place archive captions on the map.

Captions in the Paris Musées catalogue follow a few habits:

    "Passage de l'Opéra, vue prise de la rue Lepeletier, 9ème arrondissement, Paris."
    "Boulevard Henri IV (de la rue de Sully)"
    "Vieille maison à l'angle de la rue d'Arras et de la rue Clopin, 5ème arrondissement"
    "Hôtel Lambert, 13 quai d'Anjou, 4ème arrondissement, Paris."

We pull out the arrondissement, the street names, the house numbers and the
street the view was taken from ("vue prise de", "(de la rue ...)"). Each
street is then looked up, most precise answer first:

1. today's street of that name in the national address base (BAN, through
   the IGN Géoplateforme geocoder), at the house number when there is one;
2. the street as it was in 1836 (ALPAGE address points of the Vasserot
   cadastre), at its numbered house when there is one, for streets that were
   demolished;
3. a former street name (City of Paris "dénominations caduques") and the
   street that carries it today;
4. today's street with a close name (BAN score of 0.8 or more), unless the
   name is a known historical one.

Two streets of a junction ("Rue X, vue prise de la rue Y", "à l'angle de")
are placed at their corner: where their 1836 address points meet, else
where today's street outlines meet (streets laid out after 1836, such as the
boulevard du Palais). Streets that only meet across a third one get no corner.
Confidence follows precision: house number, corner, street, quarter. A name
that could mean several places is placed on the likeliest one and flagged.
Nothing is placed on a street that cannot be found: no position is invented.
"""

from __future__ import annotations

import json
import math
import re
import urllib.parse
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from rpr import net

if TYPE_CHECKING:
    from rpr.sources.streetnames import StreetHistory

GEOCODER = "https://data.geopf.fr/geocodage/search"
MIN_SCORE = 0.8
CORNER_MAX_M = 30  # 1836 address points of two streets closer than this: they meet

# Confidence by how precisely the caption pins the photo down.
CONFIDENCE = {
    "number": 0.6,  # today's address of the building in the caption
    "number_1836": 0.5,  # the address of a demolished street, in 1836
    "number_1836_today": 0.4,  # 1836 address on a street whose number is gone today
    "corner": 0.5,  # junction of two streets
    "street_viewpoint": 0.35,  # anywhere along the street the view was taken from
    "street_subject": 0.25,  # anywhere along the street shown
    "former_viewpoint": 0.3,  # today's successor of a renamed street
    "former_subject": 0.2,
    "quarter": 0.1,  # only a quarter or island is named
}
AMBIGUOUS_FACTOR = 0.6  # the name could also mean another place
PART_FACTOR = 0.8  # the old street is only part of today's
LONG_STREET_M = 300  # 1836 streets whose points spread further than this
LONG_STREET_FACTOR = 0.8

STREET_TYPES = (
    "rue|boulevard|bd|avenue|av\\.|place|quai|passage|impasse|cour|cité|cite|pont|square|carrefour|"
    "marché|marche|porte|chaussée|chaussee|faubourg|allée|allee|villa|ruelle|parvis|port|galerie|"
    "rond-point|esplanade|cloître|cloitre|hameau|sentier|chemin|route|jardin"
)
_PARTICLE = r"(?:(?i:de la|de l['’]|des|du|de|d['’]|aux|au|à)\s*)?"
_STOP = (
    r"(?=\s*(?:[,;:()]|\.\s*$|$)|(?i:\s+(?:et|vue|près|pres|côté|cote|depuis|vers|n°|à l['’]angle|au coin)\b)|\s+\d)"
)
# Street type (any case), optional particle, then a capitalised name.
_STREET = re.compile(rf"\b((?i:{STREET_TYPES})\s+{_PARTICLE}[A-ZÀ-Ý0-9][^,;:()]*?){_STOP}")
_ARRONDISSEMENT = re.compile(r"\b(\d{1,2})\s*(?:e|è|ème|eme|er|ère)\s+arr(?:ondissement|\.)?", re.IGNORECASE)
_VIEW_FROM = re.compile(
    r"(?:vue\s+prise\s+d[eu]s?\s+|vue\s+d[eu]s?\s+|\(\s*d[eu]s?\s+|\(\s*depuis\s+|depuis\s+|,\s*d[eu]s?\s+)"
    r"(?:la\s+|l['’]\s*|le\s+|les\s+)?",
    re.IGNORECASE,
)
# "9 rue Férou", "51 et 53 rue ...", "60-62 rue ...", "15, rue ...", "au 29 rue ..."
_NUMBER_BEFORE = re.compile(
    r"(?<![\d/])(\d{1,3})\s*(?:bis|ter)?(?:\s*(?:et|à|-|,)\s*\d{1,3}\s*(?:bis|ter)?)*\s*,?\s*$",
    re.IGNORECASE,
)
# "rue ..., n° 12", "rue ... n°12"
_NUMBER_AFTER = re.compile(r"^\s*,?\s*(?:n°|no\.?|numéro)\s*(\d{1,3})\b", re.IGNORECASE)
_CORNER = re.compile(r"\b(?:angle|coin|carrefour|croisement|encoignure)\b", re.IGNORECASE)
_QUARTER = re.compile(
    r"\b(île\s+(?:de\s+la\s+Cité|Saint-Louis|Saint\s+Louis)|quartier\s+(?:de\s+la\s+|de\s+l['’]\s*|du\s+|des\s+|de\s+|d['’]\s*)?[A-ZÀ-Ý][\w'’ -]*?)(?=\s*[,;:().]|$)",
    re.IGNORECASE,
)


@dataclass
class ParsedCaption:
    streets: list[str]
    viewpoint: str | None
    arrondissement: int | None
    numbers: dict[str, str] = field(default_factory=dict)
    corner: bool = False
    quarter: str | None = None
    corner_pair: tuple[str, str] | None = None  # the streets either side of the corner word

    @property
    def citycode(self) -> str | None:
        if self.arrondissement and 1 <= self.arrondissement <= 20:
            return f"751{self.arrondissement:02d}"
        return None

    def candidates(self) -> list[tuple[str, str]]:
        """Streets to try, best first, each tagged 'viewpoint' or 'subject'."""
        out: list[tuple[str, str]] = []
        if self.viewpoint:
            out.append((self.viewpoint, "viewpoint"))
        for s in self.streets:
            if s != self.viewpoint:
                out.append((s, "subject"))
        return out

    def junction(self) -> tuple[str, str] | None:
        """The two streets that meet where the photo was taken, if the caption says so."""
        if self.viewpoint:
            others = [s for s in self.streets if s != self.viewpoint]
            if others:
                return others[0], self.viewpoint
        if self.corner and self.corner_pair:
            return self.corner_pair
        if self.corner and len(self.streets) >= 2:
            return self.streets[0], self.streets[1]
        return None


def _clean(street: str) -> str:
    street = re.sub(r"\s+", " ", street).strip(" .'\"’")
    street = re.sub(r"^bd\b", "boulevard", street, flags=re.IGNORECASE)
    street = re.sub(r"^av\.", "avenue", street, flags=re.IGNORECASE)
    return street


def parse_caption(caption: str) -> ParsedCaption:
    text = caption.replace(" ", " ").strip().strip('"')
    arr = _ARRONDISSEMENT.search(text)
    streets: list[str] = []
    spans: list[tuple[int, int, str]] = []
    numbers: dict[str, str] = {}
    for m in _STREET.finditer(text):
        s = _clean(m.group(1))
        if len(s.split()) < 2:
            continue
        if s.lower() not in (x.lower() for x in streets):
            streets.append(s)
            spans.append((m.start(1), m.end(1), s))
        nb = _NUMBER_BEFORE.search(text[: m.start(1)])
        na = _NUMBER_AFTER.match(text[m.end(1):])
        number = nb.group(1) if nb else na.group(1) if na else None
        if number and s not in numbers and int(number) > 0:
            numbers[s] = number
    viewpoint = None
    vm = _VIEW_FROM.search(text)
    if vm:
        after = text[vm.end():]
        m = _STREET.match(after)
        if m:
            viewpoint = _clean(m.group(1))
            if viewpoint.lower() not in (x.lower() for x in streets):
                streets.append(viewpoint)
    qm = _QUARTER.search(text)
    cm = _CORNER.search(text)
    corner_pair = None
    if cm:
        # "Pont Saint-Michel, le quai des Orfèvres à l'angle du boulevard du
        # Palais": the corner is the street before the word and the one after
        # it; "Angle de la rue X et de la rue Y": the two after it.
        before = [s for start, end, s in spans if end <= cm.start()]
        after = [s for start, end, s in spans if start >= cm.end()]
        if after and (before or len(after) > 1):
            corner_pair = (before[-1] if before else after[0], after[0] if before else after[1])
    return ParsedCaption(
        streets=streets,
        viewpoint=viewpoint,
        arrondissement=int(arr.group(1)) if arr else None,
        numbers=numbers,
        corner=bool(cm),
        quarter=qm.group(1).strip() if qm else None,
        corner_pair=corner_pair,
    )


def street_of(label: str) -> str:
    """'Rue Férou 75006 Paris' -> 'Rue Férou'."""
    return re.sub(r"\s+\d{5}\s.*$", "", label).strip()


_PARTICLES = {"de", "la", "le", "les", "des", "du", "d", "l", "aux", "au", "a", "en"}


def same_street(a: str, b: str) -> bool:
    """Same name once accents, hyphens, particles and doubled letters are ignored."""
    from rpr.sources.streetnames import norm

    na, nb = norm(a), norm(b)
    if na == nb:
        return True

    def skeleton(s: str) -> str:
        return re.sub(r"(.)\1", r"\1", " ".join(w for w in s.split() if w not in _PARTICLES))

    return skeleton(na) == skeleton(nb)


def distance_m(a: list[float] | tuple[float, float], b: list[float] | tuple[float, float]) -> float:
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * 111_320 * k, (a[1] - b[1]) * 110_540)


@dataclass
class Match:
    lon: float
    lat: float
    label: str
    score: float
    street: str
    role: str  # viewpoint, subject, corner or quarter
    precision: str = "street"  # number, corner, street or quarter
    method: str = "ban"  # ban, vasserot-1836, former-name or quarter-1836
    confidence: float = 0.0
    number: str | None = None
    current_name: str | None = None  # today's name, when the caption uses a former one
    historical: bool = False  # the street no longer exists
    ambiguous: int = 0  # other places the caption's name could mean

    def extra(self) -> dict:
        out: dict = {
            "geocoded_street": self.label,
            "from_caption": self.street,
            "role": self.role,
            "precision": self.precision,
            "method": self.method,
        }
        if self.number:
            out["number"] = self.number
        if self.current_name:
            out["current_name"] = self.current_name
        if self.historical:
            out["historical"] = True
        if self.ambiguous:
            out["ambiguous"] = self.ambiguous
        return out


class Geocoder:
    """Street lookups with an on-disk cache, so reruns cost no requests.

    Without `history` only the national address base is used: today's
    streets and house numbers.
    """

    def __init__(
        self,
        cache_path: Path | None = None,
        fetch: Callable[[str], dict] | None = None,
        history: StreetHistory | None = None,
    ):
        self.cache_path = cache_path
        self.cache: dict[str, dict | None] = {}
        if cache_path and cache_path.exists():
            self.cache = json.loads(cache_path.read_text(encoding="utf-8"))
        self.fetch = fetch or (lambda url: net.fetch_json(url, timeout=30))
        self.history = history
        self.requests = 0

    def save(self) -> None:
        if self.cache_path:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self.cache, ensure_ascii=False, sort_keys=True, indent=0), encoding="utf-8")

    def _search(self, key: str, params: dict[str, str]) -> dict | None:
        if key in self.cache:
            return self.cache[key]
        url = f"{GEOCODER}?{urllib.parse.urlencode(params)}"
        self.requests += 1
        try:
            data = self.fetch(url)
        except Exception:  # network trouble: don't cache, try again next run
            return None
        feats = data.get("features") or []
        result = None
        if feats:
            f = feats[0]
            p = f.get("properties", {})
            lon, lat = f["geometry"]["coordinates"][:2]
            result = {"lon": lon, "lat": lat, "label": p.get("label", ""), "score": p.get("score", 0), "citycode": p.get("citycode", "")}
            if p.get("housenumber"):
                result["housenumber"] = p["housenumber"]
                result["street"] = p.get("street", "")
        self.cache[key] = result
        return result

    def street(self, name: str, citycode: str | None) -> dict | None:
        params = {"q": name if citycode else f"{name} Paris", "type": "street", "limit": "1"}
        if citycode:
            params["citycode"] = citycode
        return self._search(f"{name.lower()}|{citycode or 'paris'}", params)

    def housenumber(self, number: str, name: str, citycode: str) -> dict | None:
        params = {"q": f"{number} {name}", "type": "housenumber", "citycode": citycode, "limit": "1"}
        return self._search(f"{number} {name.lower()}|{citycode}|housenumber", params)

    # ------------------------------------------------------------ matching

    @staticmethod
    def _usable(r: dict | None, citycode: str | None) -> bool:
        return bool(
            r
            and r["score"] >= MIN_SCORE
            and str(r.get("citycode", "")).startswith("751")
            and (not citycode or r["citycode"] == citycode)
        )

    def _at_number(self, number: str, r: dict) -> dict | None:
        """Today's address on the street BAN gave, if that number still exists."""
        h = self.housenumber(number, street_of(r["label"]), r["citycode"])
        if h and h.get("housenumber", "").lower() == number.lower() and same_street(h.get("street", ""), street_of(r["label"])):
            return h
        return None

    def _homonyms(self, name: str, year: int | None) -> int:
        """Former streets of this name still so called when the photo was taken."""
        if not self.history or not year:
            return 0
        return sum(1 for e in self.history.former_names(name) if e.get("until") and e["until"] >= year)

    def _resolve(self, name: str, role: str, number: str | None, arrondissement: int | None, year: int | None) -> Match | None:
        citycode = f"751{arrondissement:02d}" if arrondissement else None
        view = role == "viewpoint"
        street_conf = CONFIDENCE["street_viewpoint" if view else "street_subject"]
        r = self.street(name, citycode)
        usable = self._usable(r, citycode)
        h = self.history

        # 1. Today's street of that name.
        if usable and same_street(name, street_of(r["label"])):
            amb = self._homonyms(name, year) if not arrondissement else 0
            factor = AMBIGUOUS_FACTOR if amb else 1.0
            if number:
                hn = self._at_number(number, r)
                if hn:
                    return Match(hn["lon"], hn["lat"], hn["label"], hn["score"], name, role, "number", "ban",
                                 round(CONFIDENCE["number"] * factor, 2), number, ambiguous=amb)
                old = h.streets_1836(name, arrondissement) if h else []
                if len(old) == 1 and number in old[0]["numbers"]:
                    lon, lat = old[0]["numbers"][number]
                    return Match(lon, lat, f"{number} {old[0]['name']} (1836)", 1.0, name, role, "number", "vasserot-1836",
                                 round(CONFIDENCE["number_1836_today"] * factor, 2), number, ambiguous=amb)
            return Match(r["lon"], r["lat"], r["label"], r["score"], name, role, "street", "ban",
                         round(street_conf * r["score"] * factor, 2), ambiguous=amb)
        if not h:
            if usable:
                return Match(r["lon"], r["lat"], r["label"], r["score"], name, role, "street", "ban",
                             round(street_conf * r["score"], 2))
            return None

        # 2. The street as it was in 1836 (demolished since, or renamed).
        old = h.streets_1836(name, arrondissement)
        if old:
            e, amb = old[0], len(old) - 1
            factor = AMBIGUOUS_FACTOR if amb else 1.0
            if number and number in e["numbers"]:
                lon, lat = e["numbers"][number]
                return Match(lon, lat, f"{number} {e['name']}", 1.0, name, role, "number", "vasserot-1836",
                             round(CONFIDENCE["number_1836"] * factor, 2), number, historical=True, ambiguous=amb)
            if e["spread"] > LONG_STREET_M:
                factor *= LONG_STREET_FACTOR
            lon, lat = e["center"]
            return Match(lon, lat, e["name"], 1.0, name, role, "street", "vasserot-1836",
                         round(street_conf * factor, 2), historical=True, ambiguous=amb)

        # 3. A former name: the street that carries it today.
        former = h.former_names(name, arrondissement)
        successors = [e for e in former if e.get("to")]
        distinct = {tuple(e["to"]) for e in successors}
        for e in successors:
            for target in e["to"]:
                cc = citycode or (f"751{e['arr'][0]:02d}" if len(e["arr"]) == 1 else None)
                t = self.street(target, cc)
                if not self._usable(t, cc) or not same_street(target, street_of(t["label"])):
                    continue
                amb = len(distinct) - 1 + (len(e["to"]) > 1)
                factor = (PART_FACTOR if e.get("part") else 1.0) * (AMBIGUOUS_FACTOR if amb else 1.0)
                conf = CONFIDENCE["former_viewpoint" if view else "former_subject"] * factor
                return Match(t["lon"], t["lat"], t["label"], t["score"], name, role, "street", "former-name",
                             round(conf, 2), current_name=street_of(t["label"]), ambiguous=amb)

        # 4. Today's street with a close name, unless the name is a known old one.
        if usable and not former:
            return Match(r["lon"], r["lat"], r["label"], r["score"], name, role, "street", "ban",
                         round(street_conf * r["score"], 2))
        return None

    def _corner(self, parsed: ParsedCaption) -> Match | None:
        pair = parsed.junction()
        if not pair or not self.history:
            return None
        return self._corner_1836(pair, parsed.arrondissement) or self._corner_today(pair, parsed.arrondissement)

    def _today_keys(self, name: str, arrondissement: int | None) -> tuple[list[tuple[str, float]], list[tuple[str, float]]]:
        """Today's streets a caption's name stands for, as (junction-table key, factor).

        Returns (streets of that name, streets that carry it today). The
        first is the street of that name (or BAN's spelling of it), else
        today's streets spelt alike ("rue Mézières" is the rue de Mézières).
        The second is filled for a former name, with the factor for being
        only part of today's street; a known old name is never moved to a
        lookalike.
        """
        from rpr.sources.streetnames import norm, sound

        h = self.history
        key = norm(name)
        if key in h.today:
            return [(key, 1.0)], []
        citycode = f"751{arrondissement:02d}" if arrondissement else None
        r = self.street(name, citycode)  # already looked up, so cached
        if self._usable(r, citycode) and same_street(name, street_of(r["label"])) and norm(street_of(r["label"])) in h.today:
            return [(norm(street_of(r["label"])), 1.0)], []
        known_old = h.former_names(name, arrondissement)
        if known_old:
            successors: dict[str, float] = {}
            for e in known_old:
                for t in e.get("to", []):
                    successors.setdefault(norm(t), PART_FACTOR if e.get("part") else 1.0)
            return [], [(k, f) for k, f in successors.items() if k in h.today]
        return [(k, 1.0) for k in h.today_sounds.get(sound(key), [])], []

    def _corner_today(self, pair: tuple[str, str], arrondissement: int | None) -> Match | None:
        """Corner of two streets from where their outlines meet today (streets laid out after 1836)."""
        h = self.history

        def meetings(keys_a: list[tuple[str, float]], keys_b: list[tuple[str, float]]) -> list[tuple]:
            return list(dict.fromkeys(
                (*p, a, b, min(fa, fb))
                for a, fa in keys_a for b, fb in keys_b if a != b
                for p in h.junctions(a, b, arrondissement)
            ))

        (a_now, a_old), (b_now, b_old) = self._today_keys(pair[0], arrondissement), self._today_keys(pair[1], arrondissement)
        # The streets of those names first; for a former name, the streets that carry it today.
        found = meetings(a_now, b_now) or meetings(a_now + a_old, b_now + b_old)
        if not found:
            return None
        lon, lat, a, b, factor = found[0]
        amb = len({(m[0], m[1]) for m in found}) - 1  # the streets meet in more than one place
        conf = CONFIDENCE["corner"] * factor * (AMBIGUOUS_FACTOR if amb else 1.0)
        return Match(lon, lat, f"{h.today[a]} / {h.today[b]}", 1.0, f"{pair[0]} / {pair[1]}", "corner", "corner",
                     "street-outlines", round(conf, 2), ambiguous=amb)

    def _corner_1836(self, pair: tuple[str, str], arrondissement: int | None) -> Match | None:
        """Corner of two streets whose 1836 address points come within CORNER_MAX_M."""
        a = self.history.streets_1836(pair[0], arrondissement)
        b = self.history.streets_1836(pair[1], arrondissement)
        hits = []
        for ea in a:
            for eb in b:
                best = min(
                    ((distance_m(p, q), p, q) for p in ea["numbers"].values() for q in eb["numbers"].values()),
                    default=None,
                )
                if best and best[0] <= CORNER_MAX_M:
                    hits.append((best, ea, eb))
        if not hits:
            return None
        (_, p, q), ea, eb = min(hits, key=lambda x: x[0][0])
        amb = len(hits) - 1
        conf = CONFIDENCE["corner"] * (AMBIGUOUS_FACTOR if amb else 1.0)
        return Match((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, f"{ea['name']} / {eb['name']}", 1.0,
                     f"{pair[0]} / {pair[1]}", "corner", "corner", "vasserot-1836", round(conf, 2), ambiguous=amb)

    def _quarter(self, parsed: ParsedCaption) -> Match | None:
        if not parsed.quarter or not self.history:
            return None
        q = self.history.quarter(parsed.quarter)
        if not q:
            return None
        lon, lat = q["center"]
        return Match(lon, lat, q["name"], 1.0, parsed.quarter, "quarter", "quarter", "vasserot-1836",
                     CONFIDENCE["quarter"])

    def place(self, caption: str, year: int | None = None) -> Match | None:
        parsed = parse_caption(caption)
        found = []
        for name, role in parsed.candidates():
            m = self._resolve(name, role, parsed.numbers.get(name), parsed.arrondissement, year)
            if m:
                found.append(m)
        corner = self._corner(parsed)
        if corner:
            found.append(corner)
        if not found:
            q = self._quarter(parsed)
            return q
        return max(found, key=lambda m: m.confidence)  # ties keep caption order: viewpoint first

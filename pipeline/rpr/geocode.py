"""Place archive captions on the map.

Captions in the Paris Musées catalogue follow a few habits:

    "Passage de l'Opéra, vue prise de la rue Lepeletier, 9ème arrondissement, Paris."
    "Boulevard Henri IV (de la rue de Sully)"
    "Vieille maison à l'angle de la rue d'Arras et de la rue Clopin, 5ème arrondissement"
    "Hôtel Lambert, 13 quai d'Anjou, 4ème arrondissement, Paris."

We pull out the arrondissements, the street names, the house numbers and the
street the view was taken from ("vue prise de", "(de la rue ...)"). Each
street is then looked up in every arrondissement the caption gives ("14 rue
de Turenne, 3ème et 4ème"), most precise answer first:

1. today's street of that name in the national address base (BAN, through
   the IGN Géoplateforme geocoder), at the house number when there is one;
2. the street as it was in 1836 (ALPAGE address points of the Vasserot
   cadastre), at its numbered house when there is one, for streets that were
   demolished;
3. a former street name (City of Paris "dénominations caduques") and the
   street that carries it today;
4. a garden, square, bridge, market or city gate of that name (IGN BD TOPO
   and the City of Paris street outlines, see rpr.sources.places), at its
   centre; a gate of the Thiers wall ("porte d'Italie") on the avenue or
   place named after it;
5. today's street of the same kind spelt a letter or two apart ("rue
   Quimcampoix" is the rue Quincampoix), if only one such street is in the
   arrondissement; flagged, as the caption's spelling was set aside;
6. today's street with a close name (BAN score of 0.8 or more), unless the
   name is a known historical one;
7. when nothing of the caption is found in its arrondissements: today's
   street or place of exactly that name in a neighbouring arrondissement
   ("5 rue du Mail, 1er arrondissement": the rue du Mail is in the 2e),
   flagged with the arrondissement the caption gave and at lower confidence;
   not when a street of that name is recorded there and gone since;
8. when no street is found: the building the caption names ("Église
   Saint-Julien-le-Pauvre", "Hôtel Lambert"), from the Mérimée list and IGN
   BD TOPO (rpr.sources.monuments), if the name means one building in the
   caption's arrondissement that stood in the photo's year (see _landmark).

A street BAN finds under the caption's own name (accents, particles and "St"
aside: "rue Candolle" is the rue de Candolle) is taken at a lower BAN score
than a merely close name.

Two streets of a junction ("Rue X, vue prise de la rue Y", "à l'angle de")
are placed at their corner: where their 1836 address points meet, else
where today's street outlines meet (streets laid out after 1836, such as the
boulevard du Palais). Streets that only meet across a third one get no corner.
Confidence follows precision: house number, corner, street, place (by its
size; below the streets of the same caption, which it never displaces),
building (by its size; only when no street is found), quarter. A name that could mean several places is placed on the likeliest
one and flagged.
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
    from rpr.sources.monuments import Monuments
    from rpr.sources.places import Places
    from rpr.sources.streetnames import StreetHistory

GEOCODER = "https://data.geopf.fr/geocodage/search"
MIN_SCORE = 0.8
SAME_NAME_MIN_SCORE = 0.5  # BAN found the caption's own name, spelt differently ("Place St Sulpice": 0.71)
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
# A named place (garden, square, bridge...) pins the photo down as well as its
# size allows: (largest spread in metres, confidence), else PLACE_LARGE.
# Ranked below a street of the caption, which it never displaces
# ("Port du Louvre, vers le Pont Neuf" is on the port).
PLACE_CONFIDENCE = ((150, 0.2), (400, 0.15))
PLACE_LARGE = 0.1  # the Tuileries or the Jardin des Plantes
# A building the caption names, at its Mérimée position or the centre of its
# BD TOPO outline: (largest spread in metres, confidence), else LANDMARK_LARGE.
LANDMARK_CONFIDENCE = ((150, 0.3), (400, 0.2))
LANDMARK_LARGE = 0.1
LANDMARK_MAX_M = 1000  # a larger site (a cemetery, a wood) pins nothing down
LANDMARK_SAME_M = 300  # landmarks of that name closer than this are one building
# Grounds the gazetteer knows only by a point (Mérimée's "Parc de Bagatelle" is the château's):
# how far they reach is unknown, so they rank as a large site.
LANDMARK_GROUNDS = {"parc", "jardin", "jardins", "bois", "cimetiere", "domaine", "cite", "enclos"}
FORMER_MIN_AGE = 50  # "l'ancien X" is today's X only if it stood this many years before the photo
FIRST_PHOTOS = 1850  # an undated photo is no older than this
# Villages annexed to Paris in 1860, which captions name as places of their own ("Passy").
PARIS_VILLAGES = {
    "passy", "auteuil", "batignolles", "monceau", "montmartre", "la chapelle", "chapelle", "la villette", "villette",
    "belleville", "menilmontant", "ménilmontant", "charonne", "bercy", "vaugirard", "grenelle", "montrouge", "plaisance",
    "clignancourt", "les ternes", "ternes", "la glacière", "glacière", "butte aux cailles", "butte-aux-cailles",
}
_TOWN_LINKS = {"de", "du", "des", "la", "le", "les", "sur", "sous", "en", "lès", "lez", "aux", "d", "l", "et", "saint", "sainte"}
# A caption's name a letter or two from today's street of the same kind: names of up
# to SPELLING_SHORT letters (particles aside) may be one letter apart, longer ones two.
SPELLING_SHORT = 7
SPELLING_FACTOR = 0.9  # below the same street under the caption's own spelling
OTHER_ARRONDISSEMENT_FACTOR = 0.6  # found only outside the arrondissement the caption gives
ELSEWHERE_MIN_SCORE = 0.9  # and then only under exactly the caption's name, in a neighbouring arrondissement
# Arrondissements that share a boundary (City of Paris outlines; across the Seine too).
NEIGHBOURS = {
    1: {2, 3, 4, 5, 6, 7, 8, 9}, 2: {1, 3, 9, 10}, 3: {1, 2, 4, 10, 11}, 4: {1, 3, 5, 6, 11, 12},
    5: {1, 4, 6, 12, 13, 14}, 6: {1, 4, 5, 7, 14, 15}, 7: {1, 6, 8, 15, 16}, 8: {1, 7, 9, 16, 17, 18},
    9: {1, 2, 8, 10, 17, 18}, 10: {2, 3, 9, 11, 18, 19, 20}, 11: {3, 4, 10, 12, 19, 20}, 12: {4, 5, 11, 13, 20},
    13: {5, 12, 14}, 14: {5, 6, 13, 15}, 15: {6, 7, 14, 16}, 16: {7, 8, 15, 17}, 17: {8, 9, 16, 18},
    18: {8, 9, 10, 17, 19}, 19: {10, 11, 18, 20}, 20: {10, 11, 12, 19},
}

STREET_TYPES = (
    "rue|boulevard|bd|avenue|av\\.|place|quai|passage|impasse|cour|cité|cite|pont|square|carrefour|"
    "marché|marche|porte|chaussée|chaussee|faubourg|fb|fg|allée|allee|villa|ruelle|parvis|port|galerie|"
    "rond-point|esplanade|cloître|cloitre|hameau|sentier|chemin|route|jardin"
)
# Kinds of name that may be a place rather than a street (looked up in the gazetteer).
PLACE_TYPES = {
    "place", "square", "pont", "porte", "port", "jardin", "marché", "marche", "cour", "cloître", "cloitre",
    "parvis", "esplanade", "galerie", "carrefour", "rond-point",
}
# Words that make a caption's last piece a street or a corner, not a town ("Bd Jourdan", "Coin Rue de Seine").
_WAY_WORDS = {w.rstrip("\.") for w in STREET_TYPES.split("|")} | {"coin", "angle", "encoignure", "croisement", "poterne"}
_MONTHS = "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre"
_PARTICLE = r"(?:(?i:de la|de l['’]|des|du|de|d['’]|aux|au|à)\s*)?"
# Where a street name ends: punctuation, a sentence ("Rue Lepic. Montmartre"),
# a slash or a bracket ("Cour de Rohan / cour de Rouen", "Passage Saint-Paul
# [ou Saint-Pierre]"), a spaced dash, a number, a date ("Rue Berton mars
# 1901"), words that start a description ("Rue de Bretonvilliers avec l'hôtel
# de Bretonvilliers au fond", "Rue Saint-Dominique prise du Ministère"), or a
# street written straight after another ("Impasse de la Baudoirie Rue de
# Venise", "cour du 21 rue Cassette"), unless a particle makes it part of the
# name ("Rue du Pont Neuf", "Rue de la Cité").
_STOP = (
    r"(?=\s*(?:[,;:()/\[]|\.\s*$|$)"
    r"|(?<=[a-zà-ÿ]{3})\.\s"
    r"|\s+[-–—](?=\s|\d)"
    r"|(?i:\s+(?:et|vue?|près|pres|côté|cote|depuis|vers|n°|à l['’]angle|au coin|prise?|pris|devant|derrière|derriere"
    r"|entre|donnant|au niveau|dans|sur|le long|avec|au fond|conduisant|habitée?|actuellement|anciennement"
    rf"|à\s+(?:la|l['’]|le|les|partir|droite|gauche|(?=(?-i:[A-ZÀ-Ý])))|en\s+(?:{_MONTHS}|\d{{4}})|(?:{_MONTHS})(?=\s+\d{{4}}))\b)"
    r"|(?<!\bde)(?<!\bdu)(?<!\bdes)(?<!\bla)(?<!\bd')(?<!\bl')(?<!\bd’)(?<!\bl’)"
    r"\s+(?:\d{1,3}\s+)?(?i:rue|bd|boulevard|avenue|quai|impasse)\s"
    r"|\s+\d)"
)
# Street type (any case), optional particle, then a capitalised name.
_STREET = re.compile(
    rf"\b((?i:{STREET_TYPES})\s+{_PARTICLE}(?!(?i:rue|bd|boulevard|avenue|quai|impasse)\s)[A-ZÀ-Ý0-9][^,;:()/\[]*?){_STOP}"
)
_ORDINAL = r"(\d{1,2})\s*(?:e|è|ème|eme|er|ère|ième|ieme)"
# "5ème arrondissement", "1er et 4ème arrondissement", "19ème ou 20ème arr."
_ARRONDISSEMENT = re.compile(rf"\b{_ORDINAL}(?:\s*(?:et|ou|-|,)\s*{_ORDINAL})?\s+arr(?:ondissement|\.)?", re.IGNORECASE)
# "rues de Seine et de l'Echaudé": each name is a street.
_RUES = re.compile(r"\brues\s+(?=" + _PARTICLE + r"[A-ZÀ-Ý])")
_VIEW_FROM = re.compile(
    r"(?:vue\s+prise\s+d[eu]s?\s+|vue?\s+d[eu]s?\s+|\bprise?\s+d[eu]s?\s+|\bpris\s+d[eu]s?\s+|\(\s*d[eu]s?\s+"
    r"|\(\s*depuis\s+|depuis\s+|,\s*d[eu]s?\s+)"
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
# A caption's pieces, where a landmark's name may stand ("Palais du Louvre / cour Carrée").
# Brackets stay in: "Hôtel de Montmorency [petit]" qualifies the name (see Monuments.mentions).
_PIECES = re.compile(r"\s*(?:[,;:()/«»\"]|(?<=\w{3})\.\s|\s[-–—]\s)\s*")
_BRACKETS = re.compile(r"\s*[\[\]]\s*")
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
    arrondissements: list[int] = field(default_factory=list)  # every one the caption gives, first one first

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

    def junctions(self) -> list[tuple[str, str]]:
        """Pairs of streets that may meet where the photo was taken, likeliest first: the
        viewpoint's, then the corner's ("Angle de la rue X et de la rue Y, depuis la rue Z")."""
        out = [self.junction()] if self.junction() else []
        if self.corner:
            pair = self.corner_pair or (tuple(self.streets[:2]) if len(self.streets) >= 2 else None)
            if pair and pair not in out:
                out.append(pair)
        return out


_ABBREVIATIONS = [
    (r"^bd\b\.?", "boulevard"),
    (r"^av\.", "avenue"),
    (r"^(?:f[bg]\b\.?|faubourg\b)", "rue du Faubourg"),  # "21 Fb St Honoré", "Faubourg Saint-Denis"
    (r"\bGds\b\.?", "Grands"),
    (r"\bGde\b\.?", "Grande"),
]


def _clean(street: str) -> str:
    # A typographic apostrophe would glue "l’" to the name: "rue de l’Estrapade" is the rue de l'Estrapade.
    street = re.sub(r"\s+", " ", street).strip(" .'\"’").replace("’", "'")
    for pattern, full in _ABBREVIATIONS:
        street = re.sub(pattern, full, street, flags=re.IGNORECASE)
    return street


def _expand_rues(text: str) -> str:
    """'angle des rues de Seine et de l'Echaudé' -> 'angle des rue de Seine et rue de l'Echaudé'."""
    m = _RUES.search(text)
    if not m:
        return text
    head, rest = text[: m.start()], text[m.end():]
    parts = re.split(r"(,\s*|\s+et\s+)", rest)
    out = []
    for i in range(0, len(parts), 2):
        name = parts[i]
        if not re.match(_PARTICLE + r"[A-ZÀ-Ý]", name) or _ARRONDISSEMENT.search(name) or name.startswith("Paris"):
            out.append("".join(parts[i:]))
            break
        out.append("rue " + name + (parts[i + 1] if i + 1 < len(parts) else ""))
    return head + "".join(out)


def parse_caption(caption: str) -> ParsedCaption:
    text = caption.replace(" ", " ").strip().strip('"')
    text = re.sub(r"\b(Pont)-(?=[A-ZÀ-Ý])", r"\1 ", text)  # "le Pont-Neuf" is the Pont Neuf
    text = _expand_rues(text)
    arr = _ARRONDISSEMENT.search(text)
    arrondissements = [int(g) for g in (arr.groups() if arr else ()) if g and 1 <= int(g) <= 20]
    streets: list[str] = []
    spans: list[tuple[int, int, str]] = []
    numbers: dict[str, str] = {}
    for m in _STREET.finditer(text):
        s = _clean(m.group(1))
        if len(s.split()) < 2 or re.search(r"\s\d+$", s):  # "cour du 21 rue Cassette": the number is the street's
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
        arrondissement=arrondissements[0] if arrondissements else None,
        numbers=numbers,
        corner=bool(cm),
        quarter=qm.group(1).strip() if qm else None,
        corner_pair=corner_pair,
        arrondissements=arrondissements,
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


def spelling(name: str) -> tuple[str, str]:
    """('rue', 'kincampoix')-style key for comparing spellings: the kind of way, then
    the name's letters without accents, particles, spaces or doubled letters."""
    from rpr.sources.streetnames import norm

    words = norm(name).split()
    if not words:
        return "", ""
    letters = "".join(w for w in words[1:] if w not in _PARTICLES)
    return words[0], re.sub(r"(.)\1+", r"\1", letters)


def edits(a: str, b: str) -> int:
    """Letters to change, add, drop or swap with a neighbour to turn `a` into `b`."""
    prev2: list[int] = []
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        row = [i]
        for j, cb in enumerate(b, 1):
            d = min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (ca != cb))
            if i > 1 and j > 1 and ca == b[j - 2] and a[i - 2] == cb:
                d = min(d, prev2[j - 2] + 1)
            row.append(d)
        prev2, prev = prev, row
    return prev[-1]


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
    caption_arrondissement: int | None = None  # found outside the arrondissement the caption gives
    respelt: bool = False  # today's street is spelt a letter or two apart from the caption's name

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
        if self.caption_arrondissement:
            out["caption_arrondissement"] = self.caption_arrondissement
        if self.respelt:
            out["respelt"] = True
        return out


class Geocoder:
    """Street lookups with an on-disk cache, so reruns cost no requests.

    Without `history` only the national address base is used: today's
    streets and house numbers. Without `places` gardens, squares and bridges
    are found only where the address base lists them as streets. Without
    `monuments` a caption that names only a building is not placed.
    """

    def __init__(
        self,
        cache_path: Path | None = None,
        fetch: Callable[[str], dict] | None = None,
        history: StreetHistory | None = None,
        places: Places | None = None,
        monuments: Monuments | None = None,
    ):
        self.cache_path = cache_path
        self.cache: dict[str, dict | None] = {}
        if cache_path and cache_path.exists():
            self.cache = json.loads(cache_path.read_text(encoding="utf-8"))
        self.fetch = fetch or (lambda url: net.fetch_json(url, timeout=30))
        self.history = history
        self.places = places
        self.monuments = monuments
        self.requests = 0
        self._spellings: dict[str, list[tuple[str, str]]] | None = None  # kind of way -> (letters, today's name)

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

    @staticmethod
    def _same_name(r: dict | None, citycode: str | None, name: str, min_score: float = SAME_NAME_MIN_SCORE) -> bool:
        """BAN found the caption's own name (spelt its way), in Paris and in the arrondissement asked for."""
        return bool(
            r
            and r["score"] >= min_score
            and str(r.get("citycode", "")).startswith("751")
            and (not citycode or r["citycode"] == citycode)
            and same_street(name, street_of(r["label"]))
        )

    def _place(self, name: str, role: str, arrondissements: set[int] | None) -> Match | None:
        """A garden, square, bridge, market or gate of that name, at its centre, in one of these arrondissements."""
        if not self.places or name.split()[0].lower() not in PLACE_TYPES:
            return None
        tries = [(name, None)]
        gate = re.match(r"(?i)porte\s+(.+)", name)
        if gate:  # a gate of the Thiers wall is the place or avenue named after it
            tries += [(f"Place de la Porte {gate.group(1)}", "gate-way"), (f"Avenue de la Porte {gate.group(1)}", "gate-way")]
        for query, method in tries:
            found = [e for e in self.places.find(query) if not arrondissements or arrondissements & set(e["arr"])]
            if not found:
                continue
            e, amb = found[0], len(found) - 1
            conf = next((c for limit, c in PLACE_CONFIDENCE if e["spread"] <= limit), PLACE_LARGE)
            lon, lat = e["center"]
            source = "bdtopo" if e["source"] == "bdtopo" else "paris-voies"
            return Match(lon, lat, e["name"], 1.0, name, role, "place", method or source,
                         round(conf * (AMBIGUOUS_FACTOR if amb else 1.0), 2), ambiguous=amb)
        return None

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

    def _resolve(self, name: str, role: str, number: str | None, arrondissement: int | None, year: int | None,
                 respell: bool = True) -> Match | None:
        citycode = f"751{arrondissement:02d}" if arrondissement else None
        view = role == "viewpoint"
        street_conf = CONFIDENCE["street_viewpoint" if view else "street_subject"]
        r = self.street(name, citycode)
        usable = self._usable(r, citycode)
        h = self.history

        # 1. Today's street of that name.
        if self._same_name(r, citycode, name):
            score = max(r["score"], MIN_SCORE)  # a low score here is only the caption's spelling
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
                         round(street_conf * score * factor, 2), ambiguous=amb)
        if not h:
            if usable:
                return Match(r["lon"], r["lat"], r["label"], r["score"], name, role, "street", "ban",
                             round(street_conf * r["score"], 2))
            return self._place(name, role, {arrondissement} if arrondissement else None)

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
                if not self._same_name(t, cc, target):
                    continue
                amb = len(distinct) - 1 + (len(e["to"]) > 1)
                factor = (PART_FACTOR if e.get("part") else 1.0) * (AMBIGUOUS_FACTOR if amb else 1.0)
                conf = CONFIDENCE["former_viewpoint" if view else "former_subject"] * factor
                return Match(t["lon"], t["lat"], t["label"], t["score"], name, role, "street", "former-name",
                             round(conf, 2), current_name=street_of(t["label"]), ambiguous=amb)

        # 4. A garden, square, bridge, market or gate of that name.
        place = self._place(name, role, {arrondissement} if arrondissement else None)
        if place:
            return place

        # 5. Today's street of the same kind, spelt a letter or two apart.
        alike = self._spelt_alike(name, arrondissement) if respell and not former else None
        if alike:
            t, letters_apart = alike
            factor = SPELLING_FACTOR if letters_apart else 1.0  # 0: only BAN's reading of the caption failed
            hn = self._at_number(number, t) if number else None
            if hn:
                return Match(hn["lon"], hn["lat"], hn["label"], hn["score"], name, role, "number", "ban",
                             round(CONFIDENCE["number"] * factor, 2), number, respelt=bool(letters_apart))
            return Match(t["lon"], t["lat"], t["label"], t["score"], name, role, "street", "ban",
                         round(street_conf * t["score"] * factor, 2), respelt=bool(letters_apart))

        # 6. Today's street with a close name, unless the name is a known old one.
        if usable and not former:
            return Match(r["lon"], r["lat"], r["label"], r["score"], name, role, "street", "ban",
                         round(street_conf * r["score"], 2))
        return None

    def _spelt_alike(self, name: str, arrondissement: int | None) -> tuple[dict, int] | None:
        """Today's street the caption misspells, and how many letters apart: the one
        street of the same kind whose name is a letter or two away ("rue Quimcampoix",
        "impasse de la Baudoirie", "rue Brise-Miche"), as BAN finds it in the
        arrondissement. Without an arrondissement, one letter at most. None if several
        streets are as near, or if the name is too short to tell."""
        if not self.history:
            return None
        if self._spellings is None:
            self._spellings = {}
            for today in self.history.today.values():
                kind, letters = spelling(today)
                self._spellings.setdefault(kind, []).append((letters, today))
        kind, letters = spelling(name)
        if len(letters) < 4:
            return None
        limit = 1 if len(letters) <= SPELLING_SHORT or not arrondissement else 2
        near = sorted(
            (d, today)
            for other, today in self._spellings.get(kind, [])
            if abs(len(other) - len(letters)) <= limit and (d := edits(letters, other)) <= limit
        )
        citycode = f"751{arrondissement:02d}" if arrondissement else None
        found: dict[str, dict] = {}
        nearest = None
        for d, today in near:
            if nearest is not None and d > nearest:
                break
            r = self.street(today, citycode)
            if self._same_name(r, citycode, today, MIN_SCORE):
                found[r["label"]] = r
                nearest = d
        return (next(iter(found.values())), nearest) if len(found) == 1 else None

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
        if self._same_name(r, citycode, name) and norm(street_of(r["label"])) in h.today:
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

    def _landmark(self, caption: str, parsed: ParsedCaption, year: int | None) -> Match | None:
        """The first building the caption names that stood when the photo was taken, in the
        caption's arrondissement, if its name means one building there.

        Without an arrondissement, the name must mean one building in all Paris,
        and none is placed if it is a hôtel (a family often had several, some
        demolished and so missing from the gazetteer: the Hôtel de Luynes of the
        rue Saint-Dominique), if the caption carries the name on ("Hôtel-Dieu de
        Montlhéry") or if the caption ends on another town ("église Saint-Laurent, Rouen").
        """
        if not self.monuments:
            return None
        from rpr.sources.streetnames import norm

        arrs = set(parsed.arrondissements)
        pieces = [p for p in _PIECES.split(caption) if p.strip()]
        if not arrs and self._other_town([q for p in pieces for q in _BRACKETS.split(p) if q.strip()]):
            return None
        for piece in pieces:
            for mention in self.monuments.mentions(piece):
                entries = [e for e in mention.entries
                           if _standing(e, year, mention.former) and (not arrs or arrs & set(e["arr"]))]
                if not entries:
                    continue
                sites = _sites(entries)
                if len(sites) > 1 or (not arrs and (mention.carried_on or mention.words.split()[0] == "hotel")):
                    return None  # several buildings of that name: no telling which
                site = sites[0]
                lon = sum(e["center"][0] for e in site) / len(site)
                lat = sum(e["center"][1] for e in site) / len(site)
                spread = max(max(e["spread"], distance_m(e["center"], (lon, lat))) for e in site)
                if spread > LANDMARK_MAX_M:
                    return None
                conf = next((c for limit, c in LANDMARK_CONFIDENCE if spread <= limit), LANDMARK_LARGE)
                label = self.monuments.name(site[0], mention.words)
                if spread == 0 and norm(label).split()[0] in LANDMARK_GROUNDS:
                    conf = LANDMARK_LARGE
                method = "merimee" if any(e["source"] == "merimee" for e in site) else "bdtopo"
                return Match(lon, lat, label, 1.0, piece, "subject", "landmark", method, conf)
        return None

    def _other_town(self, pieces: list[str]) -> bool:
        """The caption's last words name a place that is neither Paris nor one of its quarters."""
        return self._last_place(pieces) is not None

    def _last_place(self, pieces: list[str]) -> str | None:
        """The caption's last words, if they read as a place name that is neither Paris nor one of its quarters."""
        words = [p.strip(" .'\"«»") for p in pieces]
        words = [p for p in words if re.search(r"[^\W\d_]{3,}", p) and not re.fullmatch(r"[IVXL]+(?:e|ème)?", p)]
        if not words:
            return None
        last = words[-1]
        parts = re.split(r"[\s'’-]+", last)
        if not all(w[:1].isupper() or w.lower() in _TOWN_LINKS for w in parts if w) or re.search(r"\d", last):
            return None
        key = re.sub(r"^(?:la|le|les) ", "", last.lower())
        if (
            key in {"paris"} | PARIS_VILLAGES
            or (self.history and self.history.quarter(last))
            or (self.places and self.places.find(last))
            or (self.monuments and self.monuments.mentions(last))
        ):
            return None
        return last

    def _town(self, caption: str, parsed: ParsedCaption) -> str | None:
        """The other town a caption ends on ("Maison rue Saint-Romain, Rouen"), or None.

        Narrower than `_other_town`, which also takes a caption's last street for
        a town ("…, Rue Saint-Dominique."): the name must close the caption after
        a comma, as towns do (not "… - Disparu" or "… - Hôtel de Flesselles. 1898"),
        start with a capital, hold no word for a street or a corner, and be no part
        of a street the caption names.
        """
        if parsed.arrondissements:
            return None
        pieces = [q for p in _PIECES.split(caption) for q in _BRACKETS.split(p) if q.strip()]
        last = self._last_place(pieces)
        if not last or not last[:1].isupper():
            return None
        if not re.search(r",\s*" + re.escape(last) + r"[\s.»\"']*$", caption):
            return None
        if any(w.lower().rstrip(".") in _WAY_WORDS for w in re.split(r"[\s'’]+", last)):
            return None
        if any(last.lower() in s.lower() for s in parsed.streets):
            return None
        return last

    def _elsewhere(self, name: str, role: str, number: str | None, arrondissements: list[int]) -> Match | None:
        """Today's street or place of exactly that name in a neighbouring arrondissement (a slip in the caption)."""
        view = role == "viewpoint"
        if self.history and any(set(e.get("arr") or []) & set(arrondissements) for e in self.history.former_names(name)):
            return None  # a street of that name was there and is gone ("rue Larrey, 6ème"): not a slip
        near = set().union(*(NEIGHBOURS.get(a, set()) for a in arrondissements)) - set(arrondissements)
        r = self.street(name, None)
        if self._same_name(r, None, name, ELSEWHERE_MIN_SCORE) and int(r["citycode"][-2:]) in near:
            hn = self._at_number(number, r) if number else None
            if hn:
                m = Match(hn["lon"], hn["lat"], hn["label"], hn["score"], name, role, "number", "ban",
                          CONFIDENCE["number"], number)
            else:
                m = Match(r["lon"], r["lat"], r["label"], r["score"], name, role, "street", "ban",
                          CONFIDENCE["street_viewpoint" if view else "street_subject"] * r["score"])
        else:
            m = self._place(name, role, near)
        if not m:
            return None
        m.confidence = round(m.confidence * OTHER_ARRONDISSEMENT_FACTOR, 2)
        m.caption_arrondissement = arrondissements[0]
        return m

    def _all(self, parsed: ParsedCaption, arrondissement: int | None, year: int | None, respell: bool = True) -> list[Match]:
        """Every street, place and corner of the caption found in this arrondissement."""
        found = []
        for name, role in parsed.candidates():
            m = self._resolve(name, role, parsed.numbers.get(name), arrondissement, year, respell)
            if m:
                found.append(m)
        for pair in parsed.junctions() if self.history else []:
            corner = self._corner_1836(pair, arrondissement) or self._corner_today(pair, arrondissement)
            if corner:
                found.append(corner)
                break
        return found

    def place(self, caption: str, year: int | None = None) -> Match | None:
        parsed = parse_caption(caption)
        # A caption that ends on another town ("Maison rue Saint-Romain, Rouen") is not in Paris,
        # whatever Paris street carries the same name.
        if self._town(caption, parsed):
            return None
        found: list[Match] = []
        # A caption that ends on another town ("Rue des Cuvettes, Beauvais") is not respelt into a Paris street.
        respell = bool(parsed.arrondissements) or not self._other_town(
            [q for p in _PIECES.split(caption) for q in _BRACKETS.split(p) if q.strip()])
        # Every arrondissement the caption lists ("14 rue de Turenne, 3ème et 4ème": the number is in the 4th).
        for arr in parsed.arrondissements or [None]:
            found += self._all(parsed, arr, year, respell)
        if not found and parsed.arrondissement:
            found = [m for name, role in parsed.candidates()
                     if (m := self._elsewhere(name, role, parsed.numbers.get(name), parsed.arrondissements))]
        if not found:
            return self._landmark(caption, parsed, year) or self._quarter(parsed)
        return max(found, key=lambda m: m.confidence)  # ties: first arrondissement, then caption order (viewpoint first)


def _standing(landmark: dict, year: int | None, former: bool) -> bool:
    """Built by the photo's year; and, for a caption's "ancien X", long before it (the
    Hôtel-Dieu Marville photographed in the 1860s is not today's, built from 1866).
    An undated photo is taken to be no older than FIRST_PHOTOS."""
    built = landmark.get("built")
    if year and built and year < built:
        return False
    if former:
        return bool(built and built + FORMER_MIN_AGE <= (year or FIRST_PHOTOS))
    return True


def _sites(landmarks: list[dict]) -> list[list[dict]]:
    """Landmarks grouped into buildings: a name's entries within LANDMARK_SAME_M of each other."""
    sites: list[list[dict]] = []
    for e in landmarks:
        site = next((s for s in sites if distance_m(s[0]["center"], e["center"]) <= LANDMARK_SAME_M), None)
        if site:
            site.append(e)
        else:
            sites.append([e])
    return sites

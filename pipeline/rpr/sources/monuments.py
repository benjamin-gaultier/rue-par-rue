"""Named landmarks of Paris, for placing captions that name a building but no street.

Many Paris Musées captions name only the building: "Église Saint-Julien-le-
Pauvre", "Hôtel de Roquelaure / ministère des travaux publics", "Fontaine
Cuvier", "Cimetière du Père Lachaise". This gazetteer gives each such name a
position, from two open sources:

* the Mérimée register of historic monuments (Ministère de la Culture, POP,
  Licence Ouverte / Etalab 2.0): every protected building of Paris, with its
  arrondissement, its position (WGS84, at the building) and the century it was
  built in. Its titles carry the building's other names ("Hôtel de Gournay ou
  de Mortemart, dit aussi d'Aguesseau", "Anciens hôtels de Rohan et Soubise,
  actuellement Archives Nationales"), which are all kept;
* IGN BD TOPO (Licence Ouverte / Etalab 2.0), through the Géoplateforme WFS:
  the named sites of `zone_d_activite_ou_d_interet` other than the public
  spaces and markets that rpr.sources.places already has (churches, temples
  and synagogues, museums, hospitals, palaces, ministries, schools, theatres,
  monuments), and the cemeteries of `cimetiere`. Their outlines give a centre
  and a spread.

A name is kept only if it is distinctive: something is left once its kind of
building, particles and plain descriptions are taken away ("Fontaine
publique", "Hôtel néogothique" and "Immeuble" are not). Statues and memorials
named after a person are left out, and so are the Wallace fountains and
Morris columns, which stand everywhere. Each entry keeps its arrondissements,
so the caption's arrondissement can choose between homonyms (the Saint-Pierre
churches of Montmartre and of the Gros-Caillou).

Run `python -m rpr monuments` to rebuild pipeline/cache/paris-monuments.json.
"""

from __future__ import annotations

import csv
import io
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

from rpr import net, paths
from rpr.sources.places import PARIS_BBOX, Arrondissements, _cached as _places_cached, _distance_m, _parts, centre_and_spread
from rpr.sources.streetnames import ARRONDISSEMENTS_DATASET, ODS, norm

MONUMENTS_PATH = paths.REPO_ROOT / "pipeline" / "cache" / "paris-monuments.json"
RAW = paths.REPO_ROOT / "pipeline" / "cache" / "monuments"  # downloads, not committed
MERIMEE_CSV = "https://ministere-culture.s3.sbg.io.cloud.ovh.net/POP/merimee.csv"  # data.gouv.fr, dataset 5af120e5b595087cfabcde81

MERIMEE_CREDIT = "Ministère de la Culture, base Mérimée (Licence Ouverte / Etalab 2.0)"
BDTOPO_CREDIT = "IGN BD TOPO (Licence Ouverte / Etalab 2.0)"

# Words that say what kind of building a name is ("Église Saint-Sulpice"), as normalised.
HEADS = {
    "eglise", "chapelle", "cathedrale", "basilique", "temple", "synagogue", "mosquee", "oratoire",
    "hotel", "hotels", "palais", "musee", "fontaine", "cimetiere", "hopital", "hospice", "maison",
    "college", "lycee", "ecole", "institut", "seminaire", "couvent", "abbaye", "prieure", "cloitre", "monastere",
    "theatre", "opera", "colonne", "obelisque", "tour", "arc", "barriere", "rotonde", "pavillon", "chateau",
    "mairie", "ministere", "caserne", "prison", "halle", "bibliotheque", "regard", "tombeau", "manufacture",
    "bourse", "conservatoire", "observatoire", "monument", "mur", "porte", "statue", "presbytere", "refectoire",
    "grenier", "entrepot", "entrepots", "marche", "gare", "cirque",
}
# Left out of a name when judging whether it is distinctive.
_PLAIN = {
    "de", "la", "le", "les", "des", "du", "d", "l", "aux", "au", "a", "en", "et", "ou", "dit", "dite", "dits", "dites",
    "ancien", "ancienne", "anciens", "anciennes", "publique", "public", "immeuble", "immeubles", "batiment", "siecle",
    "partie", "parties", "deux", "petit", "petite", "grand", "grande", "vieux", "vieille", "e", "er", "eme",
    "metropolitain", "station", "arrondissement", "arrondissements", "paris", "annexe", "site", "siege",
    # kinds of shop and room, which Mérimée titles give as names ("Boulangerie", "Pharmacie")
    "boutique", "boutiques", "magasin", "magasins", "boucherie", "boulangerie", "charcuterie", "cremerie",
    "horlogerie", "librairie", "pharmacie", "piscine", "poissonnerie", "patisserie", "epicerie", "cafe",
    "restaurant", "brasserie", "cabaret", "pavillons", "prefecture", "lavoir", "bains", "douches", "kiosque",
} | HEADS
# Names that stand for many places: never a position.
_EVERYWHERE = re.compile(r"\b(?:wallace|morris)\b")
# Statues and busts are moved, and stand in museums and courtyards as often as in the street.
_NOT_BUILDINGS = {"statue", "statues", "buste"}
# Mérimée entries that are streets, squares, bridges or networks rather than a building
# (the street geocoder and rpr.sources.places have those), by their first kind.
MERIMEE_SKIP = {
    "place", "square", "passage couvert", "galerie marchande", "pont", "passerelle", "canal",
    "aqueduc", "fortification d'agglomération", "station de métro", "transformateur (abri)", "lotissement concerté",
    "secteur urbain concerté", "grand ensemble", "carrière", "carrière souterraine", "cité", "ilôt", "latrine",
}
# A head-less name of one word must be at least this long ("Conciergerie", not "Fers").
SHORT_NAME = 6
# A title's clauses: "Hôtel X, actuellement ministère Y", "Fontaine dite Z, puis de W".
_CLAUSE = re.compile(
    r"\s*(?:[,;:()\[\]]|\s+-\s+|\bactuel(?:le)?(?:ment)?\b|\bdevenue?s?\b|\bpuis\b|\banciennement\b|\bappel[ée]e?s?\b"
    r"|\bcomprenant\b|\bdans\b|\ben bordure\b|\bsitu[ée]e?s?\b)\s*",
    re.IGNORECASE,
)
# "X ou Y", "X dit Y"; "X et Y" only for two buildings ("Anciens hôtels de Rohan et Soubise",
# "Hôtel de France et de Choiseul"), not inside a name ("Conservatoire des Arts et Métiers").
_ALTERNATIVE = re.compile(r"\s+(?:dite?s?(?:\s+aussi)?|ou)\s+", re.IGNORECASE)
_AND = re.compile(r"\s+et\s+(?=(?:de\s+la|de\s+l['’]|des|du|de|d['’])\s*[A-ZÀ-Ý]|(?i:h[ôo]tel|fontaine|[ée]glise|chapelle|passage|maison)\b)")
_LEADING = re.compile(r"^(?:(?:anciens?|anciennes?|restes?|vestiges?|dite?s?|aussi|ancien|actuel(?:le)?)\b\s*(?:de\s+l['’]|de\s+la|des|du|de)?\s*)+", re.IGNORECASE)
_ARTICLE = re.compile(r"^(?:le|la|les|l)\s+")
_PARTICLE = re.compile(r"^(?:de\s+la|de\s+l['’]|des|du|de|d['’])\s*", re.IGNORECASE)

# BD TOPO public-interest areas left to rpr.sources.places, by nature, and post offices
# ("Poste de Paris - Louvre" is named after its quarter, not a building).
BDTOPO_SKIP = {"Espace public", "Marché", "Poste"}
BDTOPO_SKIP_CATEGORY = {"Sport"}
BDTOPO_SKIP_DETAIL = {"Statue", "Stèle", "Mémorial", "Monument aux morts", "Croix de Lorraine"}


# ------------------------------------------------------------ names


def key(name: str) -> str:
    """Lookup key: normalised, without a leading article ("Le Panthéon" -> "pantheon")."""
    return _ARTICLE.sub("", norm(name))


def skeleton(k: str) -> str:
    """A key without its particles ("hotel de choiseul praslin" -> "hotel choiseul praslin")."""
    return " ".join(w for w in k.split() if w not in {"de", "la", "le", "les", "des", "du", "d", "l", "aux", "au", "a", "en"})


# Titles of the people a hôtel is named after: "hôtel du duc de Villars" is the hôtel de Villars.
_TITLES = {
    "duc", "duchesse", "comte", "comtesse", "marquis", "marquise", "baron", "baronne", "president", "presidente",
    "marechal", "marechale", "cardinal", "prince", "princesse", "chancelier", "vicomte", "vicomtesse",
}


def forms(k: str) -> set[str]:
    """The forms a key is looked up by: as written, without particles, without spaces
    ("hotel dargenson" = "hotel d argenson"), and a hôtel without its owner's title."""
    out = {k, skeleton(k), k.replace(" ", "")}
    if k.startswith("hotel ") and any(w in _TITLES for w in k.split()):
        out.add(skeleton(" ".join(w for w in k.split() if w not in _TITLES)))
    return {f for f in out if f}


def distinctive(name: str) -> bool:
    """Something proper is left once the kind of building and plain words are taken away."""
    k = key(name)
    if not k or _EVERYWHERE.search(k) or k in {"paris"}:
        return False
    words = k.split()
    if words[0] in _NOT_BUILDINGS:
        return False
    rest = [w for w in words if w not in _PLAIN and not w.isdigit() and not re.fullmatch(r"\d+(?:e|er|eme)?|x{0,3}(?:ix|iv|v?i{0,3})e?", w)]
    if not rest:
        return False
    if words[0] not in HEADS and len(words) == 1 and len(words[0]) < SHORT_NAME:
        return False
    if words[0] not in HEADS and len(rest) == 2 and rest[0] in {"saint", "sainte"}:
        return False  # "Saint-Marc": a church, a street or a quarter
    # A proper name is written with a capital: "Hôtel Lambert", not "Hôtel néogothique".
    rest_text = name.split(None, 1)[1] if words[0] in HEADS and len(name.split()) > 1 else name
    return bool(re.search(r"[A-ZÀ-Ý]", rest_text))


def _head(fragment: str) -> str | None:
    """The kind of building a name starts with, after a qualifier ("petit hôtel de Montmorency")."""
    words = norm(fragment).split()
    n = 1 if len(words) > 1 and words[0] in _QUALIFIERS else 0
    return fragment.split()[n] if len(words) > n and words[n] in HEADS else None


def names_from_title(title: str) -> list[str]:
    """The names a Mérimée title gives a building.

    "Hôtel de Gournay ou de Mortemart, dit aussi d'Aguesseau" -> Hôtel de Gournay,
    Hôtel de Mortemart, Hôtel d'Aguesseau; "Anciens hôtels de Rohan et Soubise,
    actuellement Archives Nationales" -> Hôtel de Rohan, Hôtel Soubise, Archives
    Nationales; "Fontaine dite Trogneux, puis de Charonne" -> Fontaine Trogneux,
    Fontaine de Charonne.
    """
    out: list[str] = []
    head: str | None = None
    for clause in _CLAUSE.split(title):
        clause = clause.strip(" .'\"«»")
        if not clause:
            continue
        own_head = False
        plural = bool(re.match(r"(?i)(?:anciens\s+)?h[ôo]tels\b", _LEADING.sub("", clause)))
        alts = [a for part in _ALTERNATIVE.split(clause) for a in (re.split(r"\s+et\s+", part) if plural else _AND.split(part))]
        for i, alt in enumerate(alts):
            alt = _LEADING.sub("", alt.strip(" .'\"«»"))
            if not alt:
                continue
            h = _head(alt)
            if h:
                head, own_head = h, True
                if norm(h) in {"hotels", "entrepots"}:  # "Anciens hôtels de Rohan et Soubise"
                    alt = re.sub(r"^\w+", h.rstrip("sS"), alt)
                    head = h.rstrip("sS")
            elif head and (_PARTICLE.match(alt) or (i > 0 and own_head and alt[:1].isupper())):
                own_head = True
                alt = f"{head.rstrip('sS') if norm(head).endswith('s') else head} {alt}"
            elif not alt[:1].isupper():
                continue
            out.append(re.sub(r"\s+", " ", alt))
    return list(dict.fromkeys(n for n in out if distinctive(n)))


# ------------------------------------------------------------ building


_CENTURY = re.compile(r"(?:(\d)(?:er|e|ère)\s+(quart|moitié|tiers)\s+)?(\d{1,2})e\s+siècle")


def built_from(text: str) -> int | None:
    """First year of the earliest building campaign: '3e quart 19e siècle' -> 1850."""
    years = []
    for m in _CENTURY.finditer(text or ""):
        start = (int(m.group(3)) - 1) * 100
        if m.group(1):
            part = {"quart": 25, "moitié": 50, "tiers": 33}[m.group(2)]
            start += (int(m.group(1)) - 1) * part
        years.append(start)
    return min(years) if years else None


def _arr_of_commune(commune: str) -> int | None:
    m = re.search(r"Paris\s+(\d{1,2})", commune or "")
    return int(m.group(1)) if m else None


def merimee_entries(rows: Iterable[dict], arrondissements: Arrondissements) -> list[dict]:
    out = []
    for r in rows:
        kind = (r.get("Denomination_de_l_edifice") or "").split(";")[0]
        if kind in MERIMEE_SKIP:
            continue
        try:
            lat, lon = (float(v) for v in r.get("coordonnees_au_format_WGS84", "").split(","))
        except ValueError:
            continue
        names = names_from_title(r.get("Titre_editorial_de_la_notice", ""))
        for other in (r.get("Autre_appellation_de_l_edifice") or "").split(";"):
            names += [n for n in names_from_title(other) if n not in names]
        if not names:
            continue
        arr = sorted({a for a in (_arr_of_commune(r.get("Commune_forme_index", "")), arrondissements.of(lon, lat)) if a})
        if not arr:
            continue
        e = {"names": names, "kind": kind, "center": [round(lon, 6), round(lat, 6)],
             "spread": 0, "arr": arr, "source": "merimee", "ref": r.get("Reference", "")}
        year = built_from(r.get("Siecle_de_la_campagne_principale_de_construction", ""))
        if year:
            e["built"] = year
        out.append(e)
    return out


def _bdtopo_names(toponyme: str) -> list[str]:
    """The whole name, its first part, and later parts that name a building of their own:
    'Musée Carnavalet - Musée d'Histoire de Paris' -> all three; 'Mairie de Paris - 1er
    Arrondissement' and 'Lycée Abbé Grégoire - Annexe' -> the whole name and the first part."""
    parts = [p.strip() for p in re.split(r"\s+-\s*|\s*-\s+", toponyme) if p.strip()]
    keep = [toponyme.strip(), *parts[:1], *(p for p in parts[1:] if _head(p))]
    return list(dict.fromkeys(p for p in keep if distinctive(p)))


def bdtopo_entries(zones: Iterable[dict], cemeteries: Iterable[dict], arrondissements: Arrondissements, merge_m: float = 300) -> list[dict]:
    groups: dict[tuple[str, str], list[dict]] = {}
    for f, layer in [(f, "zone") for f in zones] + [(f, "cimetiere") for f in cemeteries]:
        p = f.get("properties") or {}
        name = (p.get("toponyme") or "").strip()
        if not name or not f.get("geometry"):
            continue
        if layer == "zone":
            if p.get("nature") in BDTOPO_SKIP or p.get("categorie") in BDTOPO_SKIP_CATEGORY or p.get("nature_detaillee") in BDTOPO_SKIP_DETAIL:
                continue
            if p.get("nature") == "Monument" and norm(name).split()[0] not in HEADS:
                continue  # a statue or memorial named after a person
            kind = (p.get("nature_detaillee") or p.get("nature") or "").lower()
        else:
            kind = "cimetière"
        names = _bdtopo_names(name)
        if not names:
            continue
        parts = _parts(f["geometry"])
        cs = centre_and_spread(parts)
        if not cs:
            continue
        group = groups.setdefault((key(name), kind), [])
        for g in group:  # pieces of one site
            if _distance_m(g["first"], cs[0]) <= merge_m:
                g["parts"] += parts
                break
        else:
            group.append({"names": names, "kind": kind, "first": cs[0], "parts": parts, "ref": p.get("cleabs", "")})
    out = []
    for (_, _), group in sorted(groups.items()):
        for g in group:
            centre, spread = centre_and_spread(g["parts"])
            arr = arrondissements.touched(g["parts"], centre)
            if arr:
                out.append({"names": g["names"], "kind": g["kind"], "center": list(centre), "spread": spread, "arr": arr,
                            "source": "bdtopo", "ref": g["ref"]})
    return out


def _merimee_rows(refresh: bool) -> list[dict]:
    """Paris rows of the Mérimée CSV (100 MB for all France), cached as JSON."""
    keep = [
        "Reference", "Titre_editorial_de_la_notice", "Autre_appellation_de_l_edifice", "Denomination_de_l_edifice",
        "Commune_forme_index", "coordonnees_au_format_WGS84", "Siecle_de_la_campagne_principale_de_construction",
    ]

    def fetch() -> list[dict]:
        text = net.fetch_bytes(MERIMEE_CSV, timeout=600).decode("utf-8")
        csv.field_size_limit(1 << 30)
        reader = csv.DictReader(io.StringIO(text, newline=""), delimiter="|")
        return [{k: r.get(k) or "" for k in keep} for r in reader if r.get("Departement_format_numerique") == "75"]

    return _cached("merimee-75.json", fetch, refresh)


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

    arr_geo = _places_cached(
        "arrondissements.geojson", lambda: net.fetch_json(ODS.format(id=ARRONDISSEMENTS_DATASET, fmt="geojson"), timeout=180), refresh
    )
    arrondissements = Arrondissements(arr_geo["features"])
    rows = _merimee_rows(refresh)
    log(f"monuments: Mérimée: {len(rows)} protected buildings in Paris")
    zones = _places_cached(  # shared with `rpr places`
        "bdtopo-zone_d_activite_ou_d_interet.json", lambda: wfs("BDTOPO_V3:zone_d_activite_ou_d_interet", PARIS_BBOX), refresh
    )
    cemeteries = _cached("bdtopo-cimetiere.json", lambda: wfs("BDTOPO_V3:cimetiere", PARIS_BBOX), refresh)
    log(f"monuments: BD TOPO: {len(zones)} sites, {len(cemeteries)} cemeteries")
    entries = merimee_entries(rows, arrondissements) + bdtopo_entries(zones, cemeteries, arrondissements)
    MONUMENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    MONUMENTS_PATH.write_text(
        json.dumps({"source": [MERIMEE_CREDIT, BDTOPO_CREDIT], "monuments": entries}, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    names = sum(len(e["names"]) for e in entries)
    log(f"monuments: {len(entries)} landmarks under {names} names -> {MONUMENTS_PATH.name}")
    return {"monuments": len(entries), "names": names, "file": MONUMENTS_PATH.relative_to(paths.REPO_ROOT).as_posix()}


# ------------------------------------------------------------ lookups

# Kinds of way: a name right after one is a street's ("rue de l'Abbaye", "place du Panthéon").
_WAYS = {
    "rue", "r", "ruelle", "place", "quai", "boulevard", "bd", "avenue", "av", "impasse", "passage", "square", "pont",
    "port", "allee", "villa", "cite", "carrefour", "chaussee", "faubourg", "fg", "fb", "parvis", "sentier", "chemin",
    "route", "esplanade", "cul", "sac", "station", "metro", "arrondissement", "quartier",
}
_LINKS = {"de", "la", "le", "les", "des", "du", "d", "l", "aux", "au", "a"}
_TOWARDS = {"vers"}  # "vue vers le Panthéon": taken from elsewhere
_FORMER = {"ancien", "ancienne", "anciens", "anciennes", "ex"}  # "l'ancien Hôtel-Dieu" may be gone


@dataclass
class Mention:
    words: str  # as normalised
    entries: list[dict]
    former: bool = False  # the caption calls it "ancien": the building may have been rebuilt elsewhere
    carried_on: bool = False  # the caption goes on with a proper name: "Hôtel de Sully Charost"


class Monuments:
    """Lookups of a caption's words in the gazetteer."""

    def __init__(self, entries: list[dict] | None = None):
        self.entries = entries or []
        self.index: dict[str, list[int]] = {}
        for i, e in enumerate(self.entries):
            for n in e["names"]:
                for f in forms(key(n)):
                    if i not in self.index.setdefault(f, []):
                        self.index[f].append(i)
        # Captions add particles a name's key may lack ("abbaye de Saint-Germain-des-Prés").
        self.longest = max((len(k.split()) for k in self.index), default=0) + 3

    @classmethod
    def load(cls, path: Path = MONUMENTS_PATH) -> "Monuments":
        if not path.exists():
            return cls()
        return cls(json.loads(path.read_text(encoding="utf-8")).get("monuments", []))

    def lookup(self, name: str) -> list[dict]:
        """Landmarks known under this name (any of its forms)."""
        found: list[int] = []
        for f in forms(key(name)):
            found += [i for i in self.index.get(f, []) if i not in found]
        return [self.entries[i] for i in found]

    @staticmethod
    def name(entry: dict, words: str) -> str:
        """The entry's name that these caption words stand for."""
        wanted = forms(key(words))
        return next((n for n in entry["names"] if forms(key(n)) & wanted), entry["names"][0])

    def mentions(self, text: str) -> list[Mention]:
        """Landmark names in a piece of caption, left to right, longest first.

        A name right after a kind of way is part of a street's name ("rue de
        l'Abbaye") and a name after "vers" is where the view looks to: neither
        is where the photo was taken. A name never starts or ends on a particle.
        A name the caption qualifies ("Petit Hôtel de Villars") is another
        building; one it carries on with a proper name ("Hôtel-Dieu de
        Montlhéry", "Hôtel de Sully Charost") may be, and is flagged. A word in
        brackets after a name qualifies it the same way ("Hôtel de Montmorency
        [petit]", "Cloître des Billettes [ancien]"); no name runs across a bracket.
        """
        words, capital, bounds, after = _segments(text)
        out: list[Mention] = []
        i = 0
        while i < len(words):
            if words[i] in _LINKS:
                i += 1
                continue
            for j in range(min(len(words), i + self.longest), i, -1):
                if words[j - 1] in _LINKS or any(i < b < j for b in bounds):
                    continue
                span = " ".join(words[i:j])
                found = self.lookup(span)
                if not found:
                    continue
                start = max((b for b in bounds if b <= i), default=0)
                before = words[max(start, i - 4):i]
                qualified = bool(before) and before[-1] in _QUALIFIERS
                if after.get(j) in _QUALIFIERS:  # the Petit Hôtel de Montmorency, if it is known
                    span = f"{after[j]} {span}"
                    found = self.lookup(span)
                    qualified = qualified or not found
                while before and before[-1] in _LINKS:
                    before.pop()
                former = bool(before and before[-1] in _FORMER) or after.get(j) in _FORMER
                k = j
                while k < len(words) and k not in bounds and words[k] in _LINKS:
                    k += 1
                carried_on = k < len(words) and k not in bounds and capital[k] and words[k] not in _NOT_A_CONTINUATION
                street_or_view = bool(before) and (before[-1] in _WAYS or before[-1] in _TOWARDS)
                if not (street_or_view or qualified):
                    out.append(Mention(span, found, former, carried_on))
                i = j - 1
                break
            i += 1
        return out


_QUALIFIERS = {"petit", "petite", "grand", "grande", "nouveau", "nouvel", "nouvelle"}
_NOT_A_CONTINUATION = {"paris", "france"}  # "Cathédrale Notre-Dame de Paris"


_BRACKET = re.compile(r"\[([^\]]*)\]")


def _segments(text: str) -> tuple[list[str], list[bool], set[int], dict[int, str]]:
    """A caption piece's words (see _words), the word indices where a bracketed part
    begins or ends, and the qualifier written in brackets after a word, keyed by the
    index that follows it: "Hôtel de Montmorency [petit]" gives {3: "petit"}."""
    words: list[str] = []
    capital: list[bool] = []
    bounds: set[int] = set()
    after: dict[int, str] = {}
    for n, part in enumerate(_BRACKET.split(text)):
        w, c = _words(part)
        if n % 2 and len(w) == 1 and w[0] in _QUALIFIERS | _FORMER:
            after[len(words)] = w[0]
        else:
            words += w
            capital += c
        bounds.add(len(words))
    return words, capital, bounds - {0, len(words)}, after


def _words(text: str) -> tuple[list[str], list[bool]]:
    """A caption's normalised words, and whether each was written with a capital."""
    words: list[str] = []
    capital: list[bool] = []
    for token in re.findall(r"[^\W_]+", text):
        for w in norm(token).split():
            words.append(w)
            capital.append(token[:1].isupper() and not w.isdigit())
    return words, capital

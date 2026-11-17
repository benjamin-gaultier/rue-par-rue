"""Place archive captions on the map.

Captions in the Paris Musées catalogue follow a few habits:

    "Passage de l'Opéra, vue prise de la rue Lepeletier, 9ème arrondissement, Paris."
    "Boulevard Henri IV (de la rue de Sully)"
    "Vieille maison à l'angle de la rue d'Arras et de la rue Clopin, 5ème arrondissement"

We pull out the arrondissement and the street names, prefer the street the
view was taken from ("vue prise de", "(de la rue ...)"), and look them up in
the national address base through the IGN Géoplateforme geocoder. Only
confident matches inside the right arrondissement are kept: a street that
was renamed or demolished stays unplaced rather than placed wrongly.
"""

from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from rpr import net

GEOCODER = "https://data.geopf.fr/geocodage/search"
MIN_SCORE = 0.8

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


@dataclass
class ParsedCaption:
    streets: list[str]
    viewpoint: str | None
    arrondissement: int | None

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


def _clean(street: str) -> str:
    street = re.sub(r"\s+", " ", street).strip(" .'\"’")
    street = re.sub(r"^bd\b", "boulevard", street, flags=re.IGNORECASE)
    street = re.sub(r"^av\.", "avenue", street, flags=re.IGNORECASE)
    return street


def parse_caption(caption: str) -> ParsedCaption:
    text = caption.replace(" ", " ").strip().strip('"')
    arr = _ARRONDISSEMENT.search(text)
    streets = []
    for m in _STREET.finditer(text):
        s = _clean(m.group(1))
        if len(s.split()) >= 2 and s.lower() not in (x.lower() for x in streets):
            streets.append(s)
    viewpoint = None
    vm = _VIEW_FROM.search(text)
    if vm:
        after = text[vm.end():]
        m = _STREET.match(after)
        if m:
            viewpoint = _clean(m.group(1))
            if viewpoint.lower() not in (x.lower() for x in streets):
                streets.append(viewpoint)
    return ParsedCaption(streets=streets, viewpoint=viewpoint, arrondissement=int(arr.group(1)) if arr else None)


@dataclass
class Match:
    lon: float
    lat: float
    label: str
    score: float
    street: str
    role: str  # viewpoint or subject


class Geocoder:
    """Street lookups with an on-disk cache, so reruns cost no requests."""

    def __init__(self, cache_path: Path | None = None, fetch: Callable[[str], dict] | None = None):
        self.cache_path = cache_path
        self.cache: dict[str, dict | None] = {}
        if cache_path and cache_path.exists():
            self.cache = json.loads(cache_path.read_text())
        self.fetch = fetch or (lambda url: net.fetch_json(url, timeout=30))
        self.requests = 0

    def save(self) -> None:
        if self.cache_path:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self.cache, ensure_ascii=False, sort_keys=True, indent=0))

    def street(self, name: str, citycode: str | None) -> dict | None:
        key = f"{name.lower()}|{citycode or 'paris'}"
        if key in self.cache:
            return self.cache[key]
        params = {"q": name if citycode else f"{name} Paris", "type": "street", "limit": "1"}
        if citycode:
            params["citycode"] = citycode
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
        self.cache[key] = result
        return result

    def place(self, caption: str) -> Match | None:
        parsed = parse_caption(caption)
        for name, role in parsed.candidates():
            r = self.street(name, parsed.citycode)
            if not r or r["score"] < MIN_SCORE:
                continue
            if not str(r.get("citycode", "")).startswith("751"):
                continue
            if parsed.citycode and r["citycode"] != parsed.citycode:
                continue
            return Match(lon=r["lon"], lat=r["lat"], label=r["label"], score=r["score"], street=name, role=role)
        return None

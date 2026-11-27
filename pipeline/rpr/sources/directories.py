"""Who kept shop or lived at each address of a model area, from the trade directories.

Source: SoDUCo, "Annuaires historiques parisiens, 1798-1914" (Nakala,
doi:10.34847/nkl.98eem49t, Licence Ouverte / Etalab 2.0): every entry of the
Paris trade directories, read by OCR, split into name, activity and address,
and geocoded by SoDUCo on the atlas of the same years. The directories
themselves are scans in the BnF's Gallica.

There is no directory for 1836 in the corpus. The nearest are the general
lists (ListNoms) of Bottin's Almanach du commerce for 1835 and 1837. An entry
is kept only when:
- SoDUCo placed it at a house number (not only on a street), on Jacoubet's
  atlas of 1836, and the number it found is the one printed;
- its name is in the OCR text of the entry, so the name and the address
  belong together;
- its house is placed at the 1836 address point of the Vasserot cadastre
  (ALPAGE) with that street and number, within NEAR_M of SoDUCo's point, or,
  where ALPAGE has no such point, at SoDUCo's own point on Jacoubet's atlas
  (marked `placed: jacoubet`);
- a building of the 1836 model stands on that point, or within BUILDING_M of
  it (address points lie on the street front).

`fetch` reads only the two years needed from the dataset's 2 GB zip, by HTTP
range requests, and keeps the entries inside the area's box in a small
committed cache, so `build` runs offline.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import math
import re
import shutil
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable

from rpr import paths
from rpr.areas import AREAS, area_file, file_name, manifest_file

DOI = "10.34847/nkl.98eem49t"
# directories-ListNoms.zip (CSV per year), sha1 as listed by the Nakala API.
LISTNOMS_ZIP = f"https://api.nakala.fr/data/{DOI}/edd55aa542a6a47cc07a0e3f705939919cf2c284"
YEARS = (1835, 1837)
CREDIT = "SoDUCo, Annuaires historiques parisiens 1798-1914 (Nakala, Licence Ouverte / Etalab 2.0), from Bottin's Almanach du commerce (BnF Gallica)"
LICENCE = "Licence Ouverte / Etalab 2.0"
ATLAS_1836 = "atlas_jacoubet_1836"
NEAR_M = 30.0  # SoDUCo's point and the Vasserot address point of the same number
BUILDING_M = 8.0  # an address point this close to a building's outline is that building's
KEEP = [
    "uuid", "text_ocr", "per", "act", "address.number", "address.name",
    "geocoding.response.layer", "geocoding.response.number", "geocoding.response.name",
    "geocoding.response.source", "geocoding.response.geom", "source.publication_year", "source.view_link",
]
CACHE_DIR = paths.REPO_ROOT / "pipeline" / "cache"

# Words of an activity -> the trade drawn on a shopfront (names of TRADES in
# web/src/signs.ts). First match wins; an activity matching none is no shop
# the app can letter, and keeps generic lettering.
TRADE_WORDS: list[tuple[str, str]] = [
    (r"\bm(?:ar)?(?:chan)?d\.? de vins?\b|\bm\.? de vin|\bvins?\b|\btraiteur.*vin", "wine"),
    (r"\blimonad|\bcaf[eé]", "cafe"),
    (r"\bboulang", "bakery"),
    (r"\btabac|\bbureau de tab", "tobacco"),
    (r"\bh[oô]tel garni|\bh\. garni|\blogeur|\bmaison meubl", "hotel"),
    (r"\bmerci[eè]|\bmerceri", "mercer"),
    (r"\blibr|\blib\b", "books"),
    (r"\bbouch[eè]r|\bbouch\b", "butcher"),
    (r"\bperruq|\bcoiff", "barber"),
    (r"\b[eé]pic(?:i|\b)", "grocer"),
    (r"\bpharm|\bapothic", "pharmacy"),
    (r"\bfruiti|\bcr[eè]mi|\bfromag|\blaiti", "dairy"),
    (r"\bcharcut", "pork"),
    (r"\bhorlog", "clocks"),
    (r"\borf[eè]v|\bbijout|\bjoaill", "gold"),
    (r"\bpapet", "stationer"),
    (r"\btraiteur|\brestaurat", "restaurant"),
    (r"\bp[aâ]tiss", "pastry"),
]


def trade_of(act: str) -> str | None:
    """The shopfront trade of a directory activity, if the app draws one."""
    a = act.lower()
    for pattern, trade in TRADE_WORDS:
        if re.search(pattern, a):
            return trade
    return None


def mentions(field: str) -> list[str]:
    """The quoted mentions of a SoDUCo entity field: "'Adam (Ve','x'" -> ["Adam (Ve", "x"]."""
    return [m.replace("''", "'").strip() for m in re.findall(r"'((?:[^']|'')*)'", field or "")]


def clean_name(name: str) -> str:
    """Tidy a name mention: close an open parenthesis, drop stray punctuation."""
    name = re.sub(r"\s+", " ", name).strip(" ,.;:-")
    if name.count("(") > name.count(")"):
        name += ")"
    return name


def fold(s: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def number_key(n: str) -> str:
    return re.sub(r"\s+", "", (n or "").lower())


def point(wkt: str) -> tuple[float, float] | None:
    m = re.match(r"POINT ?\(([-\d.]+) ([-\d.]+)\)", wkt or "")
    return (float(m[1]), float(m[2])) if m else None


def distance_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * 111_320 * k, (a[1] - b[1]) * 110_540)


class _RangeFile:
    """A remote file read by HTTP range requests, enough for zipfile."""

    def __init__(self, url: str):
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=0-0"}), timeout=60) as r:
            self.size = int(r.headers["Content-Range"].split("/")[1])

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = 0) -> int:
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            n = self.size - self.pos
        if n == 0 or self.pos >= self.size:
            return b""
        end = min(self.size, self.pos + n) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        with urllib.request.urlopen(req, timeout=600) as r:
            data = r.read()
        self.pos += len(data)
        return data


def cache_file(area: str) -> Path:
    return CACHE_DIR / f"directories-{area}.csv.gz"


def fetch(area: str, log: Callable[[str], Any] = print) -> Path:
    """Read the years needed from the dataset and keep the entries in the area's box."""
    west, south, east, north = AREAS[area]["bbox"]
    raw = CACHE_DIR / "directories"
    raw.mkdir(parents=True, exist_ok=True)
    rows: list[dict] = []
    archive: zipfile.ZipFile | None = None
    for year in YEARS:
        member = f"{year}/directories-ListNoms-{year}.csv"
        local = raw / Path(member).name
        if not local.exists():
            archive = archive or zipfile.ZipFile(_RangeFile(LISTNOMS_ZIP))  # type: ignore[arg-type]
            log(f"directories: reading {member} from Nakala")
            with archive.open(member) as src, open(local.with_suffix(".part"), "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            local.with_suffix(".part").replace(local)
        csv.field_size_limit(1 << 30)
        with open(local, encoding="utf-8", newline="") as f:
            for r in csv.DictReader(f):
                p = point(r["geocoding.response.geom"])
                if p and west < p[0] < east and south < p[1] < north:
                    rows.append({k: r[k] for k in KEEP})
    out = cache_file(area)
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=KEEP, lineterminator="\n")
    w.writeheader()
    w.writerows(sorted(rows, key=lambda r: (r["source.publication_year"], r["uuid"], r["address.number"])))
    with gzip.GzipFile(out, "wb", mtime=0) as g:
        g.write(buf.getvalue().encode("utf-8"))
    log(f"directories: {len(rows)} entries in the {area} box -> {out.relative_to(paths.REPO_ROOT)}")
    return out


def read_cache(area: str) -> list[dict]:
    with gzip.open(cache_file(area), "rt", encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def entry_of(r: dict) -> tuple[dict | None, str]:
    """A usable entry from a SoDUCo row, or why not."""
    if r["geocoding.response.layer"] != "address":
        return None, "street only"
    if r["geocoding.response.source"] != ATLAS_1836:
        return None, "not on the 1836 atlas"
    number = number_key(r["address.number"])
    if not number or number != number_key(r["geocoding.response.number"]):
        return None, "number not found"
    names = [clean_name(n) for n in mentions(r["per"])]
    names = [n for n in names if len(fold(n)) >= 2 and n[:1].isupper()]
    if not names:
        return None, "no name"
    # The name and the number must be on one line of the entry: OCR blocks
    # sometimes hold several entries, and the parts may come from different ones.
    name = fold(names[0])
    who = re.compile(rf"\b{re.escape(name)}\b")
    num = re.compile(rf"\b{re.escape(fold(r['address.number']))}\b")
    line = next((fold(ln) for ln in r["text_ocr"].splitlines() if who.search(fold(ln)) and num.search(fold(ln))), None)
    if not name or line is None:
        return None, "name and address not on one line"
    acts = [re.sub(r"\s+", " ", a).strip(" ,.;:") for a in mentions(r["act"])]
    act = acts[0] if acts and fold(acts[0]) in line else ""
    return {
        "name": names[0],
        "act": act,
        "number": r["address.number"].strip(),
        "street": r["geocoding.response.name"],
        "at": point(r["geocoding.response.geom"]),
        "year": int(r["source.publication_year"]),
        "page": r["source.view_link"],
    }, "ok"


_PARTICLES = {"de", "la", "le", "les", "des", "du", "d", "l", "aux", "au", "à", "en", "sur"}


def display_street(name: str) -> str:
    """SoDUCo's title case made French: "Rue De L'Ecole" -> "Rue de l'Ecole"."""
    out = []
    for i, w in enumerate(name.split()):
        low = w.lower()
        if i and (low in _PARTICLES or re.match(r"[ld]'", low)):
            w = low[:2] + w[2:] if "'" in low[:2] else low
        out.append(w)
    return " ".join(out)


def street_keys(street: str) -> list[str]:
    """Keys to try in the Vasserot address points: the whole name, then without
    the qualifiers Jacoubet adds ("Rue du Paon Saint André" -> "rue du paon")."""
    from rpr.sources.streetnames import norm

    words = norm(street).split()
    keys = [" ".join(words[:n]) for n in range(len(words), 1, -1) if words[n - 1] not in _PARTICLES]
    return keys + [k.replace(" des arts", " des arcs") for k in keys if k.endswith(" des arts")]


def address_point(streets: dict, entry: dict) -> tuple[tuple[float, float], str, str]:
    """Where an entry's house stood in 1836, the street's name, and which source placed it.

    The Vasserot address point of the number, nearest SoDUCo's point, on the
    first key that has it; otherwise SoDUCo's own point, geocoded on
    Jacoubet's atlas of 1836 (both lie within a metre or two where both exist).
    """
    for key in street_keys(entry["street"]):
        best = None
        for s in streets.get(key, []):
            p = s["numbers"].get(number_key(entry["number"]))
            if p:
                d = distance_m(tuple(p), entry["at"])
                if d <= NEAR_M and (best is None or d < best[0]):
                    best = (d, (p[0], p[1]), s["name"])
        if best:
            return best[1], best[2], "vasserot"
    return entry["at"], display_street(entry["street"]), "jacoubet"


def same_listing(listings: dict[tuple, dict], e: dict, address: str) -> dict:
    """The listing of this person at this address, made if new.

    The same person printed in both years is one listing, even when the
    activity is abbreviated differently ("greffier C" and "greffier C. de
    cass"): the longer wording is kept. Different activities stay apart.
    """
    act = fold(e["act"])
    for (name, addr, known), listing in listings.items():
        if name == fold(e["name"]) and addr == address and (known.startswith(act) or act.startswith(known)):
            if len(e["act"]) > len(listing["act"]):
                listing["act"] = e["act"]
            return listing
    return listings.setdefault(
        (fold(e["name"]), address, act), {"name": e["name"], "act": e["act"], "address": address, "years": [], "page": e["page"]}
    )


def build(area: str, log: Callable[[str], Any] = print) -> dict:
    from pyproj import Transformer
    from shapely.geometry import Point, shape
    from shapely.ops import transform
    from shapely.strtree import STRtree

    from rpr.sources.streetnames import VASSEROT_PATH

    rows = read_cache(area)
    streets = json.loads(VASSEROT_PATH.read_text(encoding="utf-8"))["streets"]
    to_m = Transformer.from_crs(4326, 2154, always_xy=True).transform
    model = json.loads(area_file(area, "model").read_text(encoding="utf-8"))
    ids, shapes = [], []
    for f in model["features"]:
        p = f["properties"]
        # Buildings standing in 1836: the standing ones and the demolished.
        if p["kind"] == "standing" or (p["kind"] == "reconstructed" and p.get("until", 9999) > 1836 and p.get("from", 0) <= 1836):
            ids.append(p["id"])
            shapes.append(transform(to_m, shape(f["geometry"])))
    tree = STRtree(shapes)

    why: dict[str, int] = {}
    placed_by: dict[str, int] = {}
    buildings: dict[str, dict[tuple, dict]] = {}
    for r in rows:
        e, reason = entry_of(r)
        if e:
            (lon, lat), street_name, placed = address_point(streets, e)
            placed_by[placed] = placed_by.get(placed, 0) + 1
            pt = Point(to_m(lon, lat))
            near = [i for i in tree.query(pt.buffer(BUILDING_M))]
            if not near:
                e, reason = None, "no building at the address"
            else:
                i = min(near, key=lambda k: (0 if shapes[k].contains(pt) else 1, shapes[k].distance(pt)))
                address = f"{e['number']} {street_name}"
                listing = same_listing(buildings.setdefault(ids[i], {}), e, address)
                if placed != "vasserot":
                    listing["placed"] = placed
                if e["year"] not in listing["years"]:
                    listing["years"].append(e["year"])
                    listing["years"].sort()
                trade = trade_of(e["act"]) if e["act"] else None
                if trade:
                    listing["trade"] = trade
        why[reason] = why.get(reason, 0) + 1

    out_buildings = {
        bid: sorted(ls.values(), key=lambda x: (x["address"], fold(x["name"])))
        for bid, ls in sorted(buildings.items())
    }
    listings = sum(len(v) for v in out_buildings.values())
    shops = sum(1 for v in out_buildings.values() for x in v if x.get("trade"))
    data = {
        "source": CREDIT,
        "licence": LICENCE,
        "doi": DOI,
        "years": list(YEARS),
        "buildings": out_buildings,
    }
    path = area_file(area, "directories")
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for k, v in sorted(why.items(), key=lambda kv: -kv[1]):
        log(f"directories: {v:6d} {k}")
    log(f"directories: house placed by {placed_by}")
    log(f"directories: {listings} listings ({shops} with a shop trade) in {len(out_buildings)} buildings -> {path.name}")
    return {
        "file": manifest_file(area, "directories"),
        "entries": len(rows),
        "listings": listings,
        "shops": shops,
        "buildings": len(out_buildings),
        "placed_by": placed_by,
        "model": file_name(area, "model"),
        "source": CREDIT,
    }

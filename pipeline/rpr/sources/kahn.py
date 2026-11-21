"""Albert-Kahn Archives de la Planète, Paris subset (about 5,000 items).

Published by the Hauts-de-Seine department on its Opendatasoft portal. Its
description says each point is "the operator's position when the picture was
taken", so the pose method is "recorded". That holds for a point used once,
or by plates of one view. A point that photos with different captions or
dates share is the place they show, not a tripod position: see
`mark_shared_points`. Field names are matched loosely because the portal's
labels have changed over time; run `python -m rpr kahn --inspect` to print
the live field list.

Note: the Opendatasoft portals reset connections from some cloud egress
ranges. The GitHub Actions harvest workflow runs this source.
"""

from __future__ import annotations

import re
import unicodedata
import urllib.parse
from typing import Any, Callable, Iterable

from rpr import net
from rpr.headings import CONFIDENCE
from rpr.photo import Photo, SourceInfo

DATASET = "archives-de-la-planete-paris"
PORTAL = "https://opendata.hauts-de-seine.fr/api/explore/v2.1/catalog/datasets"
EXPORT_URL = f"{PORTAL}/{DATASET}/exports/json"
INFO_URL = f"{PORTAL}/{DATASET}"

INFO = SourceInfo(
    key="kahn",
    name="Albert-Kahn, Archives de la Planète (Paris)",
    license="See Musée départemental Albert-Kahn terms (CC0 / CC BY per item)",
    homepage="https://www.data.gouv.fr/datasets/archives-de-la-planete-paris",
    attribution="Musée départemental Albert-Kahn, Département des Hauts-de-Seine",
)

# Candidate field names, matched after normalising (lowercase, no accents,
# non-alphanumerics to underscores). First match wins.
FIELDS = {
    "id": ["cote", "numero_inventaire", "numero_d_inventaire", "n_inventaire", "inventaire", "identifiant", "reference", "id"],
    "title": ["legende_revisee", "legende", "legende_originale_titre", "titre", "title", "sujet", "description"],
    "date": ["date_de_prise_de_vue", "date_prise_de_vue", "date_de_prise_vue", "date", "date_de_tournage", "annee"],
    "creator": ["operateur", "operatrice", "photographe", "auteur", "createur"],
    "geo": ["geo_point_2d", "geopoint", "geo_point", "coordonnees", "coordonnees_gps", "localisation", "position"],
    "lat": ["latitude", "lat"],
    "lon": ["longitude", "lon", "lng"],
    "image": ["image", "visuel", "photo", "media", "fichier", "url_image", "lien_image", "vignette"],
    "url": ["lien", "url", "permalien", "notice", "lien_notice", "url_notice"],
    "media": ["procede_technique", "procede", "type", "nature", "support", "type_de_document"],
    "license": ["droits_cessibles", "licence", "license", "droits", "conditions_d_utilisation"],
    "heading": ["orientation", "azimut", "direction"],
}

RECORD_URL = "https://opendata.hauts-de-seine.fr/explore/dataset/" + DATASET + "/table/?q={q}"

# Confidence of a position (Photo.confidence). A point of its own is where the
# operator stood, to about 20 m. A point shared by different views is the
# place: the operator was there or looking at it, up to about 150 m away.
CAMERA_CONFIDENCE = 0.8
SHARED_DAY_CONFIDENCE = 0.5  # one visit, several views
SHARED_PLACE_CONFIDENCE = 0.3  # several visits: a monument, an exhibition, a quarter

YEAR_RE = re.compile(r"\b(18[5-9]\d|19[0-4]\d)\b")


def norm(key: str) -> str:
    s = unicodedata.normalize("NFKD", key).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def pick(record: dict, role: str) -> Any:
    normed = {norm(k): v for k, v in record.items()}
    for cand in FIELDS[role]:
        if cand in normed and normed[cand] not in (None, "", []):
            return normed[cand]
    return None


def parse_geo(record: dict) -> tuple[float, float] | None:
    """Return (lon, lat) from the usual Opendatasoft shapes."""
    g = pick(record, "geo")
    if isinstance(g, dict):
        if "lon" in g and "lat" in g:
            return float(g["lon"]), float(g["lat"])
        if g.get("type") == "Point":
            lon, lat = g["coordinates"][:2]
            return float(lon), float(lat)
        if "geometry" in g:
            lon, lat = g["geometry"]["coordinates"][:2]
            return float(lon), float(lat)
    if isinstance(g, (list, tuple)) and len(g) >= 2:
        lat, lon = float(g[0]), float(g[1])  # ODS geo_point_2d arrays are [lat, lon]
        return lon, lat
    if isinstance(g, str):
        nums = re.findall(r"-?\d+(?:\.\d+)?", g)
        if len(nums) >= 2:
            lat, lon = float(nums[0]), float(nums[1])  # "48.85, 2.34"
            if 40 < lon < 60 and 0 < lat < 10:  # written lon, lat
                lat, lon = lon, lat
            return lon, lat
    lat, lon = pick(record, "lat"), pick(record, "lon")
    if lat is not None and lon is not None:
        return float(lon), float(lat)
    return None


def parse_years(value: Any) -> tuple[int | None, int | None, str | None]:
    if value is None:
        return None, None, None
    text = str(value)
    years = [int(y) for y in YEAR_RE.findall(text)]
    if not years:
        return None, None, text
    return min(years), max(years) if len(years) > 1 else None, text


def image_url(value: Any) -> str | None:
    if isinstance(value, dict):
        return value.get("url") or value.get("href")
    if isinstance(value, list) and value:
        return image_url(value[0])
    if isinstance(value, str) and value.startswith("http"):
        return value
    return None


def text(value: Any) -> str | None:
    """Opendatasoft multivalued fields arrive as lists; join them."""
    if value is None:
        return None
    if isinstance(value, list):
        value = ", ".join(str(v).strip() for v in value if v)
    value = str(value).strip()
    return value or None


UNKNOWN_CREATOR = {"operateur non mentionne", "inconnu", "anonyme", "non identifie"}


def creator_of(value: Any) -> str | None:
    name = text(value)
    if name and norm(name).replace("_", " ") in UNKNOWN_CREATOR:
        return None
    return name


def license_of(value: Any) -> str:
    v = (text(value) or "").lower()
    if v in ("oui", "yes", "true", "1", "libre de droits"):
        return "Libre de droits (Musée départemental Albert-Kahn)"
    return INFO.license


def to_photo(record: dict) -> Photo | None:
    pos = parse_geo(record)
    ident = pick(record, "id")
    if pos is None or ident is None:
        return None
    lon, lat = pos
    year, year_end, date_text = parse_years(pick(record, "date"))
    title = text(pick(record, "title")) or ""
    image = image_url(pick(record, "image"))
    media_raw = (text(pick(record, "media")) or "").lower()
    media = "film" if ("film" in media_raw or "video" in media_raw) else "autochrome" if "autochrome" in media_raw else "photo"
    heading = pick(record, "heading")
    try:
        heading = float(heading) % 360 if heading is not None else None
    except (TypeError, ValueError):
        heading = None
    url = image_url(pick(record, "url")) or RECORD_URL.format(q=urllib.parse.quote(f'"{ident}"'))
    return Photo(
        source=INFO.key,
        source_id=str(ident).strip(),
        title=title or f"Archives de la Planète {ident}",
        lon=lon,
        lat=lat,
        year=year,
        year_end=year_end,
        date_text=date_text,
        creator=creator_of(pick(record, "creator")),
        thumb=image,
        image=image,
        url=url,
        license=license_of(pick(record, "license")),
        credit=INFO.attribution,
        media=media,
        pose="recorded",
        heading=heading,
        heading_method="recorded" if heading is not None else None,
        heading_confidence=CONFIDENCE["recorded"] if heading is not None else None,
        confidence=CAMERA_CONFIDENCE if heading is None else 0.9,
    )


def mark_shared_points(photos: list[Photo]) -> list[Photo]:
    """Flag positions that are a place rather than where the camera stood.

    The archive gives one exact point to all the photos of a place: 44 photos
    share a point inside Notre-Dame, among them views from the square, from
    across the Seine and of the Hôtel de Ville. Plates of one view (same
    caption, same date) do share a real camera position and stay as they are.
    A point with several captions or dates gets `position_of: "place"`, the
    number of photos and of dates that share it, and a lower confidence.
    """
    groups: dict[tuple[float, float], list[Photo]] = {}
    for p in photos:
        groups.setdefault((round(p.lon, 6), round(p.lat, 6)), []).append(p)
    for group in groups.values():
        dates = {p.date_text for p in group}
        views = {norm(p.title) for p in group}
        if len(dates) == 1 and len(views) == 1:
            continue
        for p in group:
            if p.heading is not None:
                continue  # a recorded heading belongs to a camera
            p.extra = {**p.extra, "position_of": "place", "shared_point": len(group), "shared_dates": len(dates)}
            p.confidence = SHARED_DAY_CONFIDENCE if len(dates) == 1 else SHARED_PLACE_CONFIDENCE
    return photos


def harvest_records() -> list[dict]:
    data = net.fetch_json(EXPORT_URL, timeout=300)
    if isinstance(data, dict) and "results" in data:
        data = data["results"]
    return data


def harvest(log: Callable[[str], Any] = print) -> tuple[SourceInfo, Iterable[Photo]]:
    records = harvest_records()
    photos = mark_shared_points([p for p in (to_photo(r) for r in records) if p is not None])
    shared = sum(1 for p in photos if p.extra.get("position_of") == "place")
    log(f"kahn: {len(records)} records, {len(photos)} with an id and a position, {shared} at a point shared by different views")
    return INFO, photos


def inspect(log: Callable[[str], Any] = print) -> None:
    info = net.fetch_json(INFO_URL)
    log(f"kahn: dataset {info.get('dataset_id')}, {info.get('metas', {}).get('default', {}).get('records_count')} records")
    for f in info.get("fields", []):
        log(f"  {f.get('name'):40} {f.get('type'):12} {f.get('label')}")
    sample = net.fetch_json(f"{PORTAL}/{DATASET}/records?limit=2")
    for r in sample.get("results", []):
        log("  sample: " + str(r)[:1500])

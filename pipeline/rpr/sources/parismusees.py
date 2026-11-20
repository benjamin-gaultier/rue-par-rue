"""Paris Musées collections (Musée Carnavalet: Marville, Atget, ...), CC0 open content.

The GraphQL API needs a free token, created at
https://apicollections.parismusees.paris.fr/ and sent in the `auth-token`
header. Set it as the PARISMUSEES_TOKEN environment variable.

The catalogue has no coordinates for these photographs, so captions are
geocoded (see rpr.geocode): at the house number, the street corner or along
the street they name, today's or a historical one. Positions carry pose
"geocoded" and a confidence that follows that precision.
"""

from __future__ import annotations

import gzip
import json
import os
import re
import time
import urllib.error
from pathlib import Path
from typing import Any, Callable, Iterator

from rpr import net, paths
from rpr.geocode import Geocoder
from rpr.photo import Photo, SourceInfo
from rpr.sources.places import Places
from rpr.sources.streetnames import StreetHistory

ENDPOINT = "https://apicollections.parismusees.paris.fr/graphql"
SITE = "https://www.parismuseescollections.paris.fr"
PAGE = 100
MIN_PAGE = 10  # a page the API keeps failing on is split down to this size
# Every work the last harvest saw, as the API returned it, so photos can be
# placed again (`rpr parismusees --offline`) without a token.
WORKS_CACHE = paths.REPO_ROOT / "pipeline" / "cache" / "parismusees-works.json.gz"

# Photographers to harvest: (search string, display name)
PHOTOGRAPHERS = [("Marville", "Charles Marville"), ("Atget", "Eugène Atget")]

INFO = SourceInfo(
    key="parismusees",
    name="Paris Musées (Musée Carnavalet)",
    license="CC0-1.0",
    homepage="https://www.parismuseescollections.paris.fr/",
    attribution="Paris Musées / Musée Carnavalet, Histoire de Paris (CC0)",
)

INTROSPECT = """
query { __schema { queryType { fields { name args { name type { name kind ofType { name kind } } } } } } }
"""

WORKS = """
query($author: [String], $offset: Int!, $limit: Int!) {
  nodeQuery(limit: $limit, offset: $offset, sort: [{field: "nid", direction: ASC}], filter: {conditions: [
    {field: "type", value: "oeuvre"},
    {field: "field_oeuvre_auteurs.entity.field_auteur_auteur.entity.name", value: $author, operator: LIKE}
  ]}) {
    count
    entities {
      ... on NodeOeuvre {
        title
        fieldUrlAlias
        fieldLrefAdlib
        fieldOeuvreNumInventaire
        fieldDateProduction { startYear endYear processed }
        fieldOeuvreGeolocSujet { lat lng }
        fieldOeuvreAuteurs { entity { fieldAuteurAuteur { entity { name } } } }
        fieldVisuels { entity { publicUrl fieldImageLibre } }
      }
    }
  }
}
"""


def headers() -> dict[str, str]:
    token = os.environ.get("PARISMUSEES_TOKEN")
    if not token:
        raise SystemExit(
            "PARISMUSEES_TOKEN is not set. Create a free token at "
            "https://apicollections.parismusees.paris.fr/ and export it."
        )
    return {"auth-token": token}


def query(q: str, variables: dict | None = None) -> Any:
    resp = net.post_json(ENDPOINT, {"query": q, "variables": variables or {}}, headers=headers(), timeout=180)
    if resp.get("errors"):
        raise RuntimeError(json.dumps(resp["errors"], ensure_ascii=False)[:2000])
    return resp["data"]


def introspect(log: Callable[[str], Any] = print) -> None:
    data = query(INTROSPECT)
    for f in data["__schema"]["queryType"]["fields"]:
        args = ", ".join(a["name"] for a in f["args"])
        log(f"  {f['name']}({args})")


def styled(public_url: str, style: str) -> str:
    """Derived image size served by the collections site (pm_notice, pm_diaporama_zoom)."""
    return public_url.replace("/sites/default/files/atoms/", f"/sites/default/files/styles/{style}/public/atoms/", 1)


def creator_name(raw: str) -> str:
    """'Atget, Eugène (Jean Eugène Auguste Atget, dit)' -> 'Eugène Atget'."""
    name = re.sub(r"\s*\(.*\)\s*$", "", raw).strip()
    if "," in name:
        last, first = [p.strip() for p in name.split(",", 1)]
        name = f"{first} {last}"
    return name


def to_photo(work: dict, geocoder: Geocoder, stats: dict) -> Photo | None:
    images = [v["entity"] for v in work.get("fieldVisuels") or [] if v.get("entity") and v["entity"].get("publicUrl")]
    free = [i for i in images if i.get("fieldImageLibre")]
    if not free:
        stats["no free image"] = stats.get("no free image", 0) + 1
        return None
    title = (work.get("title") or "").strip()
    pose, confidence, extra = "geocoded", 0.0, {}
    g = work.get("fieldOeuvreGeolocSujet")
    if g and g.get("lat") and g.get("lng"):
        lon, lat, pose, confidence = g["lng"], g["lat"], "recorded", 0.6
    else:
        date = work.get("fieldDateProduction") or {}
        m = geocoder.place(title, year=date.get("startYear"))
        if not m:
            stats["not placed"] = stats.get("not placed", 0) + 1
            return None
        # Confidence follows precision: a house number pins the building, a
        # street centre can be hundreds of metres from the spot.
        lon, lat, confidence, extra = m.lon, m.lat, m.confidence, m.extra()
    date = work.get("fieldDateProduction") or {}
    authors = [
        creator_name(a["entity"]["fieldAuteurAuteur"]["entity"]["name"])
        for a in work.get("fieldOeuvreAuteurs") or []
        if a.get("entity") and a["entity"].get("fieldAuteurAuteur") and a["entity"]["fieldAuteurAuteur"].get("entity")
    ]
    authors = [a for a in authors if a and a.lower() != "anonyme"]
    url = f"{SITE}/fr/{work['fieldUrlAlias']}" if work.get("fieldUrlAlias") else None
    public = free[0]["publicUrl"]
    extra["original"] = public
    if work.get("fieldOeuvreNumInventaire"):
        extra["inventory"] = work["fieldOeuvreNumInventaire"]
    return Photo(
        source=INFO.key,
        source_id=str(work.get("fieldLrefAdlib") or work.get("fieldUrlAlias")),
        title=title,
        lon=lon,
        lat=lat,
        year=date.get("startYear"),
        year_end=date.get("endYear") if date.get("endYear") != date.get("startYear") else None,
        date_text=date.get("processed"),
        creator=", ".join(dict.fromkeys(authors)) or None,
        thumb=styled(public, "pm_notice"),
        image=styled(public, "pm_diaporama_zoom"),
        url=url,
        license="CC0-1.0",
        credit=INFO.attribution,
        media="photo",
        pose=pose,
        confidence=confidence,
        extra=extra,
    )


def page(author: str, offset: int, size: int, log: Callable[[str], Any] = print) -> dict:
    """One page of works. The API answers big pages slowly and sometimes not at
    all (502 after minutes), so a page that keeps failing is fetched in halves."""
    try:
        return query(WORKS, {"author": [f"%{author}%"], "offset": offset, "limit": size})["nodeQuery"]
    except (urllib.error.URLError, TimeoutError) as err:
        server_side = not isinstance(err, urllib.error.HTTPError) or err.code in net.RETRY_STATUS
        if size <= MIN_PAGE or not server_side:
            raise
        log(f"parismusees: {author} {offset}+{size} failed ({err}), fetching it in halves")
    half = size // 2
    first, second = page(author, offset, half, log), page(author, offset + half, size - half, log)
    return {"count": first["count"], "entities": first["entities"] + second["entities"]}


def works(author: str, log: Callable[[str], Any], limit: int | None = None) -> Iterator[dict]:
    offset, total = 0, None
    while total is None or offset < total:
        data = page(author, offset, PAGE, log)
        total = data["count"] if limit is None else min(data["count"], limit)
        for w in data["entities"]:
            if w:
                yield w
        offset += PAGE
        log(f"parismusees: {author} {min(offset, total)}/{total}")
        time.sleep(0.5)


def save_works(items: list[dict], path: Path = WORKS_CACHE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    items = sorted(items, key=lambda w: str(w.get("fieldLrefAdlib") or w.get("fieldUrlAlias")))
    body = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    with gzip.GzipFile(path, "wb", mtime=0) as f:  # mtime=0: same works, same bytes
        f.write(body)


def load_works(path: Path = WORKS_CACHE) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"{path} is missing: run `rpr parismusees` once with PARISMUSEES_TOKEN set.")
    with gzip.open(path, "rb") as f:
        return json.loads(f.read())


def harvest(log: Callable[[str], Any] = print, limit: int | None = None, offline: bool = False):
    geocoder = Geocoder(
        cache_path=paths.REPO_ROOT / "pipeline" / "cache" / "geocode.json",
        history=StreetHistory.load(),
        places=Places.load(),
    )
    stats: dict[str, int] = {}
    photos: list[Photo] = []
    if offline:
        items = load_works()
        log(f"parismusees: {len(items)} works from {WORKS_CACHE.name}")
    else:
        items, seen = [], set()
        for search, _name in PHOTOGRAPHERS:
            for w in works(search, log, limit):
                key = w.get("fieldLrefAdlib") or w.get("fieldUrlAlias")
                if key not in seen:  # a work by both photographers comes back twice
                    seen.add(key)
                    items.append(w)
        if limit is None:
            save_works(items)
    try:
        for w in items:
            p = to_photo(w, geocoder, stats)
            if p:
                photos.append(p)
    finally:
        geocoder.save()
    precision: dict[str, int] = {}
    for p in photos:
        key = p.extra.get("precision", p.pose)
        precision[key] = precision.get(key, 0) + 1
    log(f"parismusees: placed {len(photos)} photos {precision}; skipped {stats}; geocoder requests {geocoder.requests}")
    return INFO, photos

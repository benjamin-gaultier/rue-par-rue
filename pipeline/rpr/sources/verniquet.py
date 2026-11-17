"""Verniquet's atlas of Paris (1785-1791), warped onto the map with Allmaps.

The SoDUCo team published ground control points for all 72 sheets on
Harvard Dataverse (doi:10.7910/DVN/ZKRJFA, CC0). Their annotations use an
early Allmaps format and record the mask's bounding box where the image
size should be, so we rewrite them into the current Georeference
Annotation format and read the true size from each sheet's IIIF info.json.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from rpr import net, paths

DATAVERSE_FILES = {
    # David Rumsey Map Collection scans: IIIF with CORS, good resolution.
    "rumsey": 7002615,
    # BnF Gallica scans: IIIF Image API 1.1.
    "bnf": 7002730,
}
DATAVERSE_URL = "https://dataverse.harvard.edu/api/access/datafile/{id}"
DOI = "doi:10.7910/DVN/ZKRJFA"

GEOREF_CONTEXT = [
    "http://iiif.io/api/extension/georef/1/context.json",
    "http://iiif.io/api/presentation/3/context.json",
]


def service_type(info: dict) -> str:
    """Work out which IIIF Image API version an info.json describes."""
    t = info.get("type") or info.get("@type")
    if t in ("ImageService1", "ImageService2", "ImageService3"):
        return t
    ctx = info.get("@context", "")
    ctx = " ".join(ctx) if isinstance(ctx, list) else str(ctx)
    profile = info.get("profile", "")
    profile = json.dumps(profile) if not isinstance(profile, str) else profile
    blob = ctx + " " + profile
    for version in ("3", "2", "1"):
        if f"/image/{version}/" in blob or f"image-api/{version}" in blob:
            return f"ImageService{version}"
    return "ImageService2"


def service_id(target: dict) -> str:
    services = target.get("service") or []
    if services:
        s = services[0]
        return (s.get("@id") or s.get("id")).rstrip("/")
    source = target["source"]
    if isinstance(source, dict):
        return source["id"].rstrip("/")
    return re.sub(r"/full/[^/]+/[^/]+/[^/]+\.\w+$", "", source).rstrip("/")


def polygon_points(svg: str) -> list[list[float]]:
    m = re.search(r'points="([^"]+)"', svg)
    if not m:
        raise ValueError("no polygon in SVG selector")
    pts = []
    for pair in m.group(1).split():
        x, y = pair.split(",")
        pts.append([float(x), float(y)])
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts.pop()
    return pts


def _fmt(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else f"{n:.2f}"


def convert_item(item: dict, info: dict) -> dict:
    """Rewrite one SoDUCo annotation into a current Georeference Annotation."""
    target = item["target"]
    width, height = int(info["width"]), int(info["height"])
    mask = polygon_points(target["selector"]["value"])
    for x, y in mask:
        if not (0 <= x <= width and 0 <= y <= height):
            raise ValueError(f"mask point {x},{y} outside image {width}x{height}")
    points = " ".join(f"{_fmt(x)},{_fmt(y)}" for x, y in mask)
    features = []
    for f in item["body"]["features"]:
        props = f.get("properties", {})
        coords = props.get("resourceCoords") or props.get("pixelCoords")
        features.append(
            {
                "type": "Feature",
                "properties": {"resourceCoords": coords},
                "geometry": f["geometry"],
            }
        )
    body = {"type": "FeatureCollection", "features": features}
    if "transformation" in item["body"]:
        body["transformation"] = item["body"]["transformation"]
    return {
        "type": "Annotation",
        "@context": GEOREF_CONTEXT,
        "id": item.get("id"),
        "motivation": "georeferencing",
        "target": {
            "type": "SpecificResource",
            "source": {
                "id": service_id(target),
                "type": service_type(info),
                "width": width,
                "height": height,
            },
            "selector": {
                "type": "SvgSelector",
                "value": f'<svg width="{width}" height="{height}"><polygon points="{points}" /></svg>',
            },
        },
        "body": body,
    }


def convert_page(page: dict, get_info: Callable[[str], dict]) -> dict:
    items = []
    for item in page["items"]:
        sid = service_id(item["target"])
        items.append(convert_item(item, get_info(sid)))
    return {
        "type": "AnnotationPage",
        "@context": "http://www.w3.org/ns/anno.jsonld",
        "items": items,
    }


def harvest(source: str = "rumsey", log: Callable[[str], Any] = print) -> dict:
    page = net.fetch_json(DATAVERSE_URL.format(id=DATAVERSE_FILES[source]))
    log(f"verniquet: {len(page['items'])} sheets from Dataverse ({source})")

    def get_info(sid: str) -> dict:
        return net.fetch_json(f"{sid}/info.json")

    converted = convert_page(page, get_info)
    out = paths.DATA_DIR / "verniquet.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(converted, separators=(",", ":")))
    log(f"verniquet: wrote {out.relative_to(paths.REPO_ROOT)} ({len(converted['items'])} sheets)")
    return {
        "file": "verniquet.json",
        "sheets": len(converted["items"]),
        "images": source,
        "georeferencing": f"SoDUCo, {DOI} (CC0 1.0)",
    }

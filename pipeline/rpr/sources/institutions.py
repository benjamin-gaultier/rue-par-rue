"""The great institutions of the old Cité, traced from Verniquet's atlas.

The 1836 cadastre (Vasserot) names the parcels of the archbishop's palace
and the Hôtel-Dieu but draws no buildings in them, and the Archives
nationales hold no building sheets for them. Verniquet's atlas of Paris
(surveyed 1785-1791) does draw them: built areas are hatched. The app
shows the atlas georeferenced (SoDUCo annotation, warped by Allmaps);
`pipeline/scripts/capture_verniquet.cjs` saves screenshots of it at zoom
18.6 with their corner coordinates, and this step

1. finds the hatched areas in the screenshots (local darkness of the
   engraving, smoothed, thresholded, small marks such as lettering dropped);
2. keeps them inside each institution's 1836 parcel, and out of today's
   river (wards built over the water are left out: their dates are unknown);
3. dates each part from history (INSTITUTIONS) and writes
   web/public/data/3d/institutions-cite.geojson, which `model3d` uses in
   place of house lots for these parcels.

Footprints are those of about 1790, used until each demolition: the
layout changed little, but the buildings are not surveyed at 1836.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

from rpr import paths

CAPTURES = paths.REPO_ROOT / "pipeline" / "cache" / "verniquet"

# Vasserot parcel ids (ID_ALPAGE) -> institution. Years are sourced in the notes.
INSTITUTIONS: dict[str, dict[str, Any]] = {
    "hotel-dieu": {
        "name": "Hôtel-Dieu",
        "parcels": ["PA7492"],
        "height": 17.0,
        "style": 10,
        # The wards on the Cité came down in 1877-1878, once the new
        # Hôtel-Dieu north of the parvis opened; the annex on the left bank
        # stood until 1909 (its site became the square René-Viviani, 1928).
        "until": 1878,
        "until_left_bank": 1909,
        "note": "Hospital founded in the 7th century; wards on the Cité demolished 1877-1878, left-bank annex 1909",
    },
    "enfants-trouves": {
        "name": "Hospice des Enfants-Trouvés",
        "parcels": ["PA7490"],
        "height": 18.0,
        "style": 11,
        # Boffrand's foundling hospital on the parvis (1746-1748), later the
        # offices of the Administration des hospices; cleared with the old
        # parvis in the 1870s works.
        "until": 1877,
        "note": "Foundling hospital by Boffrand, 1746-1748; later the Administration des hospices; demolished in the 1870s",
    },
    "archeveche": {
        "name": "Palais de l'Archevêché",
        "parcels": ["PA7487", "PA7491"],
        "height": 18.0,
        "style": 12,
        # Sacked and burned by a mob on 13-14 February 1831, razed after the
        # law of 8 June 1837 ceded the site to the city (garden from 1844).
        "until": 1837,
        "ruin_from": 1831,
        "note": "Archbishop's palace (rebuilt 1697); sacked February 1831, razed after the law of June 1837",
    },
}

DARKNESS = 0.30  # mean darkness of the engraving above which an area counts as hatched
BLUR_PX = 11
MIN_AREA_PX = 600  # about 10 m² at zoom 18.6: drops lettering and stray marks


def trace_captures(cache: Path = CAPTURES):
    """Hatched areas of the atlas screenshots, as one geometry in lon/lat."""
    import cv2
    import numpy as np
    from shapely.geometry import Polygon
    from shapely.ops import unary_union

    meta = json.loads((cache / "captures.json").read_text())
    parts = []
    for name, c in meta.items():
        img = cv2.imread(str(cache / name))
        if img is None:
            continue
        img = img[: c["map_h"]]  # below the map: the hidden timeline
        g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
        paper = float(np.percentile(g, 90))
        dark = np.clip((paper - g) / paper, 0, 1)
        mask = (cv2.blur(dark, (BLUR_PX, BLUR_PX)) > DARKNESS).astype(np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        n, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
        keep = np.zeros_like(mask)
        for i in range(1, n):
            if stats[i, cv2.CC_STAT_AREA] > MIN_AREA_PX:
                keep[labels == i] = 1
        contours, hierarchy = cv2.findContours(keep, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if hierarchy is None:
            continue
        fx = (c["lon1"] - c["lon0"]) / c["w"]
        fy = (c["lat1"] - c["lat0"]) / c["h"]

        def lonlat(pts):
            return [(c["lon0"] + x * fx, c["lat0"] + y * fy) for x, y in pts]

        for i, cnt in enumerate(contours):
            if hierarchy[0][i][3] != -1:
                continue
            outer = cv2.approxPolyDP(cnt, 1.5, True)[:, 0, :]
            if len(outer) < 3:
                continue
            holes = [cv2.approxPolyDP(contours[j], 1.5, True)[:, 0, :] for j in range(len(contours)) if hierarchy[0][j][3] == i]
            poly = Polygon(lonlat(outer), [lonlat(h) for h in holes if len(h) >= 3]).buffer(0)
            if not poly.is_empty:
                parts.append(poly)
    return unary_union(parts) if parts else None


def load_parcels(ids: set[str]):
    """Vasserot parcels by ID_ALPAGE, in lon/lat."""
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import shape
    from shapely.ops import transform

    from rpr.sources.model3d import VASSEROT_EPSG, VASSEROT_STEM

    reader = shapefile.Reader(str(paths.REPO_ROOT / "pipeline" / "cache" / "vasserot" / f"{VASSEROT_STEM}.shp"), encoding="latin-1")
    fields = [f[0] for f in reader.fields[1:]]
    to_wgs = Transformer.from_crs(VASSEROT_EPSG, 4326, always_xy=True).transform
    out = {}
    for sr in reader.iterShapeRecords():
        rec = dict(zip(fields, sr.record))
        if rec.get("ID_ALPAGE") in ids and sr.shape.points:
            g = transform(to_wgs, shape(sr.shape.__geo_interface__))
            out[rec["ID_ALPAGE"]] = g if g.is_valid else g.buffer(0)
    return out


def build(area: str = "cite", log: Callable[[str], Any] = print) -> dict:
    from pyproj import Transformer
    from shapely.geometry import Point, mapping, shape
    from shapely.ops import transform, unary_union

    hatched = trace_captures()
    if hatched is None:
        raise SystemExit(f"No atlas screenshots in {CAPTURES}: run pipeline/scripts/capture_verniquet.cjs first")
    site = json.loads((paths.DATA_DIR / "3d" / f"site-{area}.geojson").read_text())
    water = unary_union([shape(f["geometry"]) for f in site["features"] if f["properties"]["kind"] == "water"])
    to_l93 = Transformer.from_crs(4326, 2154, always_xy=True).transform
    from_l93 = Transformer.from_crs(2154, 4326, always_xy=True).transform
    island = Point(2.3499, 48.8530)  # Notre-Dame: what is north of the river arm here is on the island

    ids = {p for cfg in INSTITUTIONS.values() for p in cfg["parcels"]}
    parcels = load_parcels(ids)
    features = []
    for key, cfg in INSTITUTIONS.items():
        parcel = unary_union([parcels[p] for p in cfg["parcels"] if p in parcels])
        if parcel.is_empty:
            log(f"institutions: no parcel for {key}")
            continue
        built = hatched.intersection(parcel.buffer(0.00002)).difference(water)
        # Clean in metres: an opening drops strips under 3 m wide (bits of the
        # neighbours' hatching along the parcel edge, garden walls), then
        # the engraving's ragged edges are smoothed.
        metric = transform(to_l93, built).buffer(-1.5).buffer(1.5).buffer(0.4).buffer(-0.4).simplify(0.4, preserve_topology=True)
        pieces = [p for p in getattr(metric, "geoms", [metric]) if p.geom_type == "Polygon" and p.area >= 25]
        for i, piece in enumerate(pieces):
            geom = transform(from_l93, piece)
            until = cfg["until"]
            side = "island"
            if "until_left_bank" in cfg and geom.centroid.y < island.y and not _same_bank(geom.centroid, island, water):
                until = cfg["until_left_bank"]
                side = "left bank"
            props = {
                "institution": key,
                "name": cfg["name"],
                "until": until,
                "height": cfg["height"],
                "style": cfg["style"],
                "side": side,
                "note": cfg["note"],
                "source": "Traced from Verniquet's atlas (about 1790), within the 1836 cadastre parcel",
                "id": f"institution:{key}:{i}",
            }
            if "ruin_from" in cfg:
                # Two phases: the palace, then its sacked shell.
                features.append({"type": "Feature", "properties": {**props, "until": cfg["ruin_from"]}, "geometry": mapping(geom)})
                features.append(
                    {
                        "type": "Feature",
                        "properties": {**props, "id": f"{props['id']}:ruin", "from": cfg["ruin_from"], "ruin": True},
                        "geometry": mapping(geom),
                    }
                )
            else:
                features.append({"type": "Feature", "properties": props, "geometry": mapping(geom)})
        log(f"institutions: {cfg['name']}: {len(pieces)} building(s), {round(sum(p.area for p in pieces))} m²")
    out = paths.DATA_DIR / "3d" / f"institutions-{area}.geojson"
    text = json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False, separators=(",", ":"))
    out.write_text(_round_coords(text))
    return {"area": area, "file": f"3d/institutions-{area}.geojson", "buildings": len(features)}


def _same_bank(p, q, water) -> bool:
    """True if the straight line between two points does not cross the river."""
    from shapely.geometry import LineString

    return not LineString([p, q]).crosses(water)


def _round_coords(text: str) -> str:
    import re

    return re.sub(r"(\d+\.\d{7})\d+", r"\1", text)

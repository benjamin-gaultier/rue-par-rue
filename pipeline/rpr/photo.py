"""The one photo schema every source is normalised into.

The web app reads `photos.geojson`, a merge of one GeoJSON file per source.
Properties stay flat because MapLibre stringifies nested objects.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from rpr import paths
from rpr.headings import HEADING_METHODS

# Generous box around Paris and the inner suburbs. Anything outside is a
# geocoding error for our purposes.
PARIS_BBOX = (2.15, 48.75, 2.55, 48.95)  # min lon, min lat, max lon, max lat
YEAR_RANGE = (1820, 2030)

# How a photo's position was obtained. Order matters: later is better.
POSE_METHODS = ("estimated", "geocoded", "recorded", "matched", "manual")


@dataclass
class Photo:
    source: str
    source_id: str
    title: str
    lon: float
    lat: float
    year: int | None = None
    year_end: int | None = None
    date_text: str | None = None
    creator: str | None = None
    thumb: str | None = None
    image: str | None = None
    iiif: str | None = None
    url: str | None = None
    license: str = "unknown"
    credit: str | None = None
    media: str = "photo"
    pose: str = "estimated"
    heading: float | None = None  # compass bearing the camera faced, degrees (see rpr.headings)
    heading_method: str | None = None  # how the heading was obtained: rpr.headings.HEADING_METHODS
    heading_confidence: float | None = None
    fov: float | None = None
    confidence: float = 0.0
    extra: dict = field(default_factory=dict)

    @property
    def id(self) -> str:
        return f"{self.source}:{self.source_id}"

    def problems(self) -> list[str]:
        """Return reasons this record can't be used. Empty means valid."""
        out = []
        if not self.title:
            out.append("missing title")
        if not (math.isfinite(self.lon) and math.isfinite(self.lat)):
            out.append("non-finite coordinates")
        else:
            min_lon, min_lat, max_lon, max_lat = PARIS_BBOX
            if not (min_lon <= self.lon <= max_lon and min_lat <= self.lat <= max_lat):
                out.append(f"outside Paris ({self.lon:.4f}, {self.lat:.4f})")
        if self.year is not None and not (YEAR_RANGE[0] <= self.year <= YEAR_RANGE[1]):
            out.append(f"implausible year {self.year}")
        if self.year is not None and self.year_end is not None and self.year_end < self.year:
            out.append("year_end before year")
        if self.pose not in POSE_METHODS:
            out.append(f"unknown pose method {self.pose!r}")
        if not 0.0 <= self.confidence <= 1.0:
            out.append("confidence outside 0..1")
        if self.heading is not None and not 0.0 <= self.heading < 360.0:
            out.append("heading outside 0..360")
        if self.heading is not None and self.heading_method not in HEADING_METHODS:
            out.append(f"unknown heading method {self.heading_method!r}")
        if self.heading is None and (self.heading_method or self.heading_confidence is not None):
            out.append("heading method without a heading")
        if not (self.thumb or self.image or self.iiif):
            out.append("no image")
        return out

    def to_feature(self) -> dict:
        props = asdict(self)
        props.pop("lon")
        props.pop("lat")
        extra = props.pop("extra")
        props = {k: v for k, v in props.items() if v is not None}
        props["id"] = self.id
        if extra:
            props["extra"] = json.dumps(extra, ensure_ascii=False)
        return {
            "type": "Feature",
            "id": self.id,
            "geometry": {"type": "Point", "coordinates": [round(self.lon, 6), round(self.lat, 6)]},
            "properties": props,
        }


@dataclass
class SourceInfo:
    key: str
    name: str
    license: str
    homepage: str
    attribution: str


def write_source(info: SourceInfo, photos: Iterable[Photo], out_dir: Path | None = None) -> dict:
    """Validate and write one source's photos. Returns a summary."""
    out_dir = out_dir or paths.PHOTOS_DIR
    out_dir.mkdir(parents=True, exist_ok=True)
    kept, rejected, seen = [], {}, set()
    for p in photos:
        issues = p.problems()
        if p.id in seen:
            issues.append("duplicate id")
        if issues:
            for reason in issues:
                key = reason.split(" (")[0]
                rejected[key] = rejected.get(key, 0) + 1
            continue
        seen.add(p.id)
        kept.append(p.to_feature())
    kept.sort(key=lambda f: f["id"])
    summary = {
        "key": info.key,
        "name": info.name,
        "license": info.license,
        "homepage": info.homepage,
        "attribution": info.attribution,
        "count": len(kept),
        "rejected": rejected,
        "harvested_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    collection = {"type": "FeatureCollection", "metadata": summary, "features": kept}
    (out_dir / f"{info.key}.geojson").write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")))
    return summary


def build_index(photos_dir: Path | None = None, data_dir: Path | None = None) -> dict:
    """Merge every per-source file into photos.geojson and write manifest.json."""
    photos_dir = photos_dir or paths.PHOTOS_DIR
    data_dir = data_dir or paths.DATA_DIR
    features, sources = [], []
    for f in sorted(photos_dir.glob("*.geojson")):
        coll = json.loads(f.read_text())
        features.extend(coll["features"])
        sources.append(coll.get("metadata", {"key": f.stem}))
    merged = {"type": "FeatureCollection", "features": features}
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "photos.geojson").write_text(json.dumps(merged, ensure_ascii=False, separators=(",", ":")))
    manifest_path = data_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest["photos"] = {"count": len(features), "sources": sources}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest

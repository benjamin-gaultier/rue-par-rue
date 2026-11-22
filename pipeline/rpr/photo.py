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

# How a full camera was solved: by a person clicking the same points in the
# photo and on the 3D model, or by matching the photo against posed pictures.
CAMERA_METHODS = ("matched", "manual")

# The years whose photos become walls (README roadmap, phase 5).
ERA_1920 = (1900, 1929)
ERA_MAX_SPAN = 3  # a date looser than this many years does not date a wall


@dataclass
class Camera:
    """Where the camera stood and how it looked: enough to lay the photo on a wall.

    Stricter than `Photo.heading`, which is a bearing alone and may be worked
    out from a street outline. A camera is solved, never estimated: a photo
    without one keeps `camera = None`. The angles describe the picture itself,
    so for a print scanned on its card, the print cut out of its mount.
    """

    lon: float
    lat: float
    height: float  # metres above the ground where the camera stood
    bearing: float  # compass bearing of the optical axis, degrees, 0 = north, clockwise
    pitch: float  # degrees above the horizon (negative: looking down)
    roll: float  # degrees the picture is turned clockwise about the optical axis
    hfov: float  # horizontal field of view of the whole picture, degrees
    method: str  # CAMERA_METHODS
    confidence: float  # 0..1
    # When solved from point pairs: the mean distance between a clicked point
    # and where the camera puts it, as a share of the picture's width (0.01 = 1%).
    reprojection_error: float | None = None
    points: int | None = None  # how many point pairs it was solved from

    def problems(self) -> list[str]:
        values = (self.lon, self.lat, self.height, self.bearing, self.pitch, self.roll, self.hfov, self.confidence)
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in values):
            return ["camera has a non-finite value"]
        out = []
        min_lon, min_lat, max_lon, max_lat = PARIS_BBOX
        if not (min_lon <= self.lon <= max_lon and min_lat <= self.lat <= max_lat):
            out.append("camera outside Paris")
        if not 0.0 <= self.height <= 350.0:  # the ground to above the Eiffel Tower
            out.append("camera height outside 0..350 m")
        if not 0.0 <= self.bearing < 360.0:
            out.append("camera bearing outside 0..360")
        if not -90.0 <= self.pitch <= 90.0:
            out.append("camera pitch outside -90..90")
        if not -180.0 <= self.roll <= 180.0:
            out.append("camera roll outside -180..180")
        if not 1.0 <= self.hfov <= 150.0:
            out.append("camera field of view outside 1..150")
        if self.method not in CAMERA_METHODS:
            out.append(f"unknown camera method {self.method!r}")
        if not 0.0 <= self.confidence <= 1.0:
            out.append("camera confidence outside 0..1")
        if self.reprojection_error is not None and not (math.isfinite(self.reprojection_error) and self.reprojection_error >= 0.0):
            out.append("camera reprojection error below 0")
        if self.points is not None and self.points < 4:
            out.append("camera solved from fewer than 4 points")
        return out

    def to_props(self) -> dict:
        """Flat `camera_*` properties (MapLibre stringifies nested objects)."""
        props = {f"camera_{k}": v for k, v in asdict(self).items() if v is not None}
        for key in ("camera_lon", "camera_lat"):
            props[key] = round(props[key], 7)
        return props


CAMERA_FIELDS = ("lon", "lat", "height", "bearing", "pitch", "roll", "hfov", "method", "confidence")


def camera_of(props: dict) -> Camera | None:
    """The camera written in a feature's properties, or None when it has none."""
    if any(f"camera_{k}" not in props for k in CAMERA_FIELDS):
        return None
    return Camera(
        **{k: props[f"camera_{k}"] for k in CAMERA_FIELDS},
        reprojection_error=props.get("camera_reprojection_error"),
        points=props.get("camera_points"),
    )


def in_era(props: dict, era: tuple[int, int] = ERA_1920, max_span: int = ERA_MAX_SPAN) -> bool:
    """Whether a photo is dated inside the era, to within `max_span` years."""
    year = props.get("year")
    if year is None:
        return False
    end = props.get("year_end") or year
    return era[0] <= year and end <= era[1] and end - year <= max_span


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
    camera: Camera | None = None  # the full camera, when it was solved (see Camera)
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
        if self.camera is not None:
            out.extend(self.camera.problems())
        return out

    def to_feature(self) -> dict:
        props = asdict(self)
        props.pop("lon")
        props.pop("lat")
        extra = props.pop("extra")
        props.pop("camera")
        props = {k: v for k, v in props.items() if v is not None}
        if self.camera is not None:
            props.update(self.camera.to_props())
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
    posed = [f["properties"] for f in features if camera_of(f["properties"]) is not None]
    manifest["photos"] = {
        "count": len(features),
        # Photos with a full camera (position, height, bearing, pitch, roll, field of view).
        "cameras": {"count": len(posed), "era_1900_1929": sum(1 for p in posed if in_era(p))},
        "sources": sources,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest

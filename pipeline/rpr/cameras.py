"""Cameras placed by hand: `pipeline/poses/manual.json`.

A person stands in the photo in the app's 3D view (the stand-in view), turns
and moves the camera until the 3D model lines up with the picture, and copies
the pose. The pose goes into the poses file with who placed it, when and how.
`rpr index` writes each one into `photos.geojson` as a `manual` camera
(Camera in rpr/photo.py).

The file is a source, edited by people: it is the only place a hand-placed
camera lives, and `photos.geojson` is rebuilt from it.

    {
      "about": "...",
      "poses": [
        {
          "id": "parismusees:320002496",
          "camera": {"lon": 2.34956, "lat": 48.85307, "height": 1.6, "bearing": 64.5,
                     "pitch": 0.0, "roll": 0.0, "hfov": 61.0, "shift": 0.22},
          "crop": [0.187, 0.217, 0.803, 0.664],
          "confidence": 0.5,
          "by": "who placed it",
          "date": "2026-11-27",
          "how": "what was lined up with what"
        }
      ]
    }

`crop` is the rectangle of the photo's `image` that is the picture itself
(shares of its width and height). `camera.shift`, optional, is the rising
front (Camera.shift): how far the lens was raised, as a share of the
picture's height. `points` and `reprojection_error` are given
only when the camera was solved from point pairs; a pose lined up by eye has
neither, and a confidence of 0.5 at most.
"""

from __future__ import annotations

import json
from pathlib import Path

from rpr.photo import Camera

BY_EYE_MAX_CONFIDENCE = 0.5
REQUIRED = ("id", "camera", "confidence", "by", "date", "how")
CAMERA_KEYS = ("lon", "lat", "height", "bearing", "pitch", "roll", "hfov")


def load_poses(path: Path) -> list[dict]:
    """The poses in the file, or none when there is no file."""
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))["poses"]


def camera_from_pose(pose: dict) -> Camera:
    """The `manual` camera a pose describes. Raises ValueError on a pose that cannot be used."""
    missing = [k for k in REQUIRED if k not in pose] + [f"camera.{k}" for k in CAMERA_KEYS if k not in pose.get("camera", {})]
    if missing:
        raise ValueError(f"{pose.get('id', '?')}: missing {', '.join(missing)}")
    points = pose.get("points")
    if points is None and pose["confidence"] > BY_EYE_MAX_CONFIDENCE:
        raise ValueError(f"{pose['id']}: a pose lined up by eye has a confidence of {BY_EYE_MAX_CONFIDENCE} at most")
    crop = pose.get("crop")
    camera = Camera(
        **{k: float(pose["camera"][k]) for k in CAMERA_KEYS},
        method="manual",
        confidence=float(pose["confidence"]),
        reprojection_error=pose.get("reprojection_error"),
        points=points,
        crop=tuple(float(v) for v in crop) if crop is not None else None,
        shift=float(pose["camera"].get("shift", 0.0)),
    )
    problems = camera.problems()
    if problems:
        raise ValueError(f"{pose['id']}: {'; '.join(problems)}")
    return camera


def apply_poses(features: list[dict], poses: list[dict]) -> dict:
    """Write each pose's camera into its photo's properties.

    Raises ValueError on a pose that cannot be used or a photo posed twice.
    Poses of photos not in `features` are counted in `missing` (a source may
    have dropped the photo since); the index says so.
    """
    by_id = {f["properties"]["id"]: f for f in features}
    seen: set[str] = set()
    applied, missing = 0, []
    for pose in poses:
        camera = camera_from_pose(pose)
        if pose["id"] in seen:
            raise ValueError(f"{pose['id']}: posed twice")
        seen.add(pose["id"])
        feature = by_id.get(pose["id"])
        if feature is None:
            missing.append(pose["id"])
            continue
        props = feature["properties"]
        for key in [k for k in props if k.startswith("camera_")]:
            del props[key]
        props.update(camera.to_props())
        applied += 1
    return {"applied": applied, "missing": missing}

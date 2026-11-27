import json

import pytest

from rpr.cameras import apply_poses, camera_from_pose, load_poses
from rpr.paths import POSES_FILE
from rpr.photo import Photo, SourceInfo, build_index, camera_of, write_source

INFO = SourceInfo(key="test", name="Test", license="CC0-1.0", homepage="https://example.org", attribution="Test")


def pose(**kw):
    base = {
        "id": "test:1",
        "camera": {"lon": 2.3497, "lat": 48.8531, "height": 1.6, "bearing": 64.5, "pitch": 1.5, "roll": -0.5, "hfov": 61.0},
        "crop": [0.187, 0.217, 0.803, 0.664],
        "confidence": 0.5,
        "by": "A volunteer",
        "date": "2026-11-27",
        "how": "The north portal and the corner of the houses opposite",
    }
    base.update(kw)
    return base


def feature(source_id="1", **props):
    p = Photo(source="test", source_id=source_id, title="Parvis", lon=2.3497, lat=48.8531, year=1865, thumb="https://example.org/t.jpg", **props)
    return p.to_feature()


def test_a_pose_becomes_a_manual_camera():
    camera = camera_from_pose(pose())
    assert camera.method == "manual" and camera.points is None and camera.reprojection_error is None
    assert camera.bearing == 64.5 and camera.crop == (0.187, 0.217, 0.803, 0.664)


def test_a_pose_by_eye_is_not_sure():
    with pytest.raises(ValueError, match="by eye"):
        camera_from_pose(pose(confidence=0.9))
    # Solved from point pairs, it may be surer.
    assert camera_from_pose(pose(confidence=0.9, points=6, reprojection_error=0.01)).confidence == 0.9


def test_a_pose_must_say_who_placed_it_and_how():
    p = pose()
    del p["by"], p["how"]
    with pytest.raises(ValueError, match="missing by, how"):
        camera_from_pose(p)


def test_a_bad_camera_is_refused():
    p = pose()
    p["camera"]["bearing"] = 400.0
    with pytest.raises(ValueError, match="bearing outside"):
        camera_from_pose(p)


def test_poses_are_written_into_their_photos():
    features = [feature("1"), feature("2")]
    summary = apply_poses(features, [pose(), pose(id="test:9")])
    assert summary == {"applied": 1, "missing": ["test:9"]}
    assert camera_of(features[0]["properties"]).hfov == 61.0
    assert camera_of(features[1]["properties"]) is None


def test_a_rising_front_travels_with_the_camera():
    p = pose()
    p["camera"]["shift"] = 0.22
    features = [feature("1")]
    apply_poses(features, [p])
    assert features[0]["properties"]["camera_shift"] == 0.22
    assert camera_of(features[0]["properties"]).shift == 0.22
    # A camera without one writes nothing.
    assert "camera_shift" not in camera_from_pose(pose()).to_props()
    p["camera"]["shift"] = 0.7
    with pytest.raises(ValueError, match="shift outside"):
        camera_from_pose(p)


def test_a_photo_cannot_be_posed_twice():
    with pytest.raises(ValueError, match="posed twice"):
        apply_poses([feature("1")], [pose(), pose()])


def test_the_index_adds_the_poses(tmp_path):
    photos_dir, data_dir = tmp_path / "photos", tmp_path
    write_source(INFO, [Photo(source="test", source_id=s, title="Parvis", lon=2.3497, lat=48.8531, thumb="https://example.org/t.jpg") for s in "12"], out_dir=photos_dir)
    poses_file = tmp_path / "manual.json"
    poses_file.write_text(json.dumps({"about": "test", "poses": [pose()]}), encoding="utf-8")
    manifest = build_index(photos_dir=photos_dir, data_dir=data_dir, poses_file=poses_file)
    assert manifest["photos"]["cameras"] == {"count": 1, "era_1900_1929": 0, "placed_by_hand": 1}
    merged = json.loads((data_dir / "photos.geojson").read_text(encoding="utf-8"))
    assert merged["features"][0]["properties"]["camera_method"] == "manual"


def test_the_poses_file_in_the_repository_is_valid():
    for p in load_poses(POSES_FILE):
        camera_from_pose(p)

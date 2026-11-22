from rpr.photo import Camera, Photo, SourceInfo, build_index, camera_of, in_era, write_source

INFO = SourceInfo(key="test", name="Test", license="CC0-1.0", homepage="https://example.org", attribution="Test")


def make(**kw):
    base = dict(source="test", source_id="1", title="Quai aux Fleurs", lon=2.3466, lat=48.8524, year=1912, thumb="https://example.org/t.jpg", pose="recorded", confidence=0.8)
    base.update(kw)
    return Photo(**base)


def camera(**kw):
    base = dict(lon=2.3466, lat=48.8524, height=1.5, bearing=40.0, pitch=8.0, roll=-1.0, hfov=52.0, method="manual", confidence=0.9, reprojection_error=0.012, points=6)
    base.update(kw)
    return Camera(**base)


def test_camera_is_written_flat_and_read_back():
    props = make(camera=camera()).to_feature()["properties"]
    assert props["camera_bearing"] == 40.0 and props["camera_method"] == "manual"
    assert "camera" not in props
    assert all(not isinstance(v, (dict, list)) for v in props.values())
    assert camera_of(props) == camera()


def test_camera_without_point_pairs_drops_the_error():
    props = make(camera=camera(method="matched", reprojection_error=None, points=None)).to_feature()["properties"]
    assert "camera_reprojection_error" not in props and "camera_points" not in props
    assert camera_of(props).reprojection_error is None


def test_photo_without_a_camera_has_no_camera_properties():
    props = make(heading=40.0, heading_method="recorded", heading_confidence=0.9, fov=50.0).to_feature()["properties"]
    assert not any(k.startswith("camera_") for k in props)
    assert camera_of(props) is None  # a heading alone is not a camera


def test_camera_problems_reject_the_photo():
    assert make(camera=camera()).problems() == []
    assert make(camera=camera(bearing=360.0)).problems() == ["camera bearing outside 0..360"]
    assert make(camera=camera(pitch=120.0)).problems() == ["camera pitch outside -90..90"]
    assert make(camera=camera(hfov=0.0)).problems() == ["camera field of view outside 1..150"]
    assert make(camera=camera(method="facade")).problems() == ["unknown camera method 'facade'"]
    assert make(camera=camera(points=3)).problems() == ["camera solved from fewer than 4 points"]
    assert make(camera=camera(lon=5.0)).problems() == ["camera outside Paris"]
    assert make(camera=camera(height=float("nan"))).problems() == ["camera has a non-finite value"]


def test_era_takes_photos_dated_within_three_years():
    assert in_era({"year": 1912})
    assert in_era({"year": 1926, "year_end": 1929})
    assert not in_era({"year": 1899, "year_end": 1901})
    assert not in_era({"year": 1900, "year_end": 1910})  # too loose to date a wall
    assert not in_era({"year": 1930})
    assert not in_era({})


def test_index_counts_full_cameras(tmp_path):
    photos_dir, data_dir = tmp_path / "photos", tmp_path
    photos = [make(), make(source_id="2", camera=camera()), make(source_id="3", year=1865, camera=camera(method="matched"))]
    write_source(INFO, photos, out_dir=photos_dir)
    manifest = build_index(photos_dir=photos_dir, data_dir=data_dir)
    assert manifest["photos"]["count"] == 3
    assert manifest["photos"]["cameras"] == {"count": 2, "era_1900_1929": 1}

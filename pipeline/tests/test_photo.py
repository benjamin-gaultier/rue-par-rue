import json

from rpr.photo import Photo, SourceInfo, build_index, write_source

INFO = SourceInfo(key="test", name="Test", license="CC0-1.0", homepage="https://example.org", attribution="Test")


def make(**kw):
    base = dict(source="test", source_id="1", title="Rue de la Parcheminerie", lon=2.3466, lat=48.8524, year=1912, thumb="https://example.org/t.jpg", pose="recorded", confidence=0.8)
    base.update(kw)
    return Photo(**base)


def test_valid_photo_has_no_problems():
    assert make().problems() == []


def test_problems_are_reported():
    assert "outside Paris" in make(lon=5.0).problems()[0]
    assert make(year=1700).problems() == ["implausible year 1700"]
    assert make(thumb=None).problems() == ["no image"]
    assert make(heading=400, heading_method="recorded").problems() == ["heading outside 0..360"]
    assert make(pose="guess").problems() == ["unknown pose method 'guess'"]


def test_feature_is_flat_and_drops_nulls():
    f = make(extra={"cote": "A 1"}).to_feature()
    assert f["id"] == "test:1"
    assert f["geometry"]["coordinates"] == [2.3466, 48.8524]
    props = f["properties"]
    assert "heading" not in props
    assert all(not isinstance(v, (dict, list)) for v in props.values())
    assert json.loads(props["extra"]) == {"cote": "A 1"}


def test_write_and_index(tmp_path):
    photos_dir, data_dir = tmp_path / "photos", tmp_path
    summary = write_source(INFO, [make(), make(), make(source_id="2", lon=9.0)], out_dir=photos_dir)
    assert summary["count"] == 1
    assert summary["rejected"] == {"duplicate id": 1, "outside Paris": 1}
    manifest = build_index(photos_dir=photos_dir, data_dir=data_dir)
    assert manifest["photos"]["count"] == 1
    merged = json.loads((data_dir / "photos.geojson").read_text())
    assert merged["features"][0]["id"] == "test:1"

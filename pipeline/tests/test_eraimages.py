import io
import json

import pytest

from rpr.sources import eraimages, kahn

BASE = "https://www.parismuseescollections.paris.fr/sites/default/files/styles/pm_diaporama_zoom/public/atoms/images/CAR/"
IIIF = "https://apicollections.parismusees.paris.fr/sites/default/files/styles/4k/collections/atoms/images/CAR/"


def feature(pid, lon=2.347, lat=48.855, **props):
    source, source_id = pid.split(":")
    base = {"id": pid, "source": source, "source_id": source_id, "title": "Quai aux Fleurs", "year": 1912, "license": "CC0-1.0", "image": BASE + "front_001.jpg"}
    base.update(props)
    return {"geometry": {"coordinates": [lon, lat]}, "properties": base}


def manifest(*names):
    return {"sequences": [{"canvases": [{"images": [{"resource": {"@id": IIIF + n + "?itok=abc"}}]} for n in names]}]}


def test_selection_keeps_cleared_photos_of_the_era_in_the_area():
    photos = [
        feature("parismusees:1"),
        feature("kahn:A 1", license=kahn.LICENSE_CC_BY),
        feature("kahn:A 2", license=kahn.LICENSE_NOT_CLEARED),
        feature("kahn:A 3"),  # a Kahn photo must carry a Kahn licence that allows it
        feature("parismusees:2", year=1865),
        feature("parismusees:3", year=1900, year_end=1920),
        feature("parismusees:4", lon=2.30),
        feature("parismusees:5", license="unknown"),
    ]
    chosen, not_cleared = eraimages.selected(photos, "cite")
    assert [f["properties"]["id"] for f in chosen] == ["parismusees:1", "kahn:A 1"]
    assert not_cleared == 3


def test_manifest_image_is_matched_by_file_name_never_by_order():
    m = manifest("back_002.jpg", "FRONT_001.jpg")
    assert eraimages.manifest_image(m, BASE + "front_001.jpg") == IIIF + "FRONT_001.jpg?itok=abc"
    assert eraimages.manifest_image(manifest("back_002.jpg"), BASE + "front_001.jpg") is None
    assert eraimages.manifest_image({}, BASE + "front_001.jpg") is None


def test_fetch_prefers_the_manifest_image_and_falls_back(monkeypatch):
    p = feature("parismusees:1")["properties"]
    monkeypatch.setattr(eraimages.net, "fetch_json", lambda url, **kw: manifest("front_001.jpg"))
    monkeypatch.setattr(eraimages.net, "fetch_bytes", lambda url, **kw: url.encode())
    raw, url, kind = eraimages.fetch(p, sleep=lambda s: None)
    assert (url, kind) == (IIIF + "front_001.jpg?itok=abc", "iiif manifest image")

    def no_manifest(url, **kw):
        raise OSError("404")

    monkeypatch.setattr(eraimages.net, "fetch_json", no_manifest)
    raw, url, kind = eraimages.fetch(p, sleep=lambda s: None)
    assert (url, kind) == (p["image"], "work page image")

    k = feature("kahn:A 1", license=kahn.LICENSE_CC_BY, image="https://example.org/files/abc")["properties"]
    assert eraimages.fetch(k)[1:] == ("https://example.org/files/abc", "open data file")


def test_build_saves_images_with_their_licence_and_drops_stale_ones(tmp_path, monkeypatch):
    Image = pytest.importorskip("PIL.Image")
    pytest.importorskip("cv2")
    data = tmp_path / "data"
    data.mkdir()
    photos = [
        feature("kahn:A 1", license=kahn.LICENSE_CC_BY, credit="Musée Albert-Kahn", image="https://example.org/files/abc"),
        feature("kahn:A 2", license=kahn.LICENSE_NOT_CLEARED, image="https://example.org/files/never"),
    ]
    (data / "photos.geojson").write_text(json.dumps({"features": photos}), encoding="utf-8")
    monkeypatch.setattr(eraimages.paths, "DATA_DIR", data)
    monkeypatch.setattr(eraimages.time, "sleep", lambda s: None)
    out = io.BytesIO()
    Image.new("RGB", (800, 600), (120, 110, 100)).save(out, "JPEG")
    served = out.getvalue()
    asked = []

    def fetch_bytes(url, **kw):
        asked.append(url)
        return served

    monkeypatch.setattr(eraimages.net, "fetch_bytes", fetch_bytes)
    cache = tmp_path / "cache"
    (cache / "images").mkdir(parents=True)
    (cache / "images" / "kahn-gone.jpg").write_bytes(b"x")
    (cache / "index.json").write_text(json.dumps({"kahn:gone": {"file": "kahn-gone.jpg"}}), encoding="utf-8")

    summary = eraimages.build("cite", log=lambda m: None, cache=cache)

    assert asked == ["https://example.org/files/abc"]  # the photo not cleared is never downloaded
    assert (cache / "images" / "kahn-A_1.jpg").read_bytes() == served  # saved as served
    assert not (cache / "images" / "kahn-gone.jpg").exists()
    index = json.loads((cache / "index.json").read_text(encoding="utf-8"))
    assert list(index) == ["kahn:A 1"]
    assert index["kahn:A 1"]["license"] == kahn.LICENSE_CC_BY and index["kahn:A 1"]["credit"] == "Musée Albert-Kahn"
    assert (index["kahn:A 1"]["width"], index["kahn:A 1"]["height"]) == (800, 600)
    assert summary["count"] == 1 and summary["not_cleared"] == 1 and summary["by_source"] == {"kahn": 1}

    asked.clear()
    eraimages.build("cite", log=lambda m: None, cache=cache)
    assert asked == []  # already on disk

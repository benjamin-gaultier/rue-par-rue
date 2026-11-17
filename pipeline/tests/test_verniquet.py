import json
from pathlib import Path

import pytest

from rpr.sources import verniquet

FIXTURE = Path(__file__).parent / "fixtures" / "verniquet_sheet01_rumsey.json"
# Real values from the sheet's info.json (David Rumsey, IIIF Image API 2).
INFO = {
    "@context": "http://iiif.io/api/image/2/context.json",
    "@id": "https://www.davidrumsey.com/luna/servlet/iiif/RUMSEY~8~1~305628~90076037",
    "width": 17506,
    "height": 12566,
    "profile": ["http://iiif.io/api/image/2/level2.json", {"formats": ["jpg"]}],
}


def load_page():
    return json.loads(FIXTURE.read_text())


def test_service_type_detection():
    assert verniquet.service_type(INFO) == "ImageService2"
    assert verniquet.service_type({"type": "ImageService3"}) == "ImageService3"
    assert verniquet.service_type({"@context": "http://library.stanford.edu/iiif/image-api/1.1/context.json"}) == "ImageService1"


def test_service_id_strips_image_request():
    target = {"source": "https://example.org/iiif/abc/full/max/0/default.jpg"}
    assert verniquet.service_id(target) == "https://example.org/iiif/abc"


def test_convert_uses_real_image_size_and_current_format():
    page = load_page()
    out = verniquet.convert_page(page, lambda sid: INFO)
    ann = out["items"][0]
    source = ann["target"]["source"]
    assert source == {
        "id": INFO["@id"],
        "type": "ImageService2",
        "width": 17506,
        "height": 12566,
    }
    assert ann["target"]["selector"]["value"].startswith('<svg width="17506" height="12566">')
    features = ann["body"]["features"]
    assert len(features) == len(page["items"][0]["body"]["features"])
    assert all("resourceCoords" in f["properties"] for f in features)
    assert ann["body"]["transformation"] == {"type": "polynomial", "options": {"order": 2}}


def test_mask_outside_image_is_rejected():
    page = load_page()
    too_small = {**INFO, "width": 10478, "height": 10547}  # the bbox the old SVG recorded
    with pytest.raises(ValueError, match="outside image"):
        verniquet.convert_page(page, lambda sid: too_small)

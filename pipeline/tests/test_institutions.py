import json

import pytest

from rpr.sources import institutions


def test_institutions_have_dates_parcels_and_reasons():
    for key, cfg in institutions.INSTITUTIONS.items():
        assert cfg["parcels"] and cfg["note"] and 1780 < cfg["until"] < 1950
        assert 10 <= cfg["style"] < 20
    palace = institutions.INSTITUTIONS["archeveche"]
    assert palace["ruin_from"] == 1831 and palace["until"] == 1837
    assert institutions.INSTITUTIONS["hotel-dieu"]["until_left_bank"] == 1909


def test_coordinates_are_rounded_to_about_a_centimetre():
    assert institutions._round_coords('[2.123456789,48.987654321]') == "[2.1234567,48.9876543]"


def test_hatched_areas_are_traced_from_a_screenshot(tmp_path):
    cv2 = pytest.importorskip("cv2")
    np = pytest.importorskip("numpy")
    pytest.importorskip("shapely")
    img = np.full((400, 400, 3), 235, np.uint8)
    # A hatched block 200 x 100 px: dark diagonal lines on paper.
    for k in range(-400, 400, 6):
        cv2.line(img, (100 + k, 100), (100 + k + 100, 200), (60, 55, 50), 3)
    img[:100, :] = 235
    img[200:, :] = 235
    img[:, :100] = 235
    img[:, 300:] = 235
    cv2.putText(img, "Rue", (120, 300), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (40, 40, 40), 1)  # fine lettering is dropped
    cv2.imwrite(str(tmp_path / "a.png"), img)
    (tmp_path / "captures.json").write_text(
        json.dumps({"a.png": {"lon0": 0.0, "lat0": 0.0004, "lon1": 0.0004, "lat1": 0.0, "w": 400, "h": 400, "map_h": 400}})
    )
    g = institutions.trace_captures(tmp_path)
    assert g is not None
    x0, y0, x1, y1 = g.bounds
    # 200 x 100 px out of 400 px = 0.0004 degrees.
    assert abs((x1 - x0) - 0.0002) < 0.00002 and abs((y1 - y0) - 0.0001) < 0.00002

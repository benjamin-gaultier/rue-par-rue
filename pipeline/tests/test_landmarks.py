import math

import pytest

from rpr.sources import landmarks

geometry = pytest.importorskip("shapely.geometry")


def test_local_frame_round_trips_to_the_centimetre():
    local = landmarks.Local(2.348, 48.855)
    x, y = local.xy(2.3501, 48.8562)
    lon, lat = local.lonlat(x, y)
    assert lon == pytest.approx(2.3501, abs=1e-7) and lat == pytest.approx(48.8562, abs=1e-7)
    assert 150 < x < 160 and 130 < y < 135  # about 154 m east, 133 m north


def test_rectangles_follow_their_bearing():
    ring = landmarks.rectangle((0.0, 0.0), 90.0, 10.0, 4.0)  # long side east-west
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    assert max(xs) - min(xs) == pytest.approx(10) and max(ys) - min(ys) == pytest.approx(4)
    assert geometry.Polygon(ring).exterior.is_ccw


def test_oriented_box_of_a_turned_chapel():
    ring = landmarks.rectangle((5.0, -3.0), 118.0, 41.6, 17.6)
    o = landmarks.oriented(geometry.Polygon(ring))
    assert o["length"] == pytest.approx(41.6, abs=0.01) and o["width"] == pytest.approx(17.6, abs=0.01)
    assert o["bearing"] == pytest.approx(118.0, abs=0.01)
    assert o["centre"][0] == pytest.approx(5.0) and o["centre"][1] == pytest.approx(-3.0)


def test_buildings_belong_to_the_facility_they_mostly_lie_in():
    outline = geometry.box(0, 0, 10, 10)
    assert landmarks.share_inside(geometry.box(2, 2, 4, 4), outline) == 1
    assert landmarks.share_inside(geometry.box(8, 0, 12, 10), outline) == pytest.approx(0.5)
    assert landmarks.share_inside(geometry.Polygon(), outline) == 0


def test_towers_are_named_from_east_to_west():
    pts = [("a", 10.0, 0.0), ("b", 30.0, 1.0), ("c", -5.0, 2.0)]
    assert landmarks.east_to_west(pts) == ["b", "a", "c"]


def test_radius_from_area():
    assert landmarks.regular_radius(math.pi * 4, 0) == pytest.approx(2)
    octagon = geometry.Polygon([(math.sin(k * math.pi / 4) * 8, math.cos(k * math.pi / 4) * 8) for k in range(8)])
    assert landmarks.regular_radius(octagon.area, 8) == pytest.approx(8)


def test_grid_points_stay_inside_with_a_margin():
    poly = geometry.box(0, 0, 20, 10)
    pts = landmarks.grid_points(poly, 4.0, margin=1.0)
    assert len(pts) == 8  # x = 3, 7, 11, 15 and y = 3, 7 inside the 18 x 8 inner box
    assert all(1 <= x <= 19 and 1 <= y <= 9 for x, y in pts)
    assert landmarks.grid_points(geometry.box(0, 0, 1, 1), 4.0, margin=1.0) == []


def test_stalls_give_way_to_buildings():
    p = geometry.Point(1, 1)
    plot = geometry.box(0, 0, 2, 2)
    assert landmarks.free_years(p, (1809, 1873), []) == (1809, 1873)
    # Built on in 1865: the stall goes then.
    assert landmarks.free_years(p, (1809, 1873), [(plot, 1865, 1e4)]) == (1809, 1865)
    # A house pulled down in 1860: the stall comes after.
    assert landmarks.free_years(p, (1809, 1873), [(plot, -1e4, 1860)]) == (1860, 1873)
    # Covered all along: no stall.
    assert landmarks.free_years(p, (1809, 1873), [(plot, -1e4, 1e4)]) is None
    # A building elsewhere changes nothing.
    assert landmarks.free_years(p, (1809, 1873), [(geometry.box(5, 5, 6, 6), 1820, 1e4)]) == (1809, 1873)


def _cathedral():
    """A cathedral pointing east: a 12 m nave with a transept and a round apse, aisles of 12 m."""
    from shapely.ops import unary_union

    nave = unary_union([geometry.box(0, -6, 90, 6), geometry.box(40, -22, 54, 22), geometry.Point(90, 0).buffer(6)])
    north = geometry.box(0, 6, 40, 18)
    south = geometry.box(0, -18, 40, -6)
    choir_n = geometry.box(54, 6, 90, 18)
    choir_s = geometry.box(54, -18, 90, -6)
    ambulatory = geometry.Point(90, 0).buffer(18).difference(geometry.box(0, -30, 90, 30))
    return nave, [north, south, choir_n, choir_s, ambulatory]


def test_flying_buttresses_span_the_aisles_and_skip_the_crossing():
    nave, aisles = _cathedral()
    fl = landmarks.flying_buttresses(nave, aisles, 90.0)
    assert fl, "expected flyers"
    straight = [f for f in fl if not f["apse"]]
    radiating = [f for f in fl if f["apse"]]
    assert len(radiating) == 5
    for f in straight:
        (fx, fy), (hx, hy) = f["foot"], f["head"]
        assert abs(hy) == pytest.approx(6, abs=0.1) and abs(fy) == pytest.approx(18, abs=0.1)
        assert fx == pytest.approx(hx, abs=0.01)
        assert not 38 < fx < 56  # nothing across the transept
    sides = {round(math.copysign(1, f["foot"][1])) for f in straight}
    assert sides == {1, -1}
    for f in radiating:
        assert math.dist(f["foot"], (90, 0)) == pytest.approx(18, abs=0.5)
        assert math.dist(f["head"], (90, 0)) == pytest.approx(6, abs=0.5)


def test_landmark_buildings_get_styles_and_dates():
    local = landmarks.Local(0, 0)
    palais = geometry.box(0, 0, 100, 100)
    tribunal = geometry.box(200, 0, 260, 60)
    model = [
        {"id": landmarks.PALAIS_IDS["harlay"], "kind": "later", "from": 1900, "geometry": geometry.box(0, 0, 20, 80)},
        {"id": "apur:1", "kind": "later", "from": 1900, "geometry": geometry.box(30, 0, 60, 30)},
        {"id": "apur:2", "kind": "standing", "from": 1700, "geometry": geometry.box(30, 40, 60, 60)},
        {"id": "apur:3", "kind": "later", "from": 1860, "geometry": geometry.box(205, 5, 250, 50)},
        {"id": "apur:4", "kind": "later", "from": 1900, "geometry": geometry.box(500, 500, 510, 510)},
        {"id": "vasserot:PA1", "kind": "reconstructed", "from": None, "geometry": geometry.box(10, 10, 20, 20)},
    ]
    out = {b["id"]: b for b in landmarks.assign_buildings(model, {"palais": [palais], "tribunal": [tribunal]}, local)}
    harlay = out[landmarks.PALAIS_IDS["harlay"]]
    assert harlay["style"] == landmarks.STYLE["harlay"] and harlay["from"] == landmarks.HARLAY_FROM and harlay["replaces"]
    assert out["apur:1"]["style"] == landmarks.STYLE["palais"] and out["apur:1"]["replaces"] and "from" not in out["apur:1"]
    assert out["apur:2"]["style"] == landmarks.STYLE["palais"] and "replaces" not in out["apur:2"]
    assert out["apur:3"]["from"] == landmarks.TRIBUNAL_FROM
    assert "apur:4" not in out and "vasserot:PA1" not in out


def test_styles_are_distinct_and_dates_are_ordered():
    assert len(set(landmarks.STYLE.values())) == len(landmarks.STYLE)
    assert min(landmarks.STYLE.values()) >= 20
    fm = landmarks.FLOWER_MARKET
    assert fm["open"] < fm["pavilions"] < fm["metro"] < fm["today"]
    for m in landmarks.MORGUES:
        assert m["from"] < m["until"]
    assert landmarks.MORGUES[0]["until"] == landmarks.MORGUES[1]["from"]
    assert landmarks.SAINTE_CHAPELLE["old_spire_until"] < landmarks.SAINTE_CHAPELLE["new_spire_from"]
    assert landmarks.STATUES[0]["until"] < landmarks.STATUES[1]["from"]
    assert landmarks.DAUPHINE_EAST_SIDE[0] == "PA3411" and landmarks.DAUPHINE_EAST_SIDE[-1] == "PA3427"

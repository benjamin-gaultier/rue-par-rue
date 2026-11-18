import math

import pytest

from rpr.sources import streets


def test_coordinates_round_trip_through_the_compact_encoding():
    origin = (2.3395, 48.8505)
    pts = [(2.3401234, 48.8512345), (2.3402, 48.8512), (2.34015, 48.85131)]
    enc = streets.encode(pts, origin)
    assert all(isinstance(v, int) for v in enc)
    for (a, b), (c, d) in zip(streets.decode(enc, origin), pts):
        assert a == pytest.approx(c, abs=1e-7) and b == pytest.approx(d, abs=1e-7)


def test_items_are_grouped_by_type_and_life_with_delta_positions():
    items = [
        [10, 100, 200, 0, 1872, 10000, 0.0],
        [2, 50, 60, 90, 1860, 10000, 4.2],
        [10, 300, 220, 0, 1872, 10000, 0.0],
    ]
    groups = streets.group_items(items)
    assert [g[:3] for g in groups] == [[2, 1860, 10000], [10, 1872, 10000]]
    lamp, fountains = groups
    assert lamp[4] == [90] and lamp[5] == [4.2]
    assert fountains[4] == [] and fountains[5] == []  # all zero: left out
    xy = fountains[3]
    pts, x, y = [], 0, 0
    for i in range(0, len(xy), 2):
        x, y = x + xy[i], y + xy[i + 1]
        pts.append((x, y))
    assert sorted(pts) == [(100, 200), (300, 220)]


def test_today_lamps_are_told_apart():
    assert streets.lamp_style("FONTES DE PARIS-R2 RIVOLI PORT+bloc LED") == "style"
    assert streets.lamp_style("LANT SUP PONT-NEUF (PARAPET) AI/SOHP 150W RX7S") == "style"
    assert streets.lamp_style("COMATELEC-CITEA NG MIDI") == "functional"
    assert streets.lamp_style(None) == "functional"


def test_bridge_pavements_wait_for_the_present_bridge():
    assert streets.bridge_year("PONT SAINT-MICHEL") == 1857
    assert streets.bridge_year("PETIT PONT CARDINAL LUSTIGER") == 1853
    assert streets.bridge_year("Pont d’Arcole") == 1856
    assert streets.bridge_year("PONT INCONNU") == streets.UNKNOWN_BRIDGE_YEAR


def test_dedupe_keeps_points_apart():
    pts = [(0, 0), (0.1, 0), (2, 0), (2.3, 0.1), (5, 5)]
    assert streets.dedupe(pts, 0.5) == [0, 2, 4]


def test_points_along_a_line_are_evenly_spaced():
    pts = streets.along([(0, 0), (10, 0), (10, 10)], 4.0)
    assert [round(p[0], 6) for p in pts[:3]] == [2, 6, 10]
    assert pts[2][1] == pytest.approx(0) and pts[3][1] == pytest.approx(4)
    assert pts[0][2] == pytest.approx(0) and pts[3][2] == pytest.approx(math.pi / 2)


def test_corner_angle_is_positive_to_the_left():
    assert streets.corner_angle((0, 0), (1, 0), (1, 1)) == pytest.approx(90)
    assert streets.corner_angle((0, 0), (1, 0), (1, -1)) == pytest.approx(-90)
    assert streets.corner_angle((0, 0), (1, 0), (2, 0)) == pytest.approx(0)


def test_chaikin_smooths_but_keeps_the_ends():
    out = streets.chaikin([(0, 0), (10, 0), (10, 10)], 2)
    assert out[0] == (0, 0) and out[-1] == (10, 10)
    assert len(out) > 3
    assert all(math.hypot(x - 10, y) > 0.5 for x, y in out)  # the corner is cut


def test_spurs_into_corners_are_pruned():
    # A street axis from (0,0) to (20,0), with a 1 m spur from its middle.
    adj = {(0, 0): [(10, 0)], (10, 0): [(0, 0), (20, 0), (10, 1)], (20, 0): [(10, 0)], (10, 1): [(10, 0)]}
    radius = {(0, 0): 3.0, (10, 0): 3.0, (20, 0): 3.0, (10, 1): 2.5}
    streets.prune_spurs(adj, radius)
    assert (10, 1) not in adj
    assert sorted(adj[(10, 0)]) == [(0, 0), (20, 0)]


def test_a_straight_street_gets_its_centreline():
    geometry = pytest.importorskip("shapely.geometry")
    street = geometry.box(0, 0, 60, 8)  # 8 m wide, 60 m long
    lines, half_width = streets.centrelines(street)
    longest = max(lines, key=lambda ln: ln.length)
    assert longest.length > 45
    for x, y in longest.coords:
        if 10 < x < 50:
            assert y == pytest.approx(4, abs=0.3)
    assert half_width(geometry.Point(30, 4)) == pytest.approx(4)


def test_kerb_edges_are_where_the_road_lies_beyond():
    geometry = pytest.importorskip("shapely.geometry")
    building = geometry.box(0, 3, 10, 10)
    ring = [(0, 0), (10, 0), (10, 3), (0, 3)]  # a pavement along the building's south front
    flags = streets._edge_flags(ring, lambda p: building.contains(p), True)
    assert flags == "1101"  # south, east and west edges face the road; the north edge (third) is the facade


def test_history_dates_are_in_order():
    h = streets.HISTORY
    assert h["oil_lanterns"]["years"][1] == h["gas_lamps"]["years"][0]
    assert h["stone_plaques"]["years"][1] == h["enamel_plaques"]["years"][0] == 1847
    assert streets.STUDDED_CROSSINGS_FROM < streets.PAINTED_CROSSINGS_FROM
    assert streets.OLD_PAVEMENTS_FROM < streets.OLD_UNTIL == streets.MODERN_FROM
    assert set(streets.ITEM.values()) == set(range(len(streets.ITEM)))

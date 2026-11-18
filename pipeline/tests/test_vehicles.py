import math

import pytest

from rpr.sources import vehicles as V


def test_every_type_is_dated_and_sourced():
    ids = [t["id"] for t in V.TYPES]
    assert len(ids) == len(set(ids))
    for t in V.TYPES:
        assert 1780 <= t["from"] < t["until"] <= V.OPEN, t["id"]
        assert t["length"] > t["width"] > 0 and t["note"], t["id"]
    assert V.TYPES[V.TYPE_INDEX["omnibus"]]["from"] == 1828
    assert V.TYPES[V.TYPE_INDEX["omnibus"]]["until"] == 1913  # last horse omnibus, January 1913
    assert V.TYPES[V.TYPE_INDEX["steamer"]]["from"] == 1867  # bateaux-mouches of the Exposition
    assert V.TYPES[V.TYPE_INDEX["motorbus"]]["from"] == 1906


def test_eras_follow_each_other_and_use_known_types():
    for a, b in zip(V.ERAS, V.ERAS[1:]):
        assert a["until"] == b["from"]
    for era in V.ERAS + V.BOAT_ERAS:
        for k in era["mix"]:
            assert k in V.TYPE_INDEX
    assert V.ERAS[0]["from"] <= 1780 and V.ERAS[-1]["until"] == V.OPEN
    # Every era has a type alive at some point in it.
    for era in V.ERAS:
        assert V.era_type_mix(era["mix"], (era["from"], era["until"]), lambda k: True)


def test_stable_numbers_and_weighted_picks():
    assert V.stable("a", 1) == V.stable("a", 1)
    assert 0 <= V.stable("x") < 1
    weights = {"a": 1, "b": 3, "c": 0}
    assert V.pick(weights, 0.1) == "a"
    assert V.pick(weights, 0.5) == "b"
    assert V.pick(weights, 0.9999) == "b"
    assert V.pick({"a": 0}, 0.5) is None
    counts = {"a": 0, "b": 0}
    for i in range(2000):
        counts[V.pick(weights, V.stable(i))] += 1
    assert 0.2 < counts["a"] / 2000 < 0.3


def test_year_spans_subtract_and_intersect():
    assert V.subtract([(1800, 1900)], (1850, 1860)) == [(1800, 1850), (1860, 1900)]
    assert V.subtract([(1800, 1900)], (1700, 2000)) == []
    assert V.subtract([(1800, 1900)], (1900, 1950)) == [(1800, 1900)]
    assert V.intersect((1800, 1900), (1850, 2000)) == (1850, 1900)
    assert V.intersect((1800, 1900), (1900, 2000)) is None


def test_building_lives_match_the_app():
    assert V.building_life({"kind": "standing", "from": 1700}) == (-V.OPEN, V.OPEN)
    assert V.building_life({"kind": "reconstructed", "until": 1860}) == (-V.OPEN, 1860)
    assert V.building_life({"kind": "later", "from": 1880}) == (1880, V.OPEN)
    assert V.building_life({"kind": "undated"}) == (1851, V.OPEN)


def test_types_in_an_era_respect_their_own_years():
    mix = {"omnibus": 1, "car_early": 1, "cart": 1}
    assert set(V.era_type_mix(mix, (1840, 1860), lambda k: True)) == {"omnibus", "cart"}
    assert set(V.era_type_mix(mix, (1920, 1930), lambda k: True)) == {"car_early", "cart"}
    assert set(V.era_type_mix(mix, (1840, 1860), lambda k: k not in V.LONG)) == {"cart"}


def test_kerbs_fill_by_width_and_period():
    era = next(e for e in V.ERAS if e["from"] == 1950)
    assert V.kerb_density(era, 12, False) == era["kerb"][1]
    assert V.kerb_density(era, 4, False) == era["kerb"][0]
    today = V.ERAS[-1]
    assert V.kerb_density(today, 12, True) < V.kerb_density(today, 12, False)


def test_streets_skip_paths_stairs_and_low_quays():
    assert V.is_street({"nature": "Route à 1 chaussée", "cpx_toponyme_route_nommee": "R DE LA CITE"})
    assert not V.is_street({"nature": "Escalier"})
    assert not V.is_street({"nature": "Route à 1 chaussée", "acces_vehicule_leger": "Physiquement impossible"})
    assert not V.is_street({"nature": "Route à 1 chaussée", "cpx_toponyme_route_nommee": "PORT DE MONTEBELLO"})
    assert not V.is_street({"nature": "Route à 1 chaussée", "nom_collaboratif_gauche": "Voie Georges Pompidou"})
    assert V.carriageway({"largeur_de_chaussee": 7}) == 7
    assert V.carriageway({"largeur_de_chaussee": None, "importance": "3"}) == 9.0


def test_bridges_carry_traffic_only_once_built_for_it():
    assert V.BRIDGES["Pont d’Arcole"][0] == 1856
    assert V.BRIDGES["Pont au Double"][0] == 1883
    assert "Pont Saint-Louis" not in V.BRIDGES


def test_bridge_traffic_follows_the_island_bridges():
    # Rebuilt 1858-1860: no traffic in the gap; houses until 1788 keep carts off.
    assert V.traffic_spans("PONT AU CHANGE", (-V.OPEN, V.OPEN)) == [(1788, 1858), (1860, V.OPEN)]
    # The Arcole footbridge carried no carts.
    assert V.traffic_spans("PONT D'ARCOLE", (1856, V.OPEN))[0][0] >= 1856
    # A crossing the island has no history for keeps its own years.
    assert V.traffic_spans("PONT MARIE", (-V.OPEN, V.OPEN)) == [(-V.OPEN, V.OPEN)]


def test_footprints_are_rectangles_along_the_heading():
    pytest.importorskip("shapely")
    r = V.rect(10, 5, 90, 4, 2)
    assert r.area == pytest.approx(8)
    x0, y0, x1, y1 = r.bounds
    assert (x1 - x0, y1 - y0) == (pytest.approx(2), pytest.approx(4))
    assert V.heading_deg(0, 1) == pytest.approx(90)
    assert V.heading_deg(-1, 0) == pytest.approx(180)


def test_buildings_cut_the_years_of_a_footprint():
    geometry = pytest.importorskip("shapely.geometry")
    b = V.Buildings([geometry.box(0, 0, 10, 10), geometry.box(20, 0, 30, 10)], [(-V.OPEN, 1860), (1900, V.OPEN)])
    assert b.free_years(V.rect(5, 5, 0, 4, 2), (1800, 1950)) == [(1860, 1950)]
    assert b.free_years(V.rect(25, 5, 0, 4, 2), (1800, 1950)) == [(1800, 1900)]
    assert b.free_years(V.rect(15, 5, 0, 4, 2), (1800, 1950)) == [(1800, 1950)]


class FakePlacer:
    def __init__(self):
        self.calls = []

    def street(self, kind, x, y, heading, span, flags=0, bridge_ok=False):
        self.calls.append((kind, x, y, heading, span, flags))
        return 1


def test_kerb_walk_parks_on_the_requested_side_facing_the_traffic():
    geometry = pytest.importorskip("shapely.geometry")
    line = geometry.LineString([(0, 0), (200, 0)])
    placer = FakePlacer()
    n = V.fill_kerb(placer, "k", line, -1, lambda w: 3.0, (1900, 1950), 1.0, {"cart": 1}, 0, 7, 193)
    assert n == len(placer.calls) > 20
    for kind, x, y, heading, span, flags in placer.calls:
        assert kind == "cart" and y == pytest.approx(-3.0)  # the right-hand kerb
        assert heading == pytest.approx(0)  # facing along the line, with the traffic of that side
        assert 7 <= x <= 193
    xs = sorted(c[1] for c in placer.calls)
    assert min(b - a for a, b in zip(xs, xs[1:])) >= V.TYPES[V.TYPE_INDEX["cart"]]["length"]
    left = FakePlacer()
    V.fill_kerb(left, "k", line, 1, lambda w: 3.0, (1900, 1950), 1.0, {"cart": 1}, 0, 7, 193)
    assert all(c[2] == pytest.approx(3.0) and c[3] == pytest.approx(180) for c in left.calls)


def test_road_segments_chain_into_through_routes():
    geometry = pytest.importorskip("shapely.geometry")

    def road(i, coords):
        r = V.Road.__new__(V.Road)
        r.i, r.line, r.importance, r.width, r.oneway, r.bridge = i, geometry.LineString(coords), 4, 7, 0, None
        return r

    # A straight street in three pieces, and a side street at right angles.
    segments = [road(0, [(0, 0), (50, 0)]), road(1, [(100, 0), (50, 0)]), road(2, [(100, 0), (150, 2)]), road(3, [(50, 0), (50, 60)])]
    chains = V.chains(segments)
    longest = max(chains, key=len)
    assert {r.i for r, _ in longest} == {0, 1, 2}
    line = V.chain_line(longest)
    assert line.length == pytest.approx(150, abs=0.1)
    assert sum(len(c) for c in chains) == 4


def test_bow_and_heading_helpers_agree():
    # A vehicle heading north-east in the data points along (cos, sin) of its heading.
    h = V.heading_deg(1, 1)
    assert math.cos(math.radians(h)) == pytest.approx(math.sqrt(0.5))


def test_last_pass_clears_lanes_and_shared_spots():
    pytest.importorskip("shapely")
    ident = lambda x, y: (x, y)  # rows in metres for the test
    cart = V.TYPE_INDEX["cart"]
    parked = [
        [cart, 0.0, 0.0, 0.0, 1800, 1900, 0],
        [cart, 1.0, 0.0, 0.0, 1850, 1950, 0],  # on top of the first from 1850 to 1900
        [cart, 50.0, 0.0, 0.0, 1800, 1900, 0],  # in the lane of a moving cart from 1860
        [cart, 50.0, 10.0, 0.0, 1800, 1900, 0],  # well clear
    ]
    paths = [[[0.0, 0.0], [100.0, 0.0]]]
    moving = [[cart, 0, 1860, 1890, 2.0, 0.0, 1, 0.0]]
    out = V.resolve(parked, moving, paths, ident)
    spans = {(r[1], r[2]): [] for r in out}
    for r in out:
        spans[(r[1], r[2])].append((r[4], r[5]))
    assert spans[(0.0, 0.0)] == [(1800, 1860), (1890, 1900)]  # the moving cart passes here too
    assert spans[(1.0, 0.0)] == [(1900, 1950)]
    assert spans[(50.0, 0.0)] == [(1800, 1860), (1890, 1900)]
    assert spans[(50.0, 10.0)] == [(1800, 1900)]

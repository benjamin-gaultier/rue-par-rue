import pytest

from rpr.sources import site


def test_bridge_names_read_like_a_map():
    assert site.bridge_name("PONT AU CHANGE") == "Pont au Change"
    assert site.bridge_name("PONT D'ARCOLE") == "Pont d’Arcole"
    assert site.bridge_name("PONT NOTRE-DAME") == "Pont Notre-Dame"
    assert site.bridge_name("PETIT PONT CARDINAL LUSTIGER") == "Petit-Pont"


def test_bd_topo_coordinates_lose_their_height():
    g = {"type": "Polygon", "coordinates": [[[2.0, 48.0, 27.0], [2.1, 48.0, 27.2], [2.1, 48.1, 27.1], [2.0, 48.0, 27.0]]]}
    assert site.flat(g)["coordinates"][0][1] == [2.1, 48.0]
    assert site.zs(g) == [27.0, 27.2, 27.1, 27.0]


def test_ground_has_the_river_cut_out_and_quays_face_the_water():
    geometry = pytest.importorskip("shapely.geometry")
    river = geometry.box(-1, 4, 11, 6)  # a river crossing a 10 x 10 box
    out = site.ground_features(river, geometry.box(0, 0, 10, 10))
    kinds = [f["properties"]["kind"] for f in out]
    assert kinds.count("water") == 1 and kinds.count("ground") == 1
    ground = geometry.shape(next(f["geometry"] for f in out if f["properties"]["kind"] == "ground"))
    assert ground.area == pytest.approx(80)
    quays = [f["geometry"]["coordinates"] for f in out if f["properties"]["kind"] == "quay"]
    assert len(quays) == 2
    for line in quays:
        (ax, ay), (bx, by) = line[0], line[1]
        right = ((ax + bx) / 2 + (by - ay) * 0.01, (ay + by) / 2 - (bx - ax) * 0.01)
        assert river.contains(geometry.Point(right))


def test_every_bridge_history_is_dated_and_sound():
    for key, entry in {**site.BRIDGES, **{o["key"]: o for o in site.OLD_LINES["cite"]}}.items():
        assert entry["sources"], key
        assert site.check_history(entry["history"]) == [], key


def test_bridge_histories_match_the_sources():
    nd = site.BRIDGES["PONT NOTRE-DAME"]["history"]
    assert nd[0]["houses_until"] == 1787 and [g["from"] for g in nd[1:]] == [1853, 1919]
    change = site.BRIDGES["PONT AU CHANGE"]["history"]
    assert change[0]["houses_until"] == 1788 and change[0]["until"] == 1858 and change[1]["from"] == 1860
    assert site.BRIDGES["PONT SAINT-MICHEL"]["history"][0]["houses_until"] == 1808
    arcole = site.BRIDGES["PONT D'ARCOLE"]["history"]
    assert (arcole[0]["from"], arcole[0]["kind"], arcole[0]["width"]) == (1828, "suspension", 3.5)
    assert site.BRIDGES["PONT DE L'ARCHEVECHE"]["history"][0]["from"] == 1828
    assert site.OLD_LINES["cite"][0]["history"][0]["until"] == 1860
    assert site.BRIDGES["PONT LOUIS-PHILIPPE"]["history"][0]["from"] == 1862


def test_history_checks_catch_mistakes():
    good = {"kind": "stone", "arches": 3, "note": "x"}
    assert site.check_history([{**good, "from": None, "until": 1850}, {**good, "from": 1850, "until": None}]) == []
    assert site.check_history([{**good, "from": 1860, "until": 1850}])
    assert site.check_history([{**good, "from": None, "until": 1850}, {**good, "from": 1840, "until": None}])
    assert site.check_history([{**good, "from": None, "until": 1850, "houses_until": 1900}])
    assert site.check_history([{**good, "kind": "glass", "from": 1800, "until": None}])


def test_arches_per_crossing():
    history = [{"from": 1607, "until": None, "kind": "stone-old", "arches": [7, 5], "note": "x"}]
    assert site.history_for(history, 0, 2)[0]["arches"] == 7
    assert site.history_for(history, 1, 2)[0]["arches"] == 5
    assert site.history_for(history, 0, 1)[0]["arches"] == 7
    out = site.history_for([{"from": None, "until": 1858, "kind": "stone-old", "arches": 7, "houses_until": None, "note": "x"}], 0, 1)[0]
    assert out["from"] is None and "houses_until" not in out


def test_a_bridge_over_both_arms_gets_one_deck_per_crossing():
    geometry = pytest.importorskip("shapely.geometry")
    # Two arms of a river (y 0-20 and y 60-80) around an island; a bridge in two pieces.
    river = geometry.box(-100, 0, 100, 80).difference(geometry.box(-200, 20, 200, 60))
    north = geometry.LineString([(0, 55), (2, 85)])
    south = geometry.LineString([(-3, -5), (-1, 25)])
    groups = site.clusters([north, south])
    assert len(groups) == 2
    spans = [s for g in groups for s in site.crossings(g, river)]
    assert len(spans) == 2
    assert all(15 < s.length < 40 for s in spans)


def test_bridge_decks_from_road_segments():
    pytest.importorskip("shapely.geometry")
    from shapely.geometry import box

    river = box(-100, 0, 100, 40)

    def seg(name, coords, width=7):
        return {
            "properties": {"cpx_toponyme_route_nommee": name, "position_par_rapport_au_sol": "1", "largeur_de_chaussee": width},
            "geometry": {"type": "LineString", "coordinates": coords},
        }

    roads = [seg("PONT AU CHANGE", [(0, 10), (0, 30)]), seg("RUE X", [(50, -10), (50, 50)])]
    same = lambda x, y: (x, y)  # noqa: E731
    decks = site.bridge_decks(roads, river, same, same)
    assert [d["name"] for d in decks] == ["Pont au Change"]
    d = decks[0]
    assert d["width"] == pytest.approx(7 * 1.2 + site.SIDEWALKS_M)
    assert d["length"] == pytest.approx(48)  # the water, plus 4 m onto each bank
    x0, y0, x1, y1 = d["deck"].bounds
    assert (y0, y1) == (pytest.approx(-4), pytest.approx(44))


def test_an_old_line_crosses_both_arms_as_one_deck():
    pytest.importorskip("shapely.geometry")
    from shapely.geometry import box

    # Arms y 0-20 and y 24-60: the old line runs from a point on the south bank through the island's edge.
    river = box(-100, 0, 100, 60).difference(box(-200, 20, 200, 24))
    old = {"key": "OLD", "name": "Old bridge", "through": [(0, 0), (0, 22)], "width": 6.0}
    same = lambda x, y: (x, y)  # noqa: E731
    decks = site.bridge_decks([], river, same, same, [old])
    assert len(decks) == 1 and decks[0]["name"] == "Old bridge"
    assert decks[0]["length"] == pytest.approx(68)


def test_the_detailed_area_is_the_islands_and_the_banks():
    pytest.importorskip("shapely.geometry")
    from shapely.geometry import Point, box

    river = box(-500, 0, 500, 100).difference(box(-100, 30, 100, 70))  # an island in the middle
    same = lambda x, y: (x, y)  # noqa: E731
    zone = site.riverside(river, box(-400, -400, 400, 400), 50, same, same)
    assert zone.contains(Point(0, 50))  # on the island
    assert zone.contains(Point(0, -40))  # on a bank, near the water
    assert not zone.contains(Point(0, -80))  # too far from the water
    assert not zone.contains(Point(450, 50))  # outside the focus box

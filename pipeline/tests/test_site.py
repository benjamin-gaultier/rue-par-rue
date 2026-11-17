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

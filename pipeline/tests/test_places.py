"""The gazetteer of named places that are not streets (gardens, squares, bridges, gates)."""

from rpr.sources.places import Arrondissements, Places, bdtopo_kind, build_places, centre_and_spread


def square(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


# Two made-up arrondissements either side of lon 2.35.
ARRS = Arrondissements([
    {"properties": {"c_ar": 5}, "geometry": square(2.30, 48.80, 2.35, 48.90)},
    {"properties": {"c_ar": 4}, "geometry": square(2.35, 48.80, 2.40, 48.90)},
])


def bdtopo(name, geom, nature="Espace public", detail="Square"):
    return {"properties": {"toponyme": name, "nature": nature, "nature_detaillee": detail}, "geometry": geom}


def voie(name, typ, geom):
    return {"properties": {"typo_min": name, "typvoie": typ}, "geometry": geom}


def test_centre_and_spread():
    (x, y), spread = centre_and_spread([(square(2.30, 48.85, 2.31, 48.86)["coordinates"][0], True)])
    assert (x, y) == (2.305, 48.855)
    assert 660 < spread < 666  # half the diagonal of a ~732 m by ~1105 m box
    # A bridge drawn as a line: the length-weighted middle.
    (x, y), _ = centre_and_spread([([[2.30, 48.85], [2.32, 48.85]], False)])
    assert (x, y) == (2.31, 48.85)


def test_kinds_kept():
    assert bdtopo_kind({"nature": "Espace public", "nature_detaillee": "Jardin public"}) == "public space"
    assert bdtopo_kind({"nature": "Pont"}) == "bridge"
    assert bdtopo_kind({"nature": "Monument", "nature_detaillee": "Statue"}) is None
    assert bdtopo_kind({"nature": "Enseignement", "nature_detaillee": "Collège"}) is None


def test_build_merges_pieces_and_keeps_paris_only():
    table = build_places(
        [
            # The two arms of a bridge, either side of an island: one place across two arrondissements.
            bdtopo("Pont Neuf", square(2.348, 48.857, 2.349, 48.858), "Pont", None),
            bdtopo("Pont Neuf", square(2.351, 48.857, 2.352, 48.858), "Pont", None),
            bdtopo("Square Lointain", square(2.50, 48.85, 2.51, 48.86)),  # outside the arrondissements
            bdtopo("Statue de Personne", square(2.31, 48.85, 2.311, 48.851), "Monument", "Statue"),
        ],
        [
            voie("Pont Neuf", "Pont", square(2.349, 48.857, 2.351, 48.858)),  # already in BD TOPO, close by
            voie("avenue de la Porte d'Ivry", "Avenue", {"type": "LineString", "coordinates": [[2.36, 48.82], [2.37, 48.82]]}),
            voie("rue des Écoles", "Rue", {"type": "LineString", "coordinates": [[2.34, 48.85], [2.345, 48.85]]}),
        ],
        ARRS,
    )
    assert sorted(table) == ["avenue de la porte d ivry", "pont neuf"]
    (pont,) = table["pont neuf"]
    assert (pont["source"], pont["kind"], pont["arr"], pont["center"]) == ("bdtopo", "bridge", [4, 5], [2.35, 48.8575])
    (gate,) = table["avenue de la porte d ivry"]
    assert (gate["name"], gate["kind"], gate["arr"]) == ("Avenue de la Porte d'Ivry", "gate way", [4])


def test_find_by_whole_name_and_arrondissement():
    places = Places({"square rene viviani": [{"name": "Square René Viviani", "arr": [5], "center": [2.347, 48.852], "spread": 59}]})
    assert places.find("square René-Viviani")[0]["spread"] == 59
    assert places.find("Square René Viviani", 5) and not places.find("Square René Viviani", 4)
    assert places.find("Square Viviani") == []

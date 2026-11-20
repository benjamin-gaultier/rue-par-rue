import pytest

from rpr.headings import Facades, facade_bearing, facade_street, key
from rpr.photo import Photo

shapely = pytest.importorskip("shapely")
from shapely.geometry import Polygon  # noqa: E402

# An east-west street 10 m wide, from x = 0 to x = 100.
STREET = Polygon([(0, 0), (100, 0), (100, 10), (0, 10)])
# A north-south street 8 m wide, at x = 0..8.
AVENUE = Polygon([(0, 0), (8, 0), (8, 100), (0, 100)])


def test_facing_the_building_across_the_street():
    assert facade_bearing((50, 11), STREET) == 0.0  # house on the north side: look north
    assert facade_bearing((50, -1), STREET) == 180.0
    assert facade_bearing((9, 50), AVENUE) == 90.0
    assert facade_bearing((-1, 50), AVENUE) == 270.0


def test_address_point_just_inside_the_street():
    assert facade_bearing((50, 9.5), STREET) == 0.0
    assert facade_bearing((50, 0.5), STREET) == 180.0


def test_no_heading_when_unclear():
    assert facade_bearing((50, 30), STREET) is None  # set back 20 m behind a courtyard
    assert facade_bearing((50, 5), STREET) is None  # middle of the street


def test_slanted_street():
    # The same street turned 45° counter-clockwise: the north side now faces north-west.
    slanted = shapely.affinity.rotate(STREET, 45, origin=(0, 0))
    house = shapely.affinity.rotate(shapely.geometry.Point(50, 11), 45, origin=(0, 0))
    assert facade_bearing((house.x, house.y), slanted) == pytest.approx(315.0, abs=0.1)


def extra(label, precision="number", method="ban"):
    return {"geocoded_street": label, "precision": precision, "method": method}


def test_facade_street_from_the_address_label():
    assert facade_street(extra("13 Quai d'Anjou 75004 Paris"), "Hôtel, 13 quai d'Anjou") == "Quai d'Anjou"
    assert facade_street(extra("21 bis Rue Cassette 75006 Paris"), "21 bis rue Cassette") == "Rue Cassette"


@pytest.mark.parametrize(
    "title",
    [
        "Cour du 21 rue Cassette",
        "Escalier, 5 rue de Turenne",
        "Intérieur, 3 rue Visconti",
        "Pavillon, ancien parc de Philippe Egalité, 148 rue de Bagnolet",
        "Le 14 rue de Seine, vue prise de la rue de Buci",
    ],
)
def test_no_facade_when_the_caption_says_otherwise(title):
    assert facade_street(extra("5 Rue de Turenne 75004 Paris"), title) is None


def test_only_todays_house_numbers():
    assert facade_street(extra("Rue de Rivoli 75001 Paris", precision="street"), "Rue de Rivoli") is None
    assert facade_street(extra("12 Rue de la Licorne", method="vasserot-1836"), "12 rue de la Licorne") is None


def test_saved_bearings_are_looked_up_by_address_point():
    f = Facades({key(2.359062, 48.851698): 209.2})
    e = extra("17 Quai d'Anjou 75004 Paris")
    assert f.heading(2.3590621, 48.8516979, e, "Hôtel de Lauzun, 17 quai d'Anjou") == 209.2
    assert f.heading(2.36, 48.85, e, "Hôtel de Lauzun") is None
    assert f.heading(2.359062, 48.851698, e, "Cour de l'hôtel de Lauzun") is None


def photo(**kw):
    base = dict(source="t", source_id="1", title="x", lon=2.35, lat=48.85, thumb="t.jpg")
    return Photo(**{**base, **kw})


def test_a_heading_needs_its_method():
    assert photo(heading=10.0, heading_method="facade", heading_confidence=0.5).problems() == []
    assert "unknown heading method None" in photo(heading=10.0).problems()
    assert "unknown heading method 'guess'" in photo(heading=10.0, heading_method="guess").problems()
    assert "heading method without a heading" in photo(heading_method="facade").problems()

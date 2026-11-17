from rpr.sources import model3d


def test_estimated_heights_are_stable_and_in_range():
    a = model3d.estimated_height("vasserot:123")
    assert a == model3d.estimated_height("vasserot:123")
    lo, hi = model3d.EST_HEIGHT
    heights = [model3d.estimated_height(f"k{i}") for i in range(200)]
    assert all(lo <= h <= hi for h in heights)
    assert len(set(heights)) > 50  # varied, not a flat block


def test_period_classes():
    assert model3d.STANDING_IN_1836 == {1, 2}
    assert model3d.PERIOD_FROM[3] == 1851
    assert model3d.APUR_PERIODS[1] == "before 1800"


def test_open_spaces_are_not_extruded():
    assert model3d.is_open_space({"CODE_FIAB": "2P", "NOM_CODE2": "Parvis Notre Dame", "NUM_ILOT": ""})
    assert model3d.is_open_space({"CODE_FIAB": "2M", "NOM_CODE2": "Marché aux Fleurs", "NUM_ILOT": ""})
    assert not model3d.is_open_space({"CODE_FIAB": "", "NOM_CODE2": "Administration des Hospices", "NUM_ILOT": "36"})
    assert not model3d.is_open_space({"CODE_FIAB": "", "NOM_CODE2": "", "NUM_ILOT": "12"})


def test_fix_text():
    assert model3d.fix_text("H\u00c3\u00b4tel de Ville") == "Hôtel de Ville"
    assert model3d.fix_text("Cite") == "Cite"


def test_big_parcels_split_into_house_lots():
    import pytest

    geometry = pytest.importorskip("shapely.geometry")
    parcel = geometry.box(0, 0, 36, 18)  # about 4 x 2 lots of 9 m
    lots = model3d.split_houses(parcel)
    assert 6 <= len(lots) <= 10
    assert all(lot.area >= 8 for lot in lots)
    # Lots are inset a little from each other but cover nearly the whole parcel.
    assert 0.9 * parcel.area < sum(lot.area for lot in lots) <= parcel.area
    small = geometry.box(0, 0, 10, 12)
    assert model3d.split_houses(small) == [small]


def test_courtyard_parcels_split_into_lots_around_the_court():
    import pytest

    geometry = pytest.importorskip("shapely.geometry")
    ring = geometry.box(0, 0, 30, 30).difference(geometry.box(9, 9, 21, 21))
    lots = model3d.split_houses(ring)
    assert len(lots) >= 6
    assert not any(lot.intersects(geometry.box(10, 10, 20, 20)) for lot in lots)

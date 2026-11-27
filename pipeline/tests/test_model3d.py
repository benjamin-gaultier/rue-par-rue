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


def test_atlas_gives_the_built_part_of_a_parcel():
    import pytest

    geometry = pytest.importorskip("shapely.geometry")
    parcel = geometry.box(0, 0, 10, 20)
    house, yard = geometry.box(0, 0, 10, 12), geometry.box(0, 12, 10, 20)
    # A neighbour's house touches the parcel's side: it adds nothing.
    neighbour = geometry.box(10, 0, 20, 20)
    built = model3d.atlas_footprint(parcel, [house, neighbour], [yard])
    assert built.equals(house)


def test_atlas_keeps_two_buildings_and_drops_slivers():
    import pytest

    geometry = pytest.importorskip("shapely.geometry")
    parcel = geometry.box(0, 0, 10, 30)
    front, back = geometry.box(0, 0, 10, 10), geometry.box(0, 20, 10, 30)
    yard = geometry.box(0, 10, 10, 20).difference(geometry.box(4, 14, 5, 15))
    sliver = geometry.box(4, 14, 5, 15)  # 1 m2 of wash inside the yard
    built = model3d.atlas_footprint(parcel, [front, back, sliver], [yard])
    assert built.geom_type == "MultiPolygon" and len(built.geoms) == 2
    assert built.area == front.area + back.area


def test_atlas_says_nothing_or_all_yard():
    import pytest

    geometry = pytest.importorskip("shapely.geometry")
    parcel = geometry.box(0, 0, 10, 20)
    # Half the parcel is not drawn in the atlas: fall back on the parcel.
    assert model3d.atlas_footprint(parcel, [geometry.box(0, 0, 10, 10)], []) is None
    assert model3d.atlas_footprint(parcel, [], []) is None
    # Drawn as a yard all over: covered, and nothing built.
    all_yard = model3d.atlas_footprint(parcel, [], [parcel])
    assert all_yard is not None and all_yard.is_empty

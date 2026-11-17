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

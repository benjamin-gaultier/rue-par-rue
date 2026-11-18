from rpr.sources import greenery


def test_trees_are_grouped_by_genus():
    assert greenery.group_of("Platanus") == 0
    assert greenery.group_of("aesculus") == 1
    assert greenery.group_of("Populus") == 2
    assert greenery.group_of("Prunus") == 5
    assert greenery.group_of("Pinus") == 6
    assert greenery.group_of(None) == 4


def test_implausible_heights_fall_back_to_the_group_default():
    assert greenery.tree_height(18, 0) == 18
    assert greenery.tree_height(0, 0) == greenery.DEFAULT_HEIGHT[0]
    assert greenery.tree_height(120, 2) == greenery.DEFAULT_HEIGHT[2]
    assert greenery.tree_height("n/a", 5) == greenery.DEFAULT_HEIGHT[5]


def test_planting_jitter_is_stable_and_bounded():
    values = {greenery.jitter(str(i), 4) for i in range(100)}
    assert values <= {0, 1, 2, 3} and len(values) == 4
    assert greenery.jitter("abc", 4) == greenery.jitter("abc", 4)


def test_dated_gardens_have_a_year_and_a_reason():
    for name, year, note in greenery.GARDENS.values():
        assert 1600 <= year <= 2026 and name and note
    assert greenery.GARDENS[750000209][1] == 1844  # square Jean-XXIII

from rpr.sources import depth, kahn


def photo(pid: str, source: str, license: str) -> dict:
    return {"properties": {"id": pid, "source": source, "source_id": pid.split(":")[1], "license": license}}


def test_only_cleared_kahn_photos_get_a_depth_map():
    assert depth.derivable(photo("kahn:A 1", "kahn", kahn.LICENSE_CC_BY)["properties"])
    assert depth.derivable(photo("kahn:A 2", "kahn", kahn.LICENSE_CC0_OR_BY)["properties"])
    assert not depth.derivable(photo("kahn:A 3", "kahn", kahn.LICENSE_NOT_CLEARED)["properties"])
    assert not depth.derivable({"id": "kahn:A 4", "source": "kahn"})  # no licence: not cleared
    assert depth.derivable(photo("parismusees:1", "parismusees", "CC0-1.0")["properties"])


def test_prune_removes_maps_of_photos_not_cleared(tmp_path):
    photos = [
        photo("kahn:A 1", "kahn", kahn.LICENSE_CC_BY),
        photo("kahn:A 3", "kahn", kahn.LICENSE_NOT_CLEARED),
        photo("parismusees:1", "parismusees", "CC0-1.0"),
    ]
    index = {
        "kahn:A 1": {"depth": "kahn-A_1.png"},
        "kahn:A 3": {"depth": "kahn-A_3.png", "image": "kahn-A_3.jpg"},
        "parismusees:1": {"depth": "parismusees-1.png", "image": "parismusees-1.jpg"},
        "kahn:gone": {"depth": "kahn-gone.png"},  # no longer in photos.geojson: left alone
    }
    for entry in index.values():
        for name in entry.values():
            (tmp_path / name).write_bytes(b"x")

    assert depth.prune(index, photos, tmp_path) == ["kahn:A 3"]
    assert sorted(index) == ["kahn:A 1", "kahn:gone", "parismusees:1"]
    assert sorted(p.name for p in tmp_path.iterdir()) == [
        "kahn-A_1.png",
        "kahn-gone.png",
        "parismusees-1.jpg",
        "parismusees-1.png",
    ]


def test_stem_keeps_letters_and_digits():
    assert depth.stem_of({"source": "kahn", "source_id": "A 69 774 X"}) == "kahn-A_69_774_X"

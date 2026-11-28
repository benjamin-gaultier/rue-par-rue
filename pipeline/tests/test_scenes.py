import json

import pytest

from rpr.sources import kahn, scenes


def photo(pid: str, license: str = "CC0-1.0", confidence: float | None = 0.7, crop: str | None = "0.1,0.2,0.9,0.8", hfov=50.0) -> dict:
    source, source_id = pid.split(":")
    p = {"id": pid, "source": source, "source_id": source_id, "license": license}
    if crop is not None:
        p["camera_crop"] = crop
    if hfov is not None:
        p["camera_hfov"] = hfov
    if confidence is not None:
        p["camera_confidence"] = confidence
    return {"properties": p}


def test_crop_needs_a_full_camera():
    assert scenes.crop_of(photo("parismusees:1")["properties"]) == [0.1, 0.2, 0.9, 0.8]
    assert scenes.crop_of(photo("parismusees:1", hfov=None)["properties"]) is None
    assert scenes.crop_of(photo("parismusees:1", crop=None)["properties"]) is None
    assert scenes.crop_of(photo("parismusees:1", crop="0.1,0.2")["properties"]) is None


def test_only_well_placed_photos_cleared_for_reuse_get_a_scene():
    photos = [
        photo("parismusees:1"),
        photo("parismusees:2", confidence=0.3),  # lined up by eye, too loosely
        photo("parismusees:3", confidence=None),
        photo("parismusees:4", crop=None),  # a viewpoint, no camera
        photo("kahn:A 1", license=kahn.LICENSE_CC_BY, confidence=0.5),
        photo("kahn:A 2", license=kahn.LICENSE_NOT_CLEARED),
    ]
    assert [f["properties"]["id"] for f in scenes.chosen(photos)] == ["parismusees:1", "kahn:A 1"]


def test_crop_box_stays_inside_the_image():
    assert scenes.crop_box(1000, 500, [0.1, 0.2, 0.9, 0.8]) == (100, 100, 900, 400)
    assert scenes.crop_box(1000, 500, [-0.1, -0.2, 1.2, 1.1]) == (0, 0, 1000, 500)
    assert scenes.crop_box(1000, 500, [0.5, 0.5, 0.5, 0.5]) == (500, 250, 501, 251)


def test_settings_are_read_by_photo_id(tmp_path):
    f = tmp_path / "scenes.json"
    assert scenes.load_settings(f) == {}
    f.write_text(json.dumps({"about": "x", "photos": {"kahn:A 1": {"covers": [[0, 0.9, 0.1, 1]]}}}), encoding="utf-8")
    assert scenes.load_settings(f) == {"kahn:A 1": {"covers": [[0, 0.9, 0.1, 1]]}}


def test_the_checked_in_settings_are_well_formed():
    for pid, s in scenes.load_settings().items():
        assert ":" in pid
        for box in s.get("covers", []):
            x0, y0, x1, y1 = box
            assert 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1, (pid, box)


def test_prune_removes_scenes_no_longer_chosen(tmp_path):
    index = {"a": {"image": "a.jpg", "mask": "a-mask.png"}, "b": {"image": "b.jpg", "mask": "b-mask.png"}}
    for e in index.values():
        for name in e.values():
            (tmp_path / name).write_bytes(b"x")
    assert scenes.prune(index, {"a"}, tmp_path) == ["b"]
    assert list(index) == ["a"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["a-mask.png", "a.jpg"]


# ------------------------------------------------------------------ masks (need numpy, not installed in CI)


def street(h=60, w=80):
    """A grey street under a pale, blank sky, with a pale wall that does not reach the top."""
    np = pytest.importorskip("numpy")
    rng = np.random.default_rng(1)
    rgb = np.full((h, w, 3), 0.85, np.float32)  # sky
    rgb[h // 2 :] = 0.4 + 0.1 * rng.random((h - h // 2, w, 1))  # textured houses and street
    # a pale wall, as bright as the sky on average, with the texture of stone (std 0.05 as in Marville's prints)
    rgb[h // 3 :, 50:70] = 0.76 + 0.18 * rng.random((h - h // 3, 20, 1))
    return rgb


def test_sky_is_light_and_smooth_and_touches_the_top():
    np = pytest.importorskip("numpy")
    rgb = street()
    sky = scenes.sky_mask(rgb, colour=False)
    assert sky[:10].all()
    assert not sky[40:].any()
    assert not sky[30:, 52:68].any()  # the pale wall is not sky


def test_a_light_patch_away_from_the_top_is_not_sky():
    np = pytest.importorskip("numpy")
    rgb = np.full((40, 40, 3), 0.3, np.float32)
    rgb[20:30, 10:30] = 0.9
    assert not scenes.sky_mask(rgb, colour=False).any()


def test_colour_sky_must_be_blue_not_warm_stone():
    np = pytest.importorskip("numpy")
    rgb = np.full((40, 40, 3), 0.3, np.float32)
    rgb[:15] = (0.7, 0.74, 0.8)  # blue-grey sky
    rgb[:15, 25:] = (0.82, 0.78, 0.7)  # warm stone of a tower reaching the top
    sky = scenes.sky_mask(rgb, colour=True)
    assert sky[:12, :20].all()
    assert not sky[:, 28:].any()


def test_leaves_are_green_and_shade_on_the_ground_is_not():
    np = pytest.importorskip("numpy")
    rgb = np.full((100, 100, 3), 0.7, np.float32)
    rgb[20:60, 20:60] = (0.30, 0.36, 0.25)  # a tree
    rgb[88:98, 10:90] = (0.20, 0.26, 0.17)  # green shade wholly in the bottom fifth
    leaves = scenes.leaves_mask(rgb)
    assert leaves[25:55, 25:55].all()
    assert not leaves[:15].any()
    assert not leaves[85:].any()


def test_masks_are_scaled_to_the_picture_with_their_shares():
    pytest.importorskip("numpy")
    Image = pytest.importorskip("PIL.Image")
    np = pytest.importorskip("numpy")
    rgb = (street(120, 160) * 255).astype(np.uint8)
    img = Image.fromarray(rgb, "RGB").resize((960, 720))  # larger than the working size
    mask, shares = scenes.masks(img, colour=False, covers=[[0.0, 0.9, 0.25, 1.0]])
    assert mask.size == (960, 720)
    m = np.asarray(mask)
    assert m[5, 5, 0] == 255 and m[700, 600, 0] == 0
    assert m[710, 100, 2] == 255 and m[710, 400, 2] == 0
    assert not m[..., 1].any()  # no leaves in a black-and-white print
    assert 0.3 < shares["sky"] < 0.5
    assert shares["covered"] == pytest.approx(0.025, abs=0.005)

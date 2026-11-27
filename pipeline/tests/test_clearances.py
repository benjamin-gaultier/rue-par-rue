import pytest

from rpr.sources import clearances

geometry = pytest.importorskip("shapely.geometry")


def make_dater(monkeypatch, table, photos=()):
    monkeypatch.setattr(clearances, "CLEARANCES", list(table))
    monkeypatch.setattr(clearances, "PHOTOS", list(photos))
    parcels = {"A": geometry.box(0, 0, 10, 10), "B": geometry.box(20, 0, 30, 10), "C": geometry.box(40, 0, 50, 10)}
    facilities = [("HÔTEL DIEU", geometry.box(-5, -5, 15, 15))]
    # Address points sit on the street front, just outside the parcels.
    addresses = [("rue a", geometry.Point(5, 11)), ("rue b", geometry.Point(25, 11)), ("rue c", geometry.Point(45, 12))]
    return clearances.Dater(parcels, facilities, addresses)


SITE = {"id": "hotel-dieu", "until": 1866, "site": ("HÔTEL DIEU",), "reasoned": False, "note": "New Hôtel-Dieu (source)."}
STREET = {"id": "street-b", "until": 1863, "streets": ("rue b",), "reasoned": True, "note": "Rue b suppressed (source)."}


def test_houses_off_the_cite_keep_the_default(monkeypatch):
    d = make_dater(monkeypatch, [SITE])
    life = d.date("A", geometry.box(1, 1, 9, 9), "Arcis")
    assert life == {"until": clearances.DEFAULT_UNTIL, "until_basis": "default"}


def test_a_house_on_a_cleared_site_takes_its_year_and_source(monkeypatch):
    d = make_dater(monkeypatch, [SITE, STREET])
    life = d.date("A", geometry.box(1, 1, 9, 9), "Cite")
    assert life == {"until": 1866, "until_basis": "dated", "until_note": SITE["note"]}


def test_a_house_on_a_suppressed_street_is_reasoned(monkeypatch):
    d = make_dater(monkeypatch, [SITE, STREET])
    life = d.date("B", geometry.box(21, 1, 29, 9), "Palais de Justice")
    assert life["until"] == 1863 and life["until_basis"] == "reasoned"


def test_no_source_means_the_default_said_as_such(monkeypatch):
    d = make_dater(monkeypatch, [SITE, STREET])
    life = d.date("C", geometry.box(41, 1, 49, 9), "Cite")
    assert life == {"until": clearances.DEFAULT_UNTIL, "until_basis": "default"}
    assert d.counts == {"default": 1}


def test_a_dated_photo_keeps_the_houses_it_shows_standing(monkeypatch):
    photo = {"id": "parismusees:1", "year": 1865, "streets": ("rue b",), "note": "Photographed 1865-1868."}
    d = make_dater(monkeypatch, [STREET], [photo])
    life = d.date("B", geometry.box(21, 1, 29, 9), "Cite")
    assert life == {"until": 1866, "until_basis": "reasoned", "until_note": photo["note"]}
    # A later documented year stands: the photo only sets a lower bound.
    d = make_dater(monkeypatch, [SITE], [dict(photo, streets=("rue a",))])
    assert d.date("A", geometry.box(1, 1, 9, 9), "Cite")["until"] == 1866
    # An earlier year stated for the works wins, and the clash is logged for review.
    d = make_dater(monkeypatch, [dict(SITE, until=1863)], [dict(photo, streets=("rue a",))])
    assert d.date("A", geometry.box(1, 1, 9, 9), "Cite")["until"] == 1863
    assert d.conflicts == {("hotel-dieu", "parismusees:1"): 1}


def test_address_points_reach_only_nearby_parcels(monkeypatch):
    d = make_dater(monkeypatch, [])
    assert d.streets["A"] == {"rue a"} and d.streets["C"] == {"rue c"}
    far = clearances.Dater({"A": geometry.box(0, 0, 10, 10)}, [], [("rue z", geometry.Point(5, 30))])
    assert "A" not in far.streets


def test_a_clearance_takes_only_houses_that_pass_all_its_tests(monkeypatch):
    north = {"id": "north-edge", "until": 1867, "site": ("HÔTEL DIEU",), "streets": ("rue b",), "reasoned": True, "note": "n"}
    d = make_dater(monkeypatch, [north, SITE])
    # On the site but not on rue b: the next clearance takes it.
    assert d.date("A", geometry.box(1, 1, 9, 9), "Cite")["until"] == 1866
    # On rue b but off the site: neither matches.
    assert d.date("B", geometry.box(21, 1, 29, 9), "Cite")["until_basis"] == "default"


def test_a_house_under_a_street_goes_with_the_site_beside_it(monkeypatch):
    beside = {"id": "beside", "until": 1862, "near": ("PRÉFECTURE DE POLICE",), "open_space": True, "reasoned": True, "note": "b"}
    monkeypatch.setattr(clearances, "CLEARANCES", [beside])
    monkeypatch.setattr(clearances, "PHOTOS", [])
    facilities = [("PRÉFECTURE DE POLICE", geometry.box(0, 0, 10, 10)), ("PALAIS DE JUSTICE", geometry.box(40, 0, 50, 10))]
    standing = [geometry.box(0, 12, 10, 16)]
    d = clearances.Dater({}, facilities, [], standing)
    assert d.date("X", geometry.box(12, 0, 16, 10), "Cite")["until"] == 1862
    # Nearer the Palais, which no clearance dates: the default.
    assert d.date("Y", geometry.box(32, 0, 37, 10), "Cite")["until_basis"] == "default"
    # Too far from any site.
    assert d.date("Z", geometry.box(70, 0, 80, 10), "Cite")["until_basis"] == "default"
    # Covered by a building standing today: not under a street.
    assert d.date("W", geometry.box(1, 12, 9, 16), "Cite")["until_basis"] == "default"


def test_every_clearance_and_photo_names_its_source():
    for c in clearances.CLEARANCES:
        assert c["until"] > 1836 and c["note"] and c["source"] and c["url"].startswith("http")
        assert isinstance(c["reasoned"], bool)
        assert any(c.get(k) for k in clearances.SELECTORS)
        assert set(c) <= {"id", "until", "reasoned", "note", "source", "url", "open_space", *clearances.SELECTORS}
    assert len({c["id"] for c in clearances.CLEARANCES}) == len(clearances.CLEARANCES)
    for p in clearances.PHOTOS:
        assert p["id"].startswith("parismusees:") and p["streets"] and p["note"] and p["year"] > 1836

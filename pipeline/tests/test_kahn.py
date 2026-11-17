"""Field matching for the Albert-Kahn export.

The records below are synthetic: they reproduce the shapes Opendatasoft
exports use (geo_point_2d objects, [lat, lon] arrays, "lat, lon" strings,
file fields as objects) so the mapper is exercised before the live harvest.
"""

from rpr.sources import kahn


def test_norm_strips_accents_and_punctuation():
    assert kahn.norm("Légende révisée") == "legende_revisee"
    assert kahn.norm("Date de prise de vue") == "date_de_prise_de_vue"


def test_geo_shapes():
    assert kahn.parse_geo({"geo_point_2d": {"lon": 2.35, "lat": 48.85}}) == (2.35, 48.85)
    assert kahn.parse_geo({"geo_point_2d": [48.85, 2.35]}) == (2.35, 48.85)
    assert kahn.parse_geo({"Coordonnées": "48.85, 2.35"}) == (2.35, 48.85)
    assert kahn.parse_geo({"latitude": "48.85", "longitude": "2.35"}) == (2.35, 48.85)
    assert kahn.parse_geo({"titre": "sans position"}) is None


def test_years():
    assert kahn.parse_years("28 juillet 1914")[:2] == (1914, None)
    assert kahn.parse_years("1918-1919")[:2] == (1918, 1919)
    assert kahn.parse_years("vers 1925")[:2] == (1925, None)
    assert kahn.parse_years(None) == (None, None, None)


def test_record_to_photo():
    record = {
        "Cote": "A 4 512",
        "Légende": "Paris, rue de la Parcheminerie",
        "Date de prise de vue": "1914-07-28",
        "Opérateur": "Auguste Léon",
        "geo_point_2d": {"lon": 2.3466, "lat": 48.8524},
        "Image": {"url": "https://example.org/files/abc/download/", "format": "JPEG"},
        "Type": "Autochrome",
    }
    p = kahn.to_photo(record)
    assert p.id == "kahn:A 4 512"
    assert (p.lon, p.lat, p.year) == (2.3466, 48.8524, 1914)
    assert p.creator == "Auguste Léon"
    assert p.media == "autochrome"
    assert p.pose == "recorded"
    assert p.image == "https://example.org/files/abc/download/"
    assert p.problems() == []


def test_record_without_position_is_skipped():
    assert kahn.to_photo({"Cote": "X", "Légende": "Paris"}) is None

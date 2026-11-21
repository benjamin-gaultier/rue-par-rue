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


# A live record as printed by `rpr kahn --inspect` on GitHub Actions (trimmed).
LIVE = {
    "identifiant_fakir": "IF36953",
    "numero_d_inventaire": "A 7 479",
    "legende_originale_titre": "France, Paris, Passage du Caire",
    "legende_revisee": "L' entrée du passage du Caire au n°33 de la rue d'Alexandrie",
    "lieu": "Paris (IIe arr.), France",
    "date_de_prise_de_vue": "18 juillet 1914",
    "operateur": ["Georges Chevalier"],
    "procede_technique": "Autochrome",
    "droits_cessibles": None,
    "photo": {
        "thumbnail": True,
        "filename": "a007479.jpg",
        "format": "JPEG",
        "width": 800,
        "id": "96fb09c7a7e5acf0fba8a09d556c63ae",
        "height": 593,
        "url": "https://opendata.hauts-de-seine.fr/api/explore/v2.1/catalog/datasets/archives-de-la-planete-paris/files/96fb09c7a7e5acf0fba8a09d556c63ae",
    },
    "geo_point": {"lon": 2.349735, "lat": 48.8687},
}


def test_live_record_shape():
    p = kahn.to_photo(LIVE)
    assert p.id == "kahn:A 7 479"
    assert p.title.startswith("L' entrée du passage du Caire")
    assert p.creator == "Georges Chevalier"
    assert (p.year, p.media, p.pose) == (1914, "autochrome", "recorded")
    assert p.image.endswith("/files/96fb09c7a7e5acf0fba8a09d556c63ae")
    assert p.url.startswith("https://opendata.hauts-de-seine.fr/explore/dataset/archives-de-la-planete-paris/")
    assert p.problems() == []


def test_rights_flag():
    assert kahn.license_of("Oui") == kahn.LICENSE_CC0_OR_BY
    assert kahn.license_of(None) == kahn.LICENSE_CC0_OR_BY


def test_unknown_operator_is_blank():
    assert kahn.creator_of("opérateur non mentionné") is None
    assert kahn.creator_of(["Stéphane Passet"]) == "Stéphane Passet"


def test_licence_follows_the_rights_field_and_the_operator():
    # "Non" in the open data wins over everything else.
    assert kahn.license_of("Non", ["Auguste Léon"]) == kahn.LICENSE_NOT_CLEARED
    assert kahn.license_of("Non", None) == kahn.LICENSE_NOT_CLEARED
    # Operators whose images are all CC BY 4.0 on the museum's portal.
    for name in ("Frédéric Gadmer", "Georges Chevalier", "Roger Dumas"):
        assert kahn.license_of(None, [name]) == kahn.LICENSE_CC_BY
    # Two operators on one plate: the stricter licence.
    assert kahn.license_of(None, ["Auguste Léon", "Roger Dumas"]) == kahn.LICENSE_CC_BY
    # The others are CC0 with a few CC BY exceptions the open data cannot tell apart.
    for name in ("Auguste Léon", "Fernand Cuville", "Stéphane Passet"):
        assert kahn.license_of(None, [name]) == kahn.LICENSE_CC0_OR_BY
    assert kahn.license_of(None, "Auguste Léon") == kahn.LICENSE_CC0_OR_BY


def test_only_cleared_licences_may_become_textures():
    assert kahn.LICENSE_CC_BY in kahn.DERIVABLE
    assert kahn.LICENSE_CC0_OR_BY in kahn.DERIVABLE
    assert kahn.LICENSE_NOT_CLEARED not in kahn.DERIVABLE


def test_live_records_carry_their_licence():
    assert kahn.to_photo(LIVE).license == kahn.LICENSE_CC_BY
    unnamed = dict(LIVE, operateur=["opérateur non mentionné"], droits_cessibles="Non")
    assert kahn.to_photo(unnamed).license == kahn.LICENSE_NOT_CLEARED

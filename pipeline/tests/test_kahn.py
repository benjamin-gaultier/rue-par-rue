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
    assert kahn.license_of("Oui").startswith("Libre de droits")
    assert kahn.license_of(None) == kahn.INFO.license


def test_unknown_operator_is_blank():
    assert kahn.creator_of("opérateur non mentionné") is None
    assert kahn.creator_of(["Stéphane Passet"]) == "Stéphane Passet"


def _at(ident, title, date, lon=2.349507, lat=48.853141):
    return kahn.to_photo({"Cote": ident, "Légende": title, "Date de prise de vue": date, "geo_point_2d": {"lon": lon, "lat": lat}, "Image": {"url": "https://example.org/a.jpg"}})


def test_point_of_its_own_is_the_camera():
    (p,) = kahn.mark_shared_points([_at("A 1", "La rue Saint-Martin vue de la rue Meslay", "juillet 1914")])
    assert (p.pose, p.confidence, p.extra) == ("recorded", kahn.CAMERA_CONFIDENCE, {})


def test_plates_of_one_view_keep_the_camera_position():
    photos = kahn.mark_shared_points([_at("A 2", "Le pont de la Concorde", "29 juin 1918"), _at("A 2 S", "Le pont de la Concorde", "29 juin 1918")])
    assert all(p.extra == {} and p.confidence == kahn.CAMERA_CONFIDENCE for p in photos)


def test_point_shared_by_views_of_one_day_is_a_place():
    photos = kahn.mark_shared_points([_at("A 3", "Nef de l'église", "3 juillet 1914"), _at("A 4", "Le maître-autel de l'église", "3 juillet 1914")])
    for p in photos:
        assert p.extra == {"position_of": "place", "shared_point": 2, "shared_dates": 1}
        assert p.confidence == kahn.SHARED_DAY_CONFIDENCE
        assert p.pose == "recorded" and p.problems() == []


def test_point_shared_across_days_is_a_place_with_less_confidence():
    photos = kahn.mark_shared_points(
        [
            _at("A 5", "La cathédrale Notre-Dame", "29 juin 1921"),
            _at("A 6", "La cathédrale Notre-Dame", "28 juin 1920"),
            _at("A 7", "Les obsèques du maréchal Foch à Notre-Dame", "26 mars 1929"),
            _at("A 8", "Rue de la Huchette", "1911", lon=2.34566, lat=48.853),
        ]
    )
    assert [p.extra.get("shared_point") for p in photos] == [3, 3, 3, None]
    assert photos[0].extra["shared_dates"] == 3
    assert photos[0].confidence == kahn.SHARED_PLACE_CONFIDENCE
    assert photos[3].confidence == kahn.CAMERA_CONFIDENCE

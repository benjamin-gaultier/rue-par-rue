"""Captions the first matcher left unplaced: trailing words, places that are not streets, slips of arrondissement."""

from rpr.geocode import CONFIDENCE, MIN_SCORE, OTHER_ARRONDISSEMENT_FACTOR, Geocoder, parse_caption
from rpr.sources.places import Places
from test_geocode_history import Ban
from test_streetnames import history


# ------------------------------------------------------------ parsing


def test_street_names_end_before_descriptions_and_dates():
    def streets(caption):
        return parse_caption(caption).streets

    assert streets("Rue de Bretonvilliers avec l'hôtel de Bretonvilliers au fond, 4ème arrondissement") == ["Rue de Bretonvilliers"]
    assert streets("Rue Saint-Dominique prise du Ministère de la Guerre, 7ème arrondissement") == ["Rue Saint-Dominique"]
    assert streets("Rue Berton mars 1901") == ["Rue Berton"]
    assert streets("Quai des Grands Augustins en septembre 1900") == ["Quai des Grands Augustins"]
    assert streets("Rue Lepic. Montmartre, 18ème arrondissement") == ["Rue Lepic"]
    assert streets("Place du Tertre à Montmartre") == ["Place du Tertre"]
    assert streets("Rue Mouffetard - Marché, 5ème") == ["Rue Mouffetard"]
    assert streets("Passage Saint-Paul [ou Saint-Pierre], 4ème") == ["Passage Saint-Paul"]
    assert streets("Cour de Rohan / cour de Rouen, 6ème arrondissement") == ["Cour de Rohan", "cour de Rouen"]
    # A street written straight after another, unless a particle makes it part of the name.
    assert streets("Impasse de la Baudroirie Rue de Venise, 4ème arrondissement") == ["Impasse de la Baudroirie", "Rue de Venise"]
    assert streets("Rue du Pont-Neuf, 1er arrondissement") == ["Rue du Pont Neuf"]
    assert streets("Rue de la Cité, 4ème arrondissement") == ["Rue de la Cité"]


def test_view_from_with_vu():
    p = parse_caption("Pont-Marie vu du quai Bourbon, 4ème arrondissement, Paris.")
    assert p.streets == ["Pont Marie", "quai Bourbon"] and p.viewpoint == "quai Bourbon"


def test_house_number_written_inside_a_courtyard_name():
    p = parse_caption("Vieille cour du 21 rue Cassette, 6ème arrondissement")
    assert p.streets == ["rue Cassette"] and p.numbers == {"rue Cassette": "21"}


def test_rues_lists_each_street():
    p = parse_caption("Coin des rues de Seine et de l'Echaudé, 6ème arrondissement, Paris")
    assert p.streets == ["rue de Seine", "rue de l'Echaudé"]
    assert p.junction() == ("rue de Seine", "rue de l'Echaudé")
    assert parse_caption("Agencement des rues Fromentel, Saint-Hilaire et Charretière, 5ème arrondissement").streets == [
        "rue Fromentel", "rue Saint-Hilaire", "rue Charretière",
    ]


def test_every_arrondissement_is_kept():
    p = parse_caption("Transformation du quai Saint-Michel, 1er et 4ème arrondissement, Paris")
    assert (p.arrondissement, p.arrondissements) == (1, [1, 4])
    assert parse_caption("Petite chambre, rue de Belleville, 19ème ou 20ème arrondissement").arrondissements == [19, 20]
    assert parse_caption("Rue Lepic, 18ème arrondissement").arrondissements == [18]


def test_abbreviations():
    p = parse_caption("Boutique Empire 21 Fb St Honoré - (1902)")
    assert p.streets == ["rue du Faubourg St Honoré"] and p.numbers == {"rue du Faubourg St Honoré": "21"}
    assert parse_caption("Prison Saint-Lazare, Faubourg Saint-Denis, 10ème arrondissement").streets == ["rue du Faubourg Saint-Denis"]
    assert parse_caption("Quai des Gds Augustins 1903").streets == ["Quai des Grands Augustins"]
    assert parse_caption("Le Pont-Neuf, 6ème arrondissement, Paris.").streets == ["Pont Neuf"]


# ------------------------------------------------------------ matching

SULPICE = {"Place St Sulpice": (2.3346, 48.8508, 0.71, "75106", "Place Saint-Sulpice 75006 Paris")}


def test_own_name_at_a_low_score(tmp_path):
    # BAN scores "Place St Sulpice" low only because of the spelling.
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(SULPICE), history=history())
    m = g.place("Place St Sulpice, 6ème arrondissement", 1900)
    assert (m.label, m.precision, m.confidence) == ("Place Saint-Sulpice 75006 Paris", "street", round(CONFIDENCE["street_subject"] * MIN_SCORE, 2))
    # Another name at the same score is not taken.
    ban = Ban({"Place St Germain": (2.3346, 48.8508, 0.71, "75106", "Place Saint-Sulpice 75006 Paris")})
    assert Geocoder(cache_path=tmp_path / "d.json", fetch=ban, history=history()).place("Place St Germain, 6ème arrondissement", 1900) is None


PLACES = Places({
    "jardin du luxembourg": [{"name": "Jardin du Luxembourg", "kind": "public space", "center": [2.3372, 48.8462], "spread": 394, "arr": [6], "source": "bdtopo"}],
    "square du vert galant": [{"name": "Square du Vert Galant", "kind": "public space", "center": [2.3403, 48.8574], "spread": 54, "arr": [1], "source": "bdtopo"}],
    "pont neuf": [{"name": "Pont Neuf", "kind": "bridge", "center": [2.3415, 48.8573], "spread": 150, "arr": [1, 6], "source": "bdtopo"}],
    "avenue de la porte d italie": [{"name": "Avenue de la Porte d'Italie", "kind": "gate way", "center": [2.3589, 48.8166], "spread": 182, "arr": [13], "source": "voies"}],
})


def geocoder(tmp_path, streets=None, numbers=None):
    return Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(streets, numbers), history=history(), places=PLACES)


def test_gardens_squares_and_bridges(tmp_path):
    g = geocoder(tmp_path)
    m = g.place("Fontaine Médicis, Jardin du Luxembourg, 6ème arrondissement, Paris", 1900)
    assert (m.precision, m.method, m.label, (m.lon, m.lat), m.confidence) == ("place", "bdtopo", "Jardin du Luxembourg", (2.3372, 48.8462), 0.15)
    assert g.place("La Seine gelée, square Vert-Galant, 1er arrondissement", 1880).label == "Square du Vert Galant"  # particles aside
    assert g.place("Le Pont-Neuf, 6ème arrondissement, Paris.", 1900).confidence == 0.2
    assert g.place("Jardin du Luxembourg, 13ème arrondissement", 1900) is None  # not in that arrondissement, nor next to it


def test_a_place_named_after_a_street_does_not_take_over(tmp_path):
    g = geocoder(tmp_path, {"Port du Louvre": (2.3390, 48.8590, 0.95, "75101", "Port du Louvre 75001 Paris")})
    m = g.place("Port du Louvre, vers le Pont Neuf, 1er arrondissement, Paris", 1900)
    assert m.label == "Port du Louvre 75001 Paris"


def test_city_gate_on_the_avenue_named_after_it(tmp_path):
    m = geocoder(tmp_path).place("La Bièvre, porte d'Italie, 13ème arrondissement, Paris", 1900)
    assert (m.precision, m.method, m.label, m.street) == ("place", "gate-way", "Avenue de la Porte d'Italie", "porte d'Italie")


def test_other_arrondissement_the_caption_lists(tmp_path):
    ban = {"quai aux Fleurs": (2.3502, 48.8541, 0.95, "75104", "Quai aux Fleurs 75004 Paris")}
    m = geocoder(tmp_path, ban).place("Vieille maison, quai aux Fleurs, 1er et 4ème arrondissement, Paris", 1900)
    assert m.label == "Quai aux Fleurs 75004 Paris" and m.caption_arrondissement is None
    assert m.confidence == round(CONFIDENCE["street_subject"] * 0.95, 2)


MAIL = {"rue du Mail": (2.3427, 48.8670, 0.95, "75102", "Rue du Mail 75002 Paris")}
MAIL_5 = {"5 Rue du Mail": (2.3433, 48.8665, 0.96, "75102", "5 Rue du Mail 75002 Paris")}


def test_exact_name_in_a_neighbouring_arrondissement(tmp_path):
    # The rue du Mail is in the 2nd, next to the 1st the caption gives.
    m = geocoder(tmp_path, MAIL, MAIL_5).place("Hôtel le Tellier, 5 rue du Mail, 1er arrondissement, Paris", 1900)
    assert (m.label, m.precision, m.caption_arrondissement) == ("5 Rue du Mail 75002 Paris", "number", 1)
    assert m.confidence == round(CONFIDENCE["number"] * OTHER_ARRONDISSEMENT_FACTOR, 2)
    assert m.extra()["caption_arrondissement"] == 1


def test_no_exact_name_elsewhere_far_away_or_merely_close(tmp_path):
    # The 16th is not next to the 5th: the caption's street is another one, since gone.
    ban = {"Rue Fresnel": (2.2960, 48.8650, 0.97, "75116", "Rue Fresnel 75016 Paris")}
    assert geocoder(tmp_path, ban).place("Rue Fresnel, 5ème arrondissement, Paris", 1900) is None
    ban = {"rue du Mail": (2.3427, 48.8670, 0.85, "75102", "Rue du Mail 75002 Paris")}
    assert geocoder(tmp_path, ban).place("Hôtel, rue du Mail, 1er arrondissement, Paris", 1900) is None

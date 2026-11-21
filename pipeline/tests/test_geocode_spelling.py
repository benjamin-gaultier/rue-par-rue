"""Captions that misspell today's street: "rue Quimcampoix", "impasse de la Baudoirie", "rue Brise-Miche"."""

from rpr.geocode import CONFIDENCE, SPELLING_FACTOR, Geocoder, edits, parse_caption, spelling
from rpr.sources.streetnames import StreetHistory
from test_geocode_history import Ban


def test_edits_count_letters_changed_added_dropped_or_swapped():
    assert edits("quincampoix", "quincampoix") == 0
    assert edits("quimcampoix", "quincampoix") == 1  # one letter changed
    assert edits("vertbois", "verbois") == 1  # one dropped
    assert edits("guirsade", "guisarde") == 2  # two neighbours swapped, twice


def test_spelling_key():
    assert spelling("Rue Brise-Miche") == spelling("Rue Brisemiche") == ("rue", "brisemiche")
    assert spelling("Rue Vanneaux") == ("rue", "vaneaux")  # doubled letters count once
    assert spelling("place St Opportune") == ("place", "saintoportune")
    assert spelling("Rue des Prévôts") == ("rue", "prevots")  # particles aside


def test_typographic_apostrophe():
    assert parse_caption("Escalier, 7 rue de l’Estrapade, 5ème arrondissement, Paris.").streets == ["rue de l'Estrapade"]


def history():
    """Today's streets, as the junction table knows them."""
    meet = [[2.35, 48.86, 4]]
    return StreetHistory(junctions={"junctions": {
        "Rue Quincampoix": {"Rue de Venise": meet},
        "Rue Brisemiche": {"Rue du Cloître Saint-Merri": meet},
        "Rue du Dragon": {"Rue de Grenelle": meet},
        "Rue Barbet": {"Rue Bardet": meet},
        "Rue de Lanneau": {"Rue Valette": meet},
        "Rue des Canettes": {"Rue Guisarde": meet},
    }})


STREETS = {
    "Rue Quincampoix": (2.3510, 48.8610, 0.97, "75104", "Rue Quincampoix 75004 Paris"),
    "Rue Brisemiche": (2.3515, 48.8595, 0.96, "75104", "Rue Brisemiche 75004 Paris"),
    "Rue du Dragon": (2.3302, 48.8536, 0.96, "75106", "Rue du Dragon 75006 Paris"),
    "Rue Barbet": (2.3500, 48.8600, 0.96, "75104", "Rue Barbet 75004 Paris"),
    "Rue Bardet": (2.3520, 48.8620, 0.96, "75104", "Rue Bardet 75004 Paris"),
    "Rue de Lanneau": (2.3466, 48.8484, 0.97, "75105", "Rue de Lanneau 75005 Paris"),
    "Rue des Canettes": (2.3345, 48.8521, 0.97, "75106", "Rue des Canettes 75006 Paris"),
}
NUMBERS = {"36 Rue Quincampoix": (2.3507, 48.8614, 0.97, "75104", "36 Rue Quincampoix 75004 Paris")}


def geocoder(tmp_path):
    return Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(STREETS, NUMBERS), history=history())


def test_misspelt_street_at_its_number(tmp_path):
    m = geocoder(tmp_path).place("Porte, 36 rue Quimcampoix, 4ème arrondissement, Paris", 1900)
    assert (m.label, m.precision, m.street, m.respelt) == ("36 Rue Quincampoix 75004 Paris", "number", "rue Quimcampoix", True)
    assert m.confidence == round(CONFIDENCE["number"] * SPELLING_FACTOR, 2)
    assert m.extra()["respelt"] is True


def test_same_letters_are_not_a_respelling(tmp_path):
    # Only BAN's reading of "Brise-Miche" failed: the name is today's, not flagged.
    m = geocoder(tmp_path).place("Rue Brise-Miche, 4ème arrondissement, Paris.", 1900)
    assert (m.label, m.respelt, m.confidence) == ("Rue Brisemiche 75004 Paris", False, round(CONFIDENCE["street_subject"] * 0.96, 2))
    assert "respelt" not in m.extra()


def test_not_another_kind_of_way(tmp_path):
    # The cour du Dragon is not the rue du Dragon.
    assert geocoder(tmp_path).place("Cour du Dragon, 6ème arrondissement, Paris", 1900) is None


def test_nothing_when_two_streets_are_as_near(tmp_path):
    assert geocoder(tmp_path).place("Rue Barret, 4ème arrondissement, Paris", 1900) is None


def test_two_letters_only_for_long_names(tmp_path):
    # "vaneaux" has seven letters: one may differ, not two ("lanneau").
    assert geocoder(tmp_path).place("Impasse d'Ecosse, 5 rue Vanneaux, 5ème arrondissement, Paris", 1900) is None


def test_another_town_is_not_respelt_into_paris(tmp_path):
    assert geocoder(tmp_path).place("Rue des Cuvettes, Beauvais", 1900) is None

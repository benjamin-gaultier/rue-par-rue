"""Captions from other towns ("Maison rue Saint-Romain, Rouen") stay off the Paris street of the same name."""

import pytest

from rpr.geocode import Geocoder
from rpr.sources.streetnames import StreetHistory
from test_geocode_history import Ban

STREETS = {
    "rue Saint-Romain": (2.3222, 48.8478, 0.96, "75106", "Rue Saint-Romain 75006 Paris"),
    "rue Saint-Laurent": (2.3575, 48.8752, 0.96, "75110", "Rue Saint-Laurent 75010 Paris"),
    "rue des Lombards": (2.3493, 48.8597, 0.96, "75104", "Rue des Lombards 75004 Paris"),
    "rue Fabert": (2.3128, 48.8590, 0.96, "75107", "Rue Fabert 75007 Paris"),
    "rue Feutrier": (2.3462, 48.8862, 0.96, "75118", "Rue Feutrier 75018 Paris"),
    "rue Saint-Dominique": (2.3120, 48.8592, 0.96, "75107", "Rue Saint-Dominique 75007 Paris"),
    "rue du Puits de l'Ermite": (2.3540, 48.8423, 0.96, "75105", "Rue du Puits de l'Ermite 75005 Paris"),
    "rue de Sévigné": (2.3627, 48.8571, 0.96, "75104", "Rue de Sévigné 75004 Paris"),
    "rue Sauval": (2.3420, 48.8615, 0.96, "75101", "Rue Sauval 75001 Paris"),
    "rue de la Colonie": (2.3480, 48.8250, 0.96, "75113", "Rue de la Colonie 75013 Paris"),
    "rue Lepic": (2.3340, 48.8870, 0.96, "75118", "Rue Lepic 75018 Paris"),
    "rue des Ciseaux": (2.3339, 48.8533, 0.96, "75106", "Rue des Ciseaux 75006 Paris"),
    "boulevard Jourdan": (2.3380, 48.8200, 0.96, "75114", "Boulevard Jourdan 75014 Paris"),
}


def geocoder(tmp_path):
    return Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(STREETS), history=StreetHistory())


@pytest.mark.parametrize("caption", [
    "Maison rue Saint-Romain, Rouen",
    "Coin de la rue Saint-Romain, Rouen",
    "Maison, 25 rue Saint-Laurent, Beauvais",
    "Rue Feutrier, Beauvais",
    "Vieille maison, rue des Lombards, Compiègne",
    "Ancienne rue Fabert, Vanves.",
])
def test_a_caption_that_ends_on_another_town_is_not_placed(tmp_path, caption):
    assert geocoder(tmp_path).place(caption, 1900) is None


@pytest.mark.parametrize("caption, label", [
    ("Hôtel, Rue Saint-Dominique.", "Rue Saint-Dominique 75007 Paris"),  # ends on a Paris street
    ("Maison rue Saint-Romain, Paris", "Rue Saint-Romain 75006 Paris"),
    ("Maison rue Saint-Romain, 6ème arrondissement", "Rue Saint-Romain 75006 Paris"),
    ("Rue Lepic. Montmartre", "Rue Lepic 75018 Paris"),  # a village of Paris
    ("Rue Lepic, Montmartre", "Rue Lepic 75018 Paris"),
    ("Butte aux Cailles. / Rue de la Colonie.", "Rue de la Colonie 75013 Paris"),
    # Last words that are not a town: no comma before them.
    ("Cabaret coin de la rue du Puits de l'Ermite / et de la Pitié - Disparu / (1909)", "Rue du Puits de l'Ermite 75005 Paris"),
    ("Rue de Sévigné - Hôtel de Flesselles. 1898", "Rue de Sévigné 75004 Paris"),
    ("Rue Sauval, 1904", "Rue Sauval 75001 Paris"),
    ('"Petite gare de Sceaux ceinture sur le / Bd Jourdan"', "Boulevard Jourdan 75014 Paris"),
    ("Grille de Md de Vins, rue des Ciseaux.", "Rue des Ciseaux 75006 Paris"),
])
def test_paris_captions_keep_their_street(tmp_path, caption, label):
    m = geocoder(tmp_path).place(caption, 1900)
    assert m is not None and m.label == label

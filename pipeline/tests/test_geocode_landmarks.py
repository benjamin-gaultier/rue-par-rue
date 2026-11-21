"""Captions that name a building but no street: "Église Saint-Julien-le-Pauvre", "Hôtel Lambert"."""

import pytest

from rpr.geocode import LANDMARK_CONFIDENCE, LANDMARK_LARGE, Geocoder
from rpr.sources.monuments import Monuments
from test_geocode_history import Ban
from test_streetnames import history


def entry(name, arr, center, built=None, source="merimee", spread=0, *others):
    e = {"names": [name, *others], "kind": "", "center": list(center), "spread": spread, "arr": list(arr), "source": source, "ref": ""}
    if built:
        e["built"] = built
    return e


MONUMENTS = Monuments([
    entry("Église Saint-Julien-le-Pauvre", [5], (2.3471, 48.8519), 1150),
    entry("Église Saint-Julien-le-Pauvre", [5], (2.3473, 48.8520), source="bdtopo", spread=30),  # the same church
    entry("Église Saint-Pierre", [18], (2.3426, 48.8862), 1100),  # Montmartre
    entry("Église Saint-Pierre", [7], (2.3065, 48.8590), 1900),  # Gros-Caillou
    entry("Hôtel Lambert", [4], (2.3589, 48.8506), 1600),
    entry("Hôtel de Luynes", [6], (2.3432, 48.8539), 1500),
    entry("L'Hôtel-Dieu", [4], (2.3488, 48.8550), 1850),
    entry("Hôtel de Sens", [4], (2.3591, 48.8536), 1475),
    entry("Fontaine Médicis", [6], (2.3398, 48.8484), 1600),
    entry("Église Saint-Laurent", [10], (2.3582, 48.8758), 1400),
    entry("Moulin de la Galette", [18], (2.3376, 48.8875), 1600),
    entry("Palais du Louvre", [1], (2.3376, 48.8606), 1200, "bdtopo", 350),
    entry("Cimetière du Père Lachaise", [20], (2.3955, 48.8614), None, "bdtopo", 1100),
    entry("Château de Bagatelle", [16], (2.2484, 48.8714), 1700, "merimee", 0, "Parc de Bagatelle"),
])


def geocoder(tmp_path, streets=None):
    return Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(streets), history=history(), monuments=MONUMENTS)


def test_a_building_named_alone(tmp_path):
    m = geocoder(tmp_path).place("Nef de l'église Saint-Julien-le-Pauvre, 5ème arrondissement, Paris", 1900)
    assert (m.precision, m.method, m.role, m.label) == ("landmark", "merimee", "subject", "Église Saint-Julien-le-Pauvre")
    # The Mérimée point and the BD TOPO outline are one church: placed between them.
    assert (round(m.lon, 4), round(m.lat, 5)) == (2.3472, 48.85195)
    assert m.confidence == LANDMARK_CONFIDENCE[0][1]
    assert m.extra()["precision"] == "landmark" and m.extra()["from_caption"] == "Nef de l'église Saint-Julien-le-Pauvre"


def test_the_caption_pieces(tmp_path):
    m = geocoder(tmp_path).place("Palais du Louvre / cour Carrée, 1er arrondissement", 1900)
    assert m.label == "Palais du Louvre" and m.confidence == LANDMARK_CONFIDENCE[1][1]  # a large building


def test_homonyms_need_the_arrondissement(tmp_path):
    g = geocoder(tmp_path)
    assert g.place("Église Saint-Pierre, 18ème arrondissement", 1900).lat == 48.8862
    assert g.place("Église Saint-Pierre, 7ème arrondissement", 1910).lat == 48.8590
    assert g.place("Église Saint-Pierre", 1910) is None  # two churches: no telling which


def test_the_arrondissement_is_respected(tmp_path):
    # The Hôtel Lambert of the gazetteer is in the 4th: not the one this caption means.
    assert geocoder(tmp_path).place("Hôtel Lambert, 5ème arrondissement", 1900) is None


def test_not_before_it_was_built(tmp_path):
    g = geocoder(tmp_path)
    assert g.place("Église Saint-Pierre, 7ème arrondissement", 1880) is None  # the Gros-Caillou church is from 1900
    assert g.place("Église Saint-Pierre, 7ème arrondissement", None) is not None  # undated


def test_an_ancien_building_must_be_old_enough(tmp_path):
    g = geocoder(tmp_path)
    # Marville's "ancien Hôtel-Dieu" stood south of the parvis; today's was built from 1866.
    assert g.place("Ancien Hôtel-Dieu, 4ème arrondissement", 1865) is None
    assert g.place("Ancien hôtel de Sens, 4ème arrondissement", 1900).label == "Hôtel de Sens"
    assert g.place("Ancien hôtel de Sens, 4ème arrondissement", None).label == "Hôtel de Sens"  # 1475 + 50 <= 1850
    assert g.place("Hôtel-Dieu, Ile de la Cité, 4ème arrondissement", 1900).label == "L'Hôtel-Dieu"
    assert g.place("Hôtel-Dieu [ancien], 4ème arrondissement", 1865) is None  # Paris Musées' bracket


def test_a_bracketed_qualifier_means_another_building(tmp_path):
    g = geocoder(tmp_path)
    assert g.place("Hôtel Lambert [petit] / musée, 4ème arrondissement", 1900) is None
    assert g.place("Église Saint-Julien-le-Pauvre [la], 5ème arrondissement", 1900).label == "Église Saint-Julien-le-Pauvre"


def test_without_arrondissement(tmp_path):
    g = geocoder(tmp_path)
    assert g.place("Fontaine Médicis", 1900).label == "Fontaine Médicis"
    assert g.place("Moulin de la Galette, Montmartre", 1900).label == "Moulin de la Galette"  # a quarter of Paris
    assert g.place("Hôtel de Luynes.", 1876) is None  # a family's hôtel: there were several
    assert g.place("Extérieur, détail du décor de l'hôtel Dieu de Montlhéry", 1885) is None  # carried on
    assert g.place("Reproduction d'une gravure : église Saint-Laurent, Rouen", 1903) is None  # another town
    assert g.place("Église Saint-Laurent, Paris", 1903).label == "Église Saint-Laurent"


def test_carried_on_names_are_kept_with_an_arrondissement(tmp_path):
    m = geocoder(tmp_path).place("Église Saint-Pierre de Montmartre, 18ème arrondissement", 1900)
    assert m.label == "Église Saint-Pierre"


def test_large_sites_and_lower_ranks(tmp_path):
    g = geocoder(tmp_path)
    assert g.place("Cimetière du Père Lachaise, 20ème arrondissement", 1900) is None  # too large to pin anything down
    assert LANDMARK_LARGE < LANDMARK_CONFIDENCE[-1][1]
    # A park known only by a point may reach far from it.
    assert g.place("Parc de Bagatelle, bois de Boulogne, 16ème arrondissement", 1900).confidence == LANDMARK_LARGE


def test_streets_come_first(tmp_path):
    lambert = {"quai d'Anjou": (2.3590, 48.8515, 0.95, "75104", "Quai d'Anjou 75004 Paris")}
    m = geocoder(tmp_path, lambert).place("Hôtel Lambert, quai d'Anjou, 4ème arrondissement, Paris", 1900)
    assert (m.precision, m.label) == ("street", "Quai d'Anjou 75004 Paris")
    m = geocoder(tmp_path).place("Hôtel Lambert, quai d'Anjou, 4ème arrondissement, Paris", 1900)  # the quai is not found
    assert (m.precision, m.label) == ("landmark", "Hôtel Lambert")


@pytest.mark.parametrize("caption", ["Rue de l'Hôtel-Lambert, 4ème arrondissement", "Quai d'Anjou, vue vers l'hôtel Lambert, 4ème"])
def test_streets_and_views_named_after_a_building(tmp_path, caption):
    assert geocoder(tmp_path).place(caption, 1900) is None

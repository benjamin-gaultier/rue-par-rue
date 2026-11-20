"""Phase 3 matching: house numbers, corners, historical streets, confidence by precision."""

import urllib.parse

from rpr.geocode import CONFIDENCE, Geocoder, distance_m, parse_caption, same_street
from test_streetnames import history

ARRAS = "Vieille maison à l'angle de la rue d'Arras et de la rue Clopin, 5ème arrondissement, Paris."
PARCHEMINERIE = "Rue de la Parcheminerie, de la rue Saint-Jacques, 5ème arrondissement, Paris"
FEROU = "Ancienne maison, 9 rue Férou, 6ème arrondissement, Paris"
PONT_SAINT_MICHEL = "Pont Saint-Michel, le quai des Orfèvres à l'angle du boulevard du Palais, 1er arrondissement, Paris"


def test_house_numbers_bind_to_their_street():
    assert parse_caption(FEROU).numbers == {"rue Férou": "9"}
    assert parse_caption("Hôtel Chenizot (1740), 51 et 53 rue Saint-Louis-en-l'Île, 4ème arrondissement").numbers == {
        "rue Saint-Louis-en-l'Île": "51"
    }
    assert parse_caption("Cour, hôtel de Béthune Sully, 60-62 rue Saint-Antoine, 4ème arrondissement").numbers == {"rue Saint-Antoine": "60"}
    assert parse_caption("Cour, hôtel d'Aligre, 15, rue de l'Université, 7ème arrondissement").numbers == {"rue de l'Université": "15"}
    assert parse_caption("Enseigne, au 29 rue des Lombards, 4ème arrondissement").numbers == {"rue des Lombards": "29"}
    assert parse_caption("Rue Thouin, n° 9, 5ème arrondissement").numbers == {"Rue Thouin": "9"}


def test_years_and_arrondissements_are_not_house_numbers():
    assert parse_caption("Rue Mouffetard, 1909, rue Saint-Médard, 5ème arrondissement").numbers == {}
    assert parse_caption(ARRAS).numbers == {}


def test_junctions_and_quarters():
    assert parse_caption(PARCHEMINERIE).junction() == ("Rue de la Parcheminerie", "rue Saint-Jacques")
    assert parse_caption(ARRAS).junction() == ("rue d'Arras", "rue Clopin")
    # The corner is the street before the corner word and the one after it.
    assert parse_caption(PONT_SAINT_MICHEL).junction() == ("quai des Orfèvres", "boulevard du Palais")
    assert parse_caption("Réverbère, rue de Rivoli, angle de la rue Saint-Florentin").junction() == ("rue de Rivoli", "rue Saint-Florentin")
    assert parse_caption("Rue Mouffetard et rue Saint-Médard").junction() is None  # no corner word
    assert parse_caption("Vieille maison, île Saint-Louis").quarter == "île Saint-Louis"


def test_same_street():
    assert same_street("rue Saint-Louis-en-l'Île", "Rue Saint-Louis en l'Île")
    assert same_street("rue de Grammont", "Rue de Gramont")
    assert not same_street("rue Sainte-Croix", "Rue Sainte-Croix de la Bretonnerie")


class Ban:
    """Answers like the Géoplateforme for streets and house numbers, keyed by query text."""

    def __init__(self, streets=None, numbers=None):
        self.streets, self.numbers, self.calls = streets or {}, numbers or {}, []

    def __call__(self, url):
        self.calls.append(url)
        q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
        text, kind = q["q"][0].removesuffix(" Paris").lower(), q["type"][0]
        table = self.numbers if kind == "housenumber" else self.streets
        for key, (lon, lat, score, citycode, label) in table.items():
            if key.lower() == text:
                props = {"score": score, "citycode": citycode, "label": label}
                if kind == "housenumber":
                    number, street = label.split(" ", 1)
                    props |= {"housenumber": number, "street": street.rsplit(" ", 2)[0]}
                return {"features": [{"geometry": {"coordinates": [lon, lat]}, "properties": props}]}
        return {"features": []}


FEROU_STREET = {"rue Férou": (2.3343, 48.8501, 0.96, "75106", "Rue Férou 75006 Paris")}
FEROU_9 = {"9 Rue Férou": (2.334065, 48.849839, 0.96, "75106", "9 Rue Férou 75006 Paris")}


def test_house_number_found_today(tmp_path):
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(FEROU_STREET, FEROU_9), history=history())
    m = g.place(FEROU, 1910)
    assert (m.precision, m.method, m.number, m.confidence) == ("number", "ban", "9", CONFIDENCE["number"])
    assert (m.lon, m.lat) == (2.334065, 48.849839)
    assert m.extra()["geocoded_street"] == "9 Rue Férou 75006 Paris"


def test_missing_house_number_falls_back_to_the_street(tmp_path):
    m = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(FEROU_STREET), history=history()).place(FEROU, 1910)
    assert m.precision == "street" and m.confidence == round(CONFIDENCE["street_subject"] * 0.96, 2)


def test_demolished_street_is_placed_where_it_was_in_1836(tmp_path):
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(), history=history())
    m = g.place("Rue des Orties-Saint-Honoré, 1er arrondissement, Paris", 1866)
    assert (m.method, m.precision, m.historical, m.label) == ("vasserot-1836", "street", True, "Rue des Orties")
    assert m.confidence == CONFIDENCE["street_subject"]
    m = g.place("Maison, 1 rue du Clos-Georgeau, 1er arrondissement, Paris", 1866)
    assert (m.precision, m.number, m.confidence, (m.lon, m.lat)) == ("number", "1", CONFIDENCE["number_1836"], (2.3352, 48.8661))


def test_view_from_a_street_corner(tmp_path):
    # Today's rue Sainte-Anne is long; the 1836 points of the two streets meet at the corner.
    ban = Ban({"rue Sainte-Anne": (2.33545, 48.866106, 0.97, "75101", "Rue Sainte-Anne 75001 Paris")})
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=ban, history=history())
    m = g.place("Rue du Clos-Georgeau, vue prise de la rue Sainte-Anne, 1er arrondissement, Paris.", 1866)
    assert (m.precision, m.role, m.confidence) == ("corner", "corner", CONFIDENCE["corner"])
    assert distance_m((m.lon, m.lat), (2.3353, 48.86615)) < 1  # between the two nearest addresses
    assert m.label == "Rue Clos Georgeot / Rue Sainte Anne"


def test_corner_of_streets_laid_out_after_1836(tmp_path):
    # The boulevard du Palais (1858) has no 1836 address points: today's outlines give the corner.
    ban = Ban({"quai des Orfèvres": (2.3445, 48.8556, 0.97, "75101", "Quai des Orfèvres 75001 Paris")})
    m = Geocoder(cache_path=tmp_path / "c.json", fetch=ban, history=history()).place(PONT_SAINT_MICHEL, 1900)
    assert (m.precision, m.method, m.role, m.confidence) == ("corner", "street-outlines", "corner", CONFIDENCE["corner"])
    assert (m.lon, m.lat) == (2.3448, 48.854425)
    assert m.label == "Quai des Orfèvres / Boulevard du Palais" and m.ambiguous == 0


def test_1836_corner_comes_first(tmp_path):
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(), history=history())
    m = g.place("Rue du Clos-Georgeau, vue prise de la rue Sainte-Anne, 1er arrondissement, Paris.", 1866)
    assert m.method == "vasserot-1836"  # today's outlines would put it at (2.3360, 48.8665)


def test_corner_of_streets_that_meet_twice_is_flagged(tmp_path):
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(), history=history())
    m = g.place("Rue de l'Hôtel-de-Ville, vue prise du quai de l'Hôtel-de-Ville, 4ème arrondissement", 1900)
    assert (m.precision, m.method, m.ambiguous) == ("corner", "street-outlines", 1)
    assert m.confidence == round(CONFIDENCE["corner"] * 0.6, 2)
    # Not in the arrondissement the caption gives: no corner, and nothing else to place it on.
    assert g.place("Rue de l'Hôtel-de-Ville, vue prise du quai de l'Hôtel-de-Ville, 5ème arrondissement", 1900) is None


def test_corner_through_a_former_name_or_a_spelling(tmp_path):
    h = history()
    h.former["rue de la barillerie"] = [{"name": "rue de la Barillerie", "arr": [1, 4], "to": ["boulevard du Palais"]}]
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(), history=h)
    m = g.place("Rue de la Barillerie, à l'angle du quai des Orfèvres, 1er arrondissement", 1855)
    assert (m.method, m.label) == ("street-outlines", "Boulevard du Palais / Quai des Orfèvres")
    m = g.place("Angle de la rue Madame et de la rue Mézières, 6ème arrondissement", 1900)
    assert (m.method, m.label) == ("street-outlines", "Rue Madame / Rue de Mézières")


def test_no_corner_where_outlines_do_not_meet(tmp_path):
    ban = Ban({"rue Madame": (2.3318, 48.8495, 0.97, "75106", "Rue Madame 75006 Paris")})
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=ban, history=history())
    assert g.place("Angle de la rue Madame et du boulevard du Palais, 6ème arrondissement", 1900).precision == "street"
    # A known old name is never moved to a lookalike: the rue des Orties of 1836 is not today's "rue d'Orties".
    assert g.place("Angle de la rue des Orties et de la rue Sainte-Anne, 1er arrondissement", 1850).method != "street-outlines"


def test_former_name_goes_to_todays_street_and_flags_ambiguity(tmp_path):
    ban = Ban({"rue de Lutèce": (2.3468, 48.8551, 0.95, "75104", "Rue de Lutèce 75004 Paris")})
    m = Geocoder(cache_path=tmp_path / "c.json", fetch=ban, history=history()).place("Rue de Constantine, 4ème arrondissement", 1864)
    assert (m.method, m.current_name, m.label) == ("former-name", "Rue de Lutèce", "Rue de Lutèce 75004 Paris")
    assert m.ambiguous == 1  # also part of place Louis Lépine
    assert m.confidence == round(CONFIDENCE["former_subject"] * 0.8 * 0.6, 2)


def test_homonym_in_use_elsewhere_at_the_time_is_flagged(tmp_path):
    ban = Ban({"rue de Constantine": (2.3149, 48.8595, 0.97, "75107", "Rue de Constantine 75007 Paris")})
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=ban, history=history())
    early = g.place("Rue de Constantine", 1864)  # the Cité street still had that name
    late = g.place("Rue de Constantine", 1900)
    assert early.ambiguous == 1 and late.ambiguous == 0
    assert early.confidence < late.confidence


def test_known_old_name_is_not_moved_to_a_lookalike(tmp_path):
    ban = Ban({"rue Sainte-Croix": (2.3549, 48.8582, 0.88, "75104", "Rue Sainte-Croix de la Bretonnerie 75004 Paris")})
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=ban, history=history())
    assert g.place("Rue Sainte-Croix, 4ème arrondissement") is not None  # unknown here as an old name: lookalike kept
    assert g.place("Rue Sainte-Croix, 9ème arrondissement") is None  # an old 9th-arrondissement street: not moved
    # Without history the lookalike is accepted, as before phase 3.
    assert Geocoder(cache_path=tmp_path / "d.json", fetch=ban).place("Rue Sainte-Croix, 4ème arrondissement") is not None


def test_quarter_only_when_no_street(tmp_path):
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(), history=history())
    m = g.place("Vieille maison, île de la Cité")
    assert (m.precision, m.confidence, m.label) == ("quarter", CONFIDENCE["quarter"], "Cite")
    assert g.place("Vieille maison") is None  # nothing named: nothing invented


def test_number_beats_street_and_viewpoint(tmp_path):
    streets = {**FEROU_STREET, "rue de Vaugirard": (2.33, 48.848, 0.97, "75106", "Rue de Vaugirard 75006 Paris")}
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=Ban(streets, FEROU_9), history=history())
    m = g.place("Maison, 9 rue Férou, vue prise de la rue de Vaugirard, 6ème arrondissement", 1910)
    assert m.precision == "number"


def test_lookups_are_cached(tmp_path):
    ban = Ban(FEROU_STREET, FEROU_9)
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=ban, history=history())
    g.place(FEROU, 1910)
    g.save()
    again = Geocoder(cache_path=tmp_path / "c.json", fetch=ban, history=history())
    assert again.place(FEROU, 1910).precision == "number" and again.requests == 0

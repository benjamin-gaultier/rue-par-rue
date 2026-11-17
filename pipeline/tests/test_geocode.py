from rpr.geocode import Geocoder, parse_caption

# Captions copied from the Paris Musées catalogue.
OPERA = "Passage de l'Opéra, vue prise de la rue Lepeletier, 9ème arrondissement, Paris."
SULLY = "Boulevard Henri IV (de la rue de Sully)"
ARRAS = "Vieille maison à l'angle de la rue d'Arras et de la rue Clopin, 5ème arrondissement, Paris."
CHANTIER = "Percement de l'avenue de l'Opéra : chantier de la rue d'Argenteuil près de la rue Saint-Honoré, 1er arrondissement, Paris"
PARCHEMINERIE = "Rue de la Parcheminerie, de la rue Saint-Jacques, 5ème arrondissement, Paris"


def test_viewpoint_comes_first():
    p = parse_caption(OPERA)
    assert p.arrondissement == 9 and p.citycode == "75109"
    assert p.candidates() == [("rue Lepeletier", "viewpoint"), ("Passage de l'Opéra", "subject")]
    assert parse_caption(SULLY).candidates()[0] == ("rue de Sully", "viewpoint")
    assert parse_caption(PARCHEMINERIE).candidates()[0] == ("rue Saint-Jacques", "viewpoint")


def test_several_streets_in_order():
    assert parse_caption(ARRAS).streets == ["rue d'Arras", "rue Clopin"]
    assert parse_caption(CHANTIER).streets == ["avenue de l'Opéra", "rue d'Argenteuil", "rue Saint-Honoré"]


def test_no_street():
    assert parse_caption("Les Halles Centrales, nouvelles Halles de Baltard, Paris").streets == []


class FakeGeocoder:
    """Answers like the Géoplateforme geocoder for a few streets."""

    def __init__(self, table):
        self.table, self.calls = table, []

    def __call__(self, url):
        self.calls.append(url)
        for needle, (lon, lat, score, citycode, label) in self.table.items():
            if needle in url:
                return {"features": [{"geometry": {"coordinates": [lon, lat]}, "properties": {"score": score, "citycode": citycode, "label": label}}]}
        return {"features": []}


def test_low_scores_fall_through_to_next_street(tmp_path):
    fake = FakeGeocoder({
        "Lepeletier": (2.348, 48.880, 0.40, "75109", "Rue Pétrelle 75009 Paris"),
        "Passage": (2.332, 48.871, 0.48, "75109", "Place de l'Opéra 75009 Paris"),
    })
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=fake)
    assert g.place(OPERA) is None  # renamed and demolished streets stay unplaced


def test_wrong_arrondissement_is_rejected_and_cache_is_used(tmp_path):
    fake = FakeGeocoder({
        "Arras": (2.3516, 48.8474, 0.97, "75105", "Rue d'Arras 75005 Paris"),
        "Clopin": (2.35, 48.84, 0.95, "75116", "Rue Clopin elsewhere"),
    })
    g = Geocoder(cache_path=tmp_path / "c.json", fetch=fake)
    m = g.place(ARRAS)
    assert m and m.label.startswith("Rue d'Arras") and m.role == "subject"
    g.save()
    again = Geocoder(cache_path=tmp_path / "c.json", fetch=fake)
    again.place(ARRAS)
    assert again.requests == 0

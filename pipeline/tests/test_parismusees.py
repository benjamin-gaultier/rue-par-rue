from rpr.geocode import Geocoder
from rpr.sources import parismusees

# Shape of a NodeOeuvre returned by the WORKS query (values from a real Atget record).
WORK = {
    "title": "Vieille maison à l'angle de la rue d'Arras et de la rue Clopin, 5ème arrondissement, Paris.",
    "fieldUrlAlias": "musee-carnavalet/oeuvres/vieille-maison-a-l-angle-de-la-rue-d-arras-et-de-la-rue-clopin-5eme",
    "fieldLrefAdlib": 320086437,
    "fieldOeuvreNumInventaire": "PH31389",
    "fieldDateProduction": {"startYear": 1909, "endYear": None, "processed": "En 1909"},
    "fieldOeuvreGeolocSujet": None,
    "fieldOeuvreAuteurs": [{"entity": {"fieldAuteurAuteur": {"entity": {"name": "Atget, Eugène (Jean Eugène Auguste Atget, dit)"}}}}],
    "fieldVisuels": [
        {"entity": {"publicUrl": "https://www.parismuseescollections.paris.fr/sites/default/files/atoms/images/CAR/aze_carph031389_001.jpg", "fieldImageLibre": True}},
        {"entity": {"publicUrl": None, "fieldImageLibre": None}},
    ],
}


class Fake:
    def __call__(self, url):
        if "Arras" in url:
            return {"features": [{"geometry": {"coordinates": [2.351612, 48.84739]}, "properties": {"score": 0.97, "citycode": "75105", "label": "Rue d'Arras 75005 Paris"}}]}
        return {"features": []}


def test_creator_name():
    assert parismusees.creator_name("Atget, Eugène (Jean Eugène Auguste Atget, dit)") == "Eugène Atget"
    assert parismusees.creator_name("Marville, Charles") == "Charles Marville"


def test_styled_url():
    url = "https://www.parismuseescollections.paris.fr/sites/default/files/atoms/images/CAR/x.jpg"
    assert parismusees.styled(url, "pm_notice") == (
        "https://www.parismuseescollections.paris.fr/sites/default/files/styles/pm_notice/public/atoms/images/CAR/x.jpg"
    )


def test_work_to_photo(tmp_path):
    stats = {}
    p = parismusees.to_photo(WORK, Geocoder(cache_path=tmp_path / "c.json", fetch=Fake()), stats)
    assert p is not None and stats == {}
    assert p.id == "parismusees:320086437"
    assert (p.year, p.creator, p.license) == (1909, "Eugène Atget", "CC0-1.0")
    assert p.pose == "geocoded" and 0 < p.confidence < 0.3
    assert p.thumb.endswith("/styles/pm_notice/public/atoms/images/CAR/aze_carph031389_001.jpg")
    assert p.url.startswith("https://www.parismuseescollections.paris.fr/fr/musee-carnavalet/")
    assert p.problems() == []


def test_work_without_free_image_is_skipped(tmp_path):
    stats = {}
    work = {**WORK, "fieldVisuels": [{"entity": {"publicUrl": "https://x/y.jpg", "fieldImageLibre": False}}]}
    assert parismusees.to_photo(work, Geocoder(cache_path=tmp_path / "c.json", fetch=Fake()), stats) is None
    assert stats == {"no free image": 1}

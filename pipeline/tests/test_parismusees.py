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


def test_works_cache_round_trip_is_stable(tmp_path):
    path = tmp_path / "works.json.gz"
    other = {**WORK, "fieldLrefAdlib": 1}
    parismusees.save_works([WORK, other], path)
    first = path.read_bytes()
    assert parismusees.load_works(path) == [other, WORK]  # sorted by id
    parismusees.save_works([other, WORK], path)
    assert path.read_bytes() == first


def test_failing_page_is_fetched_in_halves(monkeypatch):
    import urllib.error

    calls = []

    def fake_query(q, variables):
        calls.append((variables["offset"], variables["limit"]))
        if variables["limit"] > 50:
            raise urllib.error.HTTPError("x", 502, "Bad Gateway", {}, None)
        n = min(variables["limit"], 120 - variables["offset"])
        return {"nodeQuery": {"count": 120, "entities": [{"id": variables["offset"] + i} for i in range(n)]}}

    monkeypatch.setattr(parismusees, "query", fake_query)
    monkeypatch.setattr(parismusees.time, "sleep", lambda s: None)
    got = list(parismusees.works("Atget", log=lambda m: None))
    assert [w["id"] for w in got] == list(range(120))
    assert calls[:3] == [(0, 100), (0, 50), (50, 50)]


def test_auth_error_is_not_retried_in_pieces(monkeypatch):
    import urllib.error

    import pytest

    def fake_query(q, variables):
        raise urllib.error.HTTPError("x", 403, "Forbidden", {}, None)

    monkeypatch.setattr(parismusees, "query", fake_query)
    with pytest.raises(urllib.error.HTTPError):
        parismusees.page("Atget", 0, 100, log=lambda m: None)

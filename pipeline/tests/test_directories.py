"""The trade directories of 1835 and 1837, matched to the 1836 buildings."""

import json

import pytest

from rpr import areas
from rpr.sources import directories as d


def row(**over):
    r = {
        "uuid": "x",
        "text_ocr": "Rogé, épicier, Marmousets, 29.\n",
        "per": "'Rogé'",
        "act": "'épicier'",
        "address.number": "29",
        "address.name": "Marmousets",
        "geocoding.response.layer": "address",
        "geocoding.response.number": "29",
        "geocoding.response.name": "Rue Des Marmousets À La Cité",
        "geocoding.response.source": d.ATLAS_1836,
        "geocoding.response.geom": "POINT (2.3497 48.8541)",
        "source.publication_year": "1835",
        "source.view_link": "https://gallica.bnf.fr/ark:/12148/bpt6k995082w/f306",
    }
    r.update(over)
    return r


def test_an_entry_keeps_its_name_trade_and_address():
    e, why = d.entry_of(row())
    assert why == "ok"
    assert e["name"] == "Rogé" and e["act"] == "épicier" and e["number"] == "29"
    assert e["at"] == (2.3497, 48.8541) and e["year"] == 1835


@pytest.mark.parametrize(
    "over, why",
    [
        ({"geocoding.response.layer": "street"}, "street only"),
        ({"geocoding.response.source": "atlas_verniquet_1791"}, "not on the 1836 atlas"),
        ({"geocoding.response.number": "16bis"}, "number not found"),
        ({"per": ""}, "no name"),
        # OCR blocks can hold several entries: the name and the number must share a line.
        ({"text_ocr": "Rogé, épicier, Marmousets, 2.\nRoger, vins, Calandre, 29.\n"}, "name and address not on one line"),
        # The number read by the parser is cut short ("252" read as "25").
        ({"text_ocr": "Rogé, épicier, Marmousets, 252.\n", "address.number": "25", "geocoding.response.number": "25"}, "name and address not on one line"),
    ],
)
def test_doubtful_entries_are_left_out(over, why):
    assert d.entry_of(row(**over)) == (None, why)


def test_an_activity_on_another_line_is_dropped_not_misattributed():
    e, _ = d.entry_of(row(text_ocr="Rogé, Marmousets, 29.\nX, épicier, Calandre, 3.\n"))
    assert e["act"] == ""


def test_mentions_and_names():
    assert d.mentions("'Adam (Ve','imprim.'") == ["Adam (Ve", "imprim."]
    assert d.mentions("'agent, à l''Institut'") == ["agent, à l'Institut"]
    assert d.clean_name("Adam (Ve") == "Adam (Ve)"
    assert d.clean_name(" Agasse, ") == "Agasse"


@pytest.mark.parametrize(
    "act, trade",
    [
        ("md de vin", "wine"), ("vins", "wine"), ("limonadier", "cafe"), ("boulanger", "bakery"),
        ("h. garni", "hotel"), ("épic", "grocer"), ("épicier", "grocer"), ("lib", "books"),
        ("libraire-éditeur", "books"), ("bouchère", "butcher"), ("merceries", "mercer"),
        ("horloger", "clocks"), ("bijoutier", "gold"), ("charcutier", "pork"), ("pharmacien", "pharmacy"),
        ("avocat", None), ("f. de vinaigre", None), ("épices", None), ("commiss. à l'hôtel", None),
    ],
)
def test_trades_drawn_on_shopfronts(act, trade):
    assert d.trade_of(act) == trade


def test_trades_are_those_the_app_letters():
    signs = (areas.paths.REPO_ROOT / "web" / "src" / "signs.ts").read_text(encoding="utf-8")
    for _, trade in d.TRADE_WORDS:
        assert f"name: '{trade}'" in signs, trade


def test_street_names():
    assert d.display_street("Rue De L'Ecole De Médecine") == "Rue de l'Ecole de Médecine"
    assert d.display_street("Quai Des Orfèvres") == "Quai des Orfèvres"
    assert d.street_keys("Rue Du Paon Saint André") == ["rue du paon saint andre", "rue du paon saint", "rue du paon"]
    assert "rue saint andre des arcs" in d.street_keys("Rue Saint André Des Arts")


def test_the_house_is_placed_at_the_vasserot_point_of_its_number():
    streets = {
        "rue des marmousets": [
            {"name": "Rue des Marmousets", "numbers": {"29": [2.34972, 48.85412]}},
            # A homonym across Paris is too far from SoDUCo's point.
            {"name": "Rue des Marmousets", "numbers": {"29": [2.36, 48.86]}},
        ]
    }
    e, _ = d.entry_of(row())
    assert d.address_point(streets, e) == ((2.34972, 48.85412), "Rue des Marmousets", "vasserot")
    # No Vasserot point for the number: SoDUCo's point on Jacoubet's atlas.
    e2, _ = d.entry_of(row(**{"address.number": "31", "geocoding.response.number": "31", "text_ocr": "Rogé, épicier, Marmousets, 31.\n"}))
    assert d.address_point(streets, e2) == ((2.3497, 48.8541), "Rue des Marmousets à la Cité", "jacoubet")


def test_the_committed_file_names_buildings_of_the_model():
    data = json.loads(areas.area_file("cite", "directories").read_text(encoding="utf-8"))
    model = json.loads(areas.area_file("cite", "model").read_text(encoding="utf-8"))
    ids = {f["properties"]["id"] for f in model["features"]}
    assert data["years"] == list(d.YEARS) and "Etalab" in data["licence"]
    assert len(data["buildings"]) > 1000
    assert set(data["buildings"]) <= ids


def test_one_person_printed_in_both_years_is_one_listing():
    listings: dict = {}
    a = {"name": "Tournemine", "act": "greffier C", "page": "p1"}
    b = {"name": "Tournemine", "act": "greffier C. de cass", "page": "p2"}
    c = {"name": "Tournemine", "act": "avocat", "page": "p3"}
    first = d.same_listing(listings, a, "13 Place Dauphine")
    assert d.same_listing(listings, b, "13 Place Dauphine") is first
    assert first["act"] == "greffier C. de cass"
    assert d.same_listing(listings, c, "13 Place Dauphine") is not first
    assert d.same_listing(listings, a, "14 Place Dauphine") is not first
    assert len(listings) == 3

"""The gazetteer of named landmarks (Mérimée, BD TOPO) and how caption words are matched to it."""

from rpr.sources.monuments import (
    Monuments,
    _bdtopo_names,
    bdtopo_entries,
    built_from,
    distinctive,
    forms,
    key,
    merimee_entries,
    names_from_title,
)
from rpr.sources.places import Arrondissements


def square(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


# Two made-up arrondissements either side of lon 2.35.
ARRS = Arrondissements([
    {"properties": {"c_ar": 5}, "geometry": square(2.30, 48.80, 2.35, 48.90)},
    {"properties": {"c_ar": 4}, "geometry": square(2.35, 48.80, 2.40, 48.90)},
])


# ------------------------------------------------------------ names


def test_titles_give_every_name_of_the_building():
    assert names_from_title("Hôtel de Gournay ou de Mortemart, dit aussi d'Aguesseau") == [
        "Hôtel de Gournay", "Hôtel de Mortemart", "Hôtel d'Aguesseau",
    ]
    assert names_from_title("Anciens hôtels de Rohan et Soubise, actuellement Archives Nationales") == [
        "hôtel de Rohan", "hôtel Soubise", "Archives Nationales",
    ]
    assert names_from_title("Fontaine dite Trogneux, puis de Charonne") == ["Fontaine Trogneux", "Fontaine de Charonne"]
    # A later use written as a description is not a name.
    assert names_from_title("Ancien hôtel de Choiseul-Praslin, devenu immeuble de la Caisse Nationale d'Epargne") == [
        "hôtel de Choiseul-Praslin",
    ]
    assert names_from_title("Musée Hébert (ancien petit hôtel de Montmorency)") == ["Musée Hébert", "petit hôtel de Montmorency"]
    # "et" inside a name is not two buildings.
    assert names_from_title("Conservatoire National des Arts et Métiers") == ["Conservatoire National des Arts et Métiers"]


def test_only_distinctive_names_are_kept():
    for name in ["Hôtel Lambert", "Conciergerie", "Sainte-Chapelle", "Fontaine des Innocents", "Église Saint-Sulpice"]:
        assert distinctive(name), name
    for name in [
        "Fontaine publique", "Immeuble", "Hôtel néogothique",  # plain descriptions
        "Boulangerie", "Librairie",  # kinds of shop that Mérimée titles give as names
        "Fontaine Wallace", "Colonne Morris",  # everywhere
        "Saint-Marc",  # a church, a street or a quarter
        "Statue de Jeanne d'Arc",  # statues move and stand in museums
        "Mairie de Paris", "1er Arrondissement", "Fers",  # nothing left, or too short to be a name
    ]:
        assert not distinctive(name), name


def test_lookup_forms():
    assert key("Le Panthéon") == "pantheon"
    assert forms(key("Hôtel Dargenson")) & forms(key("Hôtel d'Argenson"))
    assert forms(key("Hôtel de Choiseul Praslin")) & forms(key("hôtel de Choiseul-Praslin"))
    # The owner's title is not part of the hôtel's name.
    assert "hotel villars" in forms(key("Hôtel du duc de Villars"))


def test_building_century():
    assert built_from("3e quart 19e siècle") == 1850
    assert built_from("17e siècle;2e moitié 18e siècle") == 1600
    assert built_from("1ère moitié 20e siècle") == 1900
    assert built_from("") is None


# ------------------------------------------------------------ entries


def merimee(title, commune="Paris 5e Arrondissement", point="48.85,2.32", kind="église", century="17e siècle", other=""):
    return {
        "Reference": "PA0", "Titre_editorial_de_la_notice": title, "Autre_appellation_de_l_edifice": other,
        "Denomination_de_l_edifice": kind, "Commune_forme_index": commune, "coordonnees_au_format_WGS84": point,
        "Siecle_de_la_campagne_principale_de_construction": century,
    }


def test_merimee_entries():
    rows = [
        merimee("Église Saint-Julien-le-Pauvre", other="Chapelle de l'Hôtel-Dieu"),
        merimee("Place des Vosges", kind="place"),  # a place is the street geocoder's
        merimee("Passage des Panoramas", kind="passage couvert;immeuble"),
        merimee("Fontaine publique", kind="fontaine"),  # no proper name
        merimee("Hôtel Lambert", commune="Paris 4e Arrondissement", point="48.85,2.36", kind="hôtel"),
    ]
    out = merimee_entries(rows, ARRS)
    assert [e["names"] for e in out] == [["Église Saint-Julien-le-Pauvre", "Chapelle de l'Hôtel-Dieu"], ["Hôtel Lambert"]]
    assert out[0] | {"names": None} == {
        "names": None, "kind": "église", "center": [2.32, 48.85], "spread": 0, "arr": [5], "source": "merimee", "ref": "PA0",
        "built": 1600,
    }
    assert out[1]["arr"] == [4]


def test_bdtopo_names_keep_parts_that_name_a_building():
    assert _bdtopo_names("Musée Carnavalet - Musée d'Histoire de Paris") == [
        "Musée Carnavalet - Musée d'Histoire de Paris", "Musée Carnavalet", "Musée d'Histoire de Paris",
    ]
    assert "1er Arrondissement" not in _bdtopo_names("Mairie de Paris - 1er Arrondissement")
    assert "Annexe" not in _bdtopo_names("Lycée Abbé Grégoire - Annexe")


def zone(name, geom, nature="Culte chrétien", detail="Eglise", categorie="Religieux"):
    return {"properties": {"toponyme": name, "nature": nature, "nature_detaillee": detail, "categorie": categorie, "cleabs": "Z"},
            "geometry": geom}


def test_bdtopo_entries():
    zones = [
        zone("Église Saint-Médard", square(2.320, 48.840, 2.321, 48.841)),
        zone("Église Saint-Médard", square(2.321, 48.840, 2.322, 48.841)),  # another piece of the same site
        zone("Poste de Paris - Louvre", square(2.34, 48.86, 2.341, 48.861), nature="Poste", detail="Bureau de poste"),
        zone("Jeanne d'Arc", square(2.33, 48.86, 2.331, 48.861), nature="Monument", detail=None),  # a statue
        zone("Square du Temple", square(2.36, 48.86, 2.361, 48.861), nature="Espace public", detail="Square"),
        zone("Musée de Cluny", square(2.20, 48.86, 2.201, 48.861), nature="Musée", detail=None),  # outside Paris
    ]
    cemeteries = [{"properties": {"toponyme": "Cimetière du Montparnasse", "cleabs": "C"}, "geometry": square(2.32, 48.835, 2.33, 48.84)}]
    out = bdtopo_entries(zones, cemeteries, ARRS)
    assert sorted(n for e in out for n in e["names"]) == ["Cimetière du Montparnasse", "Église Saint-Médard"]
    church = next(e for e in out if e["names"] == ["Église Saint-Médard"])
    assert church["center"] == [2.321, 48.8405] and church["arr"] == [5] and church["source"] == "bdtopo"


# ------------------------------------------------------------ mentions


def entry(*names, arr=(5,), center=(2.32, 48.85), built=None):
    e = {"names": list(names), "kind": "", "center": list(center), "spread": 0, "arr": list(arr), "source": "merimee", "ref": ""}
    if built:
        e["built"] = built
    return e


GAZETTEER = Monuments([
    entry("Abbaye Saint-Germain-des-Prés"),
    entry("Le Panthéon"),
    entry("Hôtel de Villars"),
    entry("Petit Hôtel de Villars"),
    entry("Hôtel-Dieu", built=1850),
    entry("Cathédrale Notre-Dame de Paris"),
])


def names(text):
    return [m.words for m in GAZETTEER.mentions(text)]


def test_mentions_left_to_right_longest_first():
    assert names("Restes d'un pilier de l'abbaye de Saint Germain des Près") == ["abbaye de saint germain des pres"]
    assert names("Carré Saint-Etienne-du-Mont, vue prise du Panthéon") == ["pantheon"]  # never starting on "du"
    assert names("Cathédrale Notre Dame de Paris") == ["cathedrale notre dame de paris"]


def test_mentions_after_a_way_or_vers_are_not_the_building():
    assert names("Rue de l'Abbaye Saint-Germain-des-Prés") == []
    assert names("Place du Panthéon") == []
    assert names("Rue Soufflot, vue vers le Panthéon") == []


def test_mentions_flag_former_and_carried_on_names_and_skip_qualified_ones():
    [m] = GAZETTEER.mentions("Ancien Hôtel-Dieu")
    assert m.former and not m.carried_on
    [m] = GAZETTEER.mentions("détail du décor de l'hôtel Dieu de Montlhéry")
    assert m.carried_on
    assert names("Petit Hôtel de Villars") == ["petit hotel de villars"]
    assert names("Petit hôtel du duc de Villars") == []  # the small hôtel, not the Hôtel de Villars
    [m] = GAZETTEER.mentions("Hôtel du duc de Villars, rue de Grenelle")
    assert m.words == "hotel du duc de villars" and not m.carried_on


def test_a_bracketed_word_qualifies_the_name_before_it():
    assert names("Hôtel de Villars [petit] / musée") == ["petit hotel de villars"]
    assert names("Hôtel du Panthéon [grand]") == []  # not known: not the Panthéon either
    [m] = GAZETTEER.mentions("Cloître [ancien] / Hôtel-Dieu [ancien]")
    assert m.former
    # Other bracketed words only end the name.
    [m] = GAZETTEER.mentions("Hôtel-Dieu [dit] Saint-Jean")
    assert m.words == "hotel dieu" and not m.carried_on

import pytest

from rpr.geocode import distance_m
from rpr.sources import streetnames
from rpr.sources.streetnames import StreetHistory, build_former, build_junctions, build_vasserot, norm, parse_history, sound

# Histories copied from the City of Paris "dénominations caduques" records.
RENAMED = "Actuellement rue de la Tacherie."
DECREED = "Dénommée avenue de Constantine par décret impérial du 22 mai 1865. Actuellement rue de Lutèce et partie de la place Louis Lépine."
PART = "Ou Juivrerie. Actuellement partie de la rue de la Cité et de la place Louis Lépine."
DEMOLISHED = "Supprimée vers 1860. Elle était située dans l'île de la Cité et allait de la rue de la Cité à la rue de la Barillerie."
FOOTPRINT = "Supprimée. Son emprise correspond actuellement au boulevard du Palais."
SEE = "Voir : Limace (rue de la)."
ABBREVIATED = "Actuellement av. de New York."
OLD_NAMES = (
    "Supprimée par la reconstruction de l'Hôtel Dieu (décret du 22 mai 1865). En 1269, c'était la rue du Chevet de la "
    "Madeleine. Plus tard dénommée rue des Oubloyers."
)


def test_norm_ignores_accents_hyphens_and_saint_abbreviations():
    assert norm("Rue Saint-Louis-en-l'Île") == norm("rue St Louis en l Ile") == "rue saint louis en l ile"
    assert norm("Impasse des Bœufs") == "impasse des boeufs"


def test_sound_merges_spellings_not_names():
    assert sound(norm("rue du Clos-Georgeau")) == sound(norm("Rue Clos Georgeot"))
    assert sound(norm("rue de Grammont")) == sound(norm("rue de Gramont"))
    assert sound(norm("rue des Trois-Maries")) != sound(norm("rue des Trois Maures"))
    assert sound(norm("rue Cadet")) != sound(norm("rue Cassette"))


def test_parse_history_reads_the_current_state():
    assert parse_history(RENAMED) == {"to": ["rue de la Tacherie"], "part": False, "see": None, "removed": False}
    assert parse_history(DECREED)["to"] == ["rue de Lutèce", "place Louis Lépine"]
    assert parse_history(PART) == {"to": ["rue de la Cité", "place Louis Lépine"], "part": True, "see": None, "removed": False}
    assert parse_history(ABBREVIATED)["to"] == ["avenue de New York"]


def test_parse_history_of_demolished_streets():
    h = parse_history(DEMOLISHED)
    assert h["removed"] and h["to"] == []  # "allait de la rue ... à la rue ..." is not a successor
    assert parse_history(FOOTPRINT)["to"] == ["boulevard du Palais"]
    assert parse_history(SEE)["see"] == "rue de la Limace"


def test_former_names_of_a_demolished_street_are_not_successors():
    assert parse_history(OLD_NAMES)["to"] == []


def test_build_former_follows_redirects_and_chains():
    records = [
        {"typo_min": "rue aux Chats", "historique": "Voir : Limace (rue de la).", "arrdt": None},
        {"typo_min": "rue de la Limace", "historique": "Actuellement partie de la rue des Halles.", "arrdt": "01e"},
        {"typo_min": "rue Neuve des Petits Champs", "historique": "Dénommée rue des Petits Champs par arrêté préfectoral du 24 janvier 1881.", "arrdt": "01e, 02e"},
        {"typo_min": "rue des Petits Champs", "historique": "Actuellement rue Danielle Casanova.", "arrdt": "01e, 02e"},
        {"typo_min": "rue de Constantine", "historique": DECREED, "arrdt": "04e", "date_voie_ancienne": "1865-05-22"},
        {"typo_min": "rue de la Calandre", "historique": DEMOLISHED, "arrdt": "04e"},
    ]
    table = build_former(records, current={norm("rue des Halles"), norm("rue Danielle Casanova")})
    assert table["rue aux chats"] == [{"name": "rue aux Chats", "arr": [], "to": ["rue des Halles"], "part": True}]
    assert table["rue neuve des petits champs"][0]["to"] == ["rue Danielle Casanova"]
    assert table["rue de constantine"][0] == {"name": "rue de Constantine", "arr": [4], "until": 1865, "to": ["rue de Lutèce", "place Louis Lépine"], "part": True}
    assert table["rue de la calandre"][0]["removed"] is True


def flat(x, y):
    """Identity 'projection' scaled so that one unit is about one metre."""
    return 2.35 + x / 73_000, 48.85 + y / 111_000


def test_build_vasserot_groups_streets_and_numbers():
    records = [
        {"NOM_ENTIER": "Rue de la Calandre", "NUM_VOIES": "1", "QUARTIER": "Cite", "x": 0, "y": 0},
        {"NOM_ENTIER": "Rue de la Calandre", "NUM_VOIES": "1", "QUARTIER": "Cite", "x": 0, "y": 10},  # two points, one number
        {"NOM_ENTIER": "Rue de la Calandre", "NUM_VOIES": "3 bis", "QUARTIER": "Cite", "x": 40, "y": 0},
        {"NOM_ENTIER": "Rue Sainte  Anne", "NUM_VOIES": "2", "QUARTIER": "Cite", "x": 0, "y": 100},
        {"NOM_ENTIER": "Rue Sainte Anne", "NUM_VOIES": "2", "QUARTIER": "Palais-Royal", "x": 0, "y": 5000},  # another street
        {"NOM_ENTIER": "", "NUM_VOIES": "7", "QUARTIER": "Cite", "x": 5, "y": 5},
    ]
    out = build_vasserot(records, lambda x, y: 4 if y < 1000 else 1, flat)
    cal = out["streets"]["rue de la calandre"]
    assert len(cal) == 1 and set(cal[0]["numbers"]) == {"1", "3bis"}
    assert cal[0]["numbers"]["1"] == [round(v, 6) for v in flat(0, 5)]
    assert cal[0]["arr"] == [4] and cal[0]["quarter"] == "Cite" and 20 <= cal[0]["spread"] <= 30
    anne = out["streets"]["rue sainte anne"]
    assert sorted(e["quarter"] for e in anne) == ["Cite", "Palais-Royal"]
    assert out["quarters"]["cite"]["name"] == "Cite"


def history() -> StreetHistory:
    def street(name, quarter, arr, numbers, spread=60):
        xs = [p[0] for p in numbers.values()] or [2.347]
        ys = [p[1] for p in numbers.values()] or [48.854]
        return {"name": name, "quarter": quarter, "arr": arr, "center": [sum(xs) / len(xs), sum(ys) / len(ys)], "spread": spread, "numbers": numbers}

    return StreetHistory(
        former={
            "rue des orties saint honore": [{"name": "rue des Orties Saint-Honoré", "arr": [1], "to": ["rue des Orties"]}],
            "rue des orties": [{"name": "rue des Orties", "arr": [1], "removed": True}],
            "rue de constantine": [{"name": "rue de Constantine", "arr": [4], "until": 1865, "to": ["rue de Lutèce", "place Louis Lépine"], "part": True}],
            "rue sainte croix": [{"name": "rue Sainte-Croix", "arr": [9], "to": ["rue de Caumartin"], "part": True}],
        },
        vasserot={
            "streets": {
                "rue clos georgeot": [street("Rue Clos Georgeot", "Palais-Royal", [1], {"1": [2.3352, 48.8661]})],
                "rue des orties": [street("Rue des Orties", "Palais-Royal", [1], {"2": [2.3340, 48.8655]})],
                "rue sainte anne": [
                    street("Rue Sainte Anne", "Palais-Royal", [1, 2], {"1": [2.3354, 48.8662], "3": [2.3356, 48.8670]}),
                    street("Rue Sainte Anne", "Palais de Justice", [1], {"1": [2.3444, 48.8549]}),
                ],
            },
            "quarters": {"cite": {"name": "Cite", "center": [2.348, 48.8545], "spread": 343}},
        },
        junctions={
            "junctions": {
                "Boulevard du Palais": {"Quai des Orfèvres": [[2.3448, 48.854425, 1, 4]]},
                # Two meetings: rue de l'Hôtel-de-Ville runs along the quai and joins it at both ends.
                "Quai de l'Hôtel de Ville": {"Rue de l'Hôtel de Ville": [[2.355078, 48.854521, 4], [2.355842, 48.854198, 4]]},
                "Rue Clos Georgeot": {"Rue Sainte-Anne": [[2.3360, 48.8665, 1]]},
                "Rue d'Orties": {"Rue Sainte-Anne": [[2.3345, 48.8658, 1]]},
                "Rue de Mézières": {"Rue Madame": [[2.3315, 48.8501, 6]]},
            }
        },
    )


def street(name, x0, y0, x1, y1, width=None):
    """A rectangular street outline, in metres."""
    ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]
    return {"properties": {"typo_min": name, "largeur": width}, "geometry": {"type": "Polygon", "coordinates": [ring]}}


def metres(p):
    """Back from `flat` lon/lat to metres."""
    return ((p[0] - 2.35) * 73_000, (p[1] - 48.85) * 111_000)


def test_build_junctions_where_outlines_meet():
    pytest.importorskip("shapely")
    features = [
        street("rue Alpha", 0, 0, 100, 10),
        street("rue Beta", 40, 10, 50, 60),  # shares an edge with rue Alpha: a T-junction
        street("rue Overlap", 50, -5, 60, 5),  # overlaps rue Alpha
        street("boulevard Large", 200, -100, 230, 100, width=30),
        street("rue Cross", 150, 0, 200, 10),  # crosses the boulevard: one meeting on each side
        street("rue Cross", 230, 0, 280, 10),
        street("rue Gap", 102, 0, 140, 10),  # 2 m from rue Alpha, nothing between: they meet
        street("rue Left", 0, 500, 100, 510),
        street("rue Right", 102.5, 500, 200, 510),  # 2.5 m from rue Left, but rue Between fills the gap
        street("rue Between", 100, 450, 102.5, 560),
        street("rue Far", 110, 700, 200, 710),
        street("rue Near", 0, 700, 100, 710),  # 10 m apart: they do not meet
        street("rue Bottom", 0, 900, 300, 910),
        street("rue Hook", 0, 910, 10, 1000),  # one street, two legs: meets rue Bottom twice
        street("rue Hook", 290, 910, 300, 1000),
        street("rue Hook", 0, 1000, 300, 1010),
    ]
    out = build_junctions(features, lambda c: c, flat, lambda x, y: [4] if x < 150 else [5])["junctions"]

    def at(a, b):
        lo, hi = sorted((a, b), key=norm)
        return [(metres(p), p[2:]) for p in out.get(lo, {}).get(hi, [])]

    [((x, y), arr)] = at("Rue Alpha", "Rue Beta")
    assert abs(x - 45) < 1 and abs(y - 10) < 1 and arr == [4]  # middle of the shared edge
    [((x, y), _)] = at("Rue Alpha", "Rue Overlap")
    assert abs(x - 55) < 1 and abs(y - 2.5) < 1  # centre of the overlap
    [((x, y), arr)] = at("Boulevard Large", "Rue Cross")
    assert abs(x - 215) < 1 and abs(y - 5) < 1 and arr == [5]  # both sides of the crossing are one meeting
    [((x, y), _)] = at("Rue Alpha", "Rue Gap")
    assert abs(x - 101) < 1 and abs(y - 5) < 6  # across the gap
    assert at("Rue Left", "Rue Right") == []  # another street lies between them
    assert len(at("Rue Left", "Rue Between")) == 1 and len(at("Rue Between", "Rue Right")) == 1
    assert at("Rue Near", "Rue Far") == []
    assert sorted(round(p[0]) for p, _ in at("Rue Bottom", "Rue Hook")) == [5, 295]  # meets twice
    assert "Rue Cross" not in out.get("Rue Cross", {})  # a name used twice is one street
    assert all(norm(a) < norm(b) for a, inner in out.items() for b in inner)


def test_street_history_junctions():
    h = history()
    palais = h.junctions(norm("Quai des Orfèvres"), norm("boulevard du Palais"))  # either order
    assert palais == [(2.3448, 48.854425)]
    assert h.junctions(norm("boulevard du Palais"), norm("quai des Orfèvres"), 4) == palais
    assert h.junctions(norm("boulevard du Palais"), norm("quai des Orfèvres"), 5) == []  # not in that arrondissement
    assert len(h.junctions(norm("rue de l'Hôtel de Ville"), norm("quai de l'Hôtel de Ville"))) == 2
    assert h.today[norm("boulevard du Palais")] == "Boulevard du Palais"
    assert h.today_sounds[sound(norm("rue Mézières"))] == [norm("Rue de Mézières")]


def test_street_history_lookups():
    h = history()
    assert [e["quarter"] for e in h.streets_1836("rue Sainte-Anne")] == ["Palais-Royal", "Palais de Justice"]
    assert [e["quarter"] for e in h.streets_1836("rue Sainte-Anne", 2)] == ["Palais-Royal"]
    assert h.streets_1836("rue du Clos-Georgeau", 1)[0]["name"] == "Rue Clos Georgeot"  # spelling
    assert h.streets_1836("rue des Orties-Saint-Honoré", 1)[0]["name"] == "Rue des Orties"  # former name
    assert h.streets_1836("rue des Orties-Saint-Honoré", 7) == []
    assert h.former_names("rue Sainte-Croix", 4) == []  # known only in the 9th
    assert h.quarter("île de la Cité")["name"] == "Cite"


def test_load_without_tables(tmp_path):
    h = StreetHistory.load(tmp_path / "none.json", tmp_path / "none2.json", tmp_path / "none3.json")
    assert h.streets_1836("rue de la Calandre") == [] and h.former_names("rue de la Calandre") == []
    assert h.junctions(norm("boulevard du Palais"), norm("quai des Orfèvres")) == []


def test_committed_junctions_place_corners_laid_out_after_1836():
    if not streetnames.JUNCTIONS_PATH.exists():
        return
    h = StreetHistory.load()

    def meet(a, b, arr=None):
        return h.junctions(norm(a), norm(b), arr)

    # OpenStreetMap junction nodes, as in the hand-checked Cité sample.
    [palais] = meet("boulevard du Palais", "quai des Orfèvres", 1)
    assert distance_m(palais, (2.3448388, 48.8543673)) < 15
    [galande] = meet("rue Galande", "rue du Petit-Pont", 5)
    assert distance_m(galande, (2.3462784, 48.852176)) < 15
    assert len(meet("rue de Rivoli", "rue Saint-Florentin")) == 1
    assert len(meet("rue Rambuteau", "rue Saint-Denis")) == 1  # both sides of the crossing are one meeting
    # Streets that only meet across another one do not meet.
    assert meet("rue Royale", "rue de Rivoli") == []  # place de la Concorde between them
    assert meet("rue Lucien Sampaix", "place Jacques Bonsergent") == []  # boulevard de Magenta between them


def test_committed_tables_cover_the_cite():
    if not streetnames.VASSEROT_PATH.exists() or not streetnames.FORMER_PATH.exists():
        return
    h = StreetHistory.load()
    calandre = h.streets_1836("rue de la Calandre", 4)
    assert len(calandre) == 1 and "1" in calandre[0]["numbers"]
    lon, lat = calandre[0]["center"]
    assert 2.344 < lon < 2.350 and 48.853 < lat < 48.856  # on the island, west of Notre-Dame
    assert any(e.get("to") == ["boulevard du Palais"] for e in h.former_names("rue de la Barillerie", 4))

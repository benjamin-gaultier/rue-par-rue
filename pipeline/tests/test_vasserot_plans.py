import math

from shapely.affinity import rotate, scale, translate
from shapely.geometry import Polygon

from rpr.sources import vasserot_plans as vp


def test_plan_street_parsing():
    assert vp.plan_street("Paris - Marmousets (rue des) n°17") == ("rue des marmousets", "17")
    assert vp.plan_street("Paris - Dauphine (place) n°16") == ("place dauphine", "16")
    assert vp.plan_street("Paris - Barillerie (rue de la) n°24 bis") == ("rue de la barillerie", "24")
    assert vp.address_key("Rue des Marmousets", "17") == vp.address_key("rue des marmousets", "17")


def test_registration_recovers_rotation_scale_and_position():
    # An L-shaped plot, as a sheet might draw it in pixels (y down).
    sheet = Polygon([(0, 0), (300, 0), (300, 120), (120, 120), (120, 400), (0, 400)])
    # The same plot on the ground: mirrored into y-up, 0.05 m per pixel, turned 37°, moved.
    ground = translate(rotate(scale(vp.to_math(sheet), 0.05, 0.05, origin=(0, 0)), 37, origin=(0, 0)), 652100, 6862300)
    fit = vp.register(sheet, ground)
    assert fit.iou > 0.97
    assert math.isclose(fit.scale, 0.05, rel_tol=0.01)
    assert abs(((fit.angle - 37) + 180) % 360 - 180) < 1
    placed = vp.place(vp.to_math(sheet), fit)
    assert placed.symmetric_difference(ground).area / ground.area < 0.05


def test_registration_rejects_unrelated_shapes():
    sheet = Polygon([(0, 0), (100, 0), (100, 400), (0, 400)])  # long and thin
    ground = Polygon([(0, 0), (20, 0), (20, 20), (0, 20)])  # square
    assert vp.register(sheet, ground).iou < vp.MIN_IOU


def test_plan_numbers_reads_ranges_and_bis():
    assert vp.plan_numbers("Paris - Haut-Moulin-en-la-cité (rue du) n°6 et 8") == ["6", "8"]
    assert vp.plan_numbers("Paris - Sainte-Anne-en-la-Cité (rue) n°9 BIS") == ["9bis"]
    assert vp.plan_numbers("Paris - Arcole (rue d') n°5 bis") == ["5bis"]
    assert vp.plan_numbers("Paris - Barillerie (rue de la) n°12-14") == ["12", "14"]
    assert vp.plan_numbers("Paris - Dauphine (place)") == []


def test_resolve_street_strips_the_index_qualifier_and_spelling():
    known = {"rue sainte anne", "rue de harlay", "rue des deux hermites", "rue du haut moulin"}
    assert vp.resolve_street("rue sainte anne en la cite", known) == ("rue sainte anne", vp.MATCH_QUALIFIER)
    assert vp.resolve_street("rue de harlay au palais", known) == ("rue de harlay", vp.MATCH_QUALIFIER)
    assert vp.resolve_street("rue des deux ermites", known) == ("rue des deux hermites", vp.MATCH_SPELLING)
    assert vp.resolve_street("rue de harlay", known) == ("rue de harlay", vp.MATCH_ADDRESS)
    assert vp.resolve_street("rue d arcole", known) == (None, "")


def test_match_parcels_needs_every_number():
    index = {vp.address_key("rue x", "6"): "P6", vp.address_key("rue x", "8"): "P8", vp.address_key("rue x", "9"): "P9"}
    assert vp.match_parcels("rue x", ["6", "8"], index) == ["P6", "P8"]
    assert vp.match_parcels("rue x", ["6", "10"], index) is None
    assert vp.match_parcels("rue x", ["9bis"], index) == ["P9"]  # no point of its own: the plain number's parcel
    index[vp.address_key("rue x", "9bis")] = "P9b"
    assert vp.match_parcels("rue x", ["9bis"], index) == ["P9b"]


def test_unnamed_points_take_the_name_only_on_the_outline():
    place = Polygon([(0, 0), (100, 0), (50, 60)])
    points = [("2", "A", 50, 0.05), ("4", "B", 75, 30.5), ("28", "C", 50, -9)]
    assert vp.name_unnamed_points(points, place) == {"2": "A", "4": "B"}


def test_streets_named_after_1836_are_not_used():
    assert vp.named_by_1836({"ouverture": "Lettres patentes du 28 mai 1607.", "denomination": None})
    assert not vp.named_by_1836({"ouverture": None, "denomination": "Décision ministérielle du 13 février 1837."})
    assert vp.display_name("Paris - Arcole (rue d') n°5") == "rue d'Arcole"
    assert vp.display_name("Paris - Dauphine (place) n°27") == "place Dauphine"

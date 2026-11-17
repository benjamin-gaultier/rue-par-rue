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

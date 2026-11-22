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


def _sheet(tmp_path, draw):
    import pytest

    cv2 = pytest.importorskip("cv2")  # [vision] extra; CI installs only [dev,geo]
    import numpy as np

    img = np.full((1000, 700, 3), (200, 222, 228), np.uint8)  # yellowed paper (BGR)
    draw(cv2, img)
    path = tmp_path / "sheet.jpg"
    cv2.imwrite(str(path), img)
    return path


def test_segment_reads_a_sheet_drawn_in_ink_from_its_walls(tmp_path):
    def draw(cv2, img):
        cv2.rectangle(img, (200, 300), (400, 700), (30, 30, 30), 9)  # walls
        cv2.line(img, (200, 500), (400, 500), (30, 30, 30), 9)  # a partition
        cv2.line(img, (280, 700), (320, 700), (200, 222, 228), 11)  # a door in the street wall
        cv2.putText(img, "Rue de la Juiverie", (150, 800), cv2.FONT_HERSHEY_SCRIPT_SIMPLEX, 1, (40, 40, 40), 1)
        cv2.rectangle(img, (0, 0), (699, 25), (150, 140, 235), -1)  # pink strip along the scan's edge

    prop, built, _, walls_only, how = vp.segment(_sheet(tmp_path, draw))
    assert how == vp.SEGMENT_INK and walls_only
    ys, xs = (prop > 0).nonzero()
    assert abs(xs.min() - 196) < 8 and abs(xs.max() - 404) < 8 and abs(ys.min() - 296) < 8 and abs(ys.max() - 704) < 8
    assert (built > 0).sum() == (prop > 0).sum()


def test_segment_keeps_the_pink_wash_when_the_building_is_washed(tmp_path):
    def draw(cv2, img):
        cv2.rectangle(img, (200, 300), (400, 700), (150, 140, 235), -1)  # washed rooms
        cv2.rectangle(img, (200, 300), (400, 700), (30, 30, 30), 9)
        cv2.rectangle(img, (500, 100), (650, 160), (30, 30, 30), 9)  # an inked box away from the drawing

    *_, how = vp.segment(_sheet(tmp_path, draw))
    assert how == vp.SEGMENT_PINK


def test_segment_ignores_a_washed_fragment_inside_an_ink_drawing(tmp_path):
    def draw(cv2, img):
        cv2.rectangle(img, (150, 250), (500, 750), (30, 30, 30), 9)
        cv2.rectangle(img, (160, 260), (200, 300), (150, 140, 235), -1)  # one washed corner

    *_, how = vp.segment(_sheet(tmp_path, draw))
    assert how == vp.SEGMENT_INK


def test_box_share_and_edge():
    assert vp.box_share((0, 0, 10, 10), (0, 0, 20, 20)) == 0.25
    assert vp.box_share((50, 50, 10, 10), (0, 0, 20, 20)) == 0
    assert vp.touches_edge((0, 400, 700, 20), (1000, 700))
    assert not vp.touches_edge((200, 300, 200, 400), (1000, 700))


def test_a_corrected_number_keeps_the_number_written_on_the_sheet():
    assert vp.plan_street("Paris - Arcole (rue d') n°22 [en fait : 20]") == ("rue d arcole", "22")
    assert vp.plan_numbers("Paris - Chanoinesse (rue) n°20 [en fait 24]") == ["20"]
    assert vp.plan_numbers("Paris - Cloître-Notre-Dame (rue du) n°24 [en fait : 24 et 26]") == ["24"]
    assert vp.plan_numbers("Paris - Marmousets (rue des) n°18 bis [en fait : 22]") == ["18bis"]
    # Brackets that are not a correction are part of the number.
    assert vp.plan_numbers("Paris - Orfèvres (quai des) n°4 [BIS]") == ["4bis"]
    assert vp.plan_street("Paris - Cité (quai de la) n°sans numéro : au bord du quai, plan de 4 bateaux") is None


def test_second_addresses_need_a_number_and_skip_corrections():
    detail = "division ou quartier : Cité ; et 3 rue des Deux-Ermites ; actuellement rue de Lutèce ; propriétaire : Aune"
    assert vp.second_addresses(detail) == [("rue des deux ermites", ["3"])]
    assert vp.second_addresses("quartier : Cité ; et 2 rue Chanoinesse [Fournel propriétaire] ; et quai de la Cité") == [
        ("rue chanoinesse", ["2"])
    ]
    assert vp.second_addresses("quartier : Cité ; et 4 et 6 rue de Glatigny") == [("rue de glatigny", ["4", "6"])]
    assert vp.second_addresses("quartier : Cité ; en fait : 13 quai Napoléon ; et rue Basse-des-Ursins") == []
    assert vp.second_addresses("quartier : Palais de Justice ; et 22, rue de la Barillerie") == [("rue de la barillerie", ["22"])]


def test_sheet_size_and_scale_bar():
    assert vp.sheet_long_cm("35,7 x 22 cm") == 35.7
    assert vp.sheet_long_cm("19 x 32 cm") == 32
    assert vp.sheet_long_cm("") is None
    assert round(vp.sheet_scale("14.8 cm / 30 m")) == 203
    assert vp.sheet_scale("10 cm / 20 m") == 200
    assert vp.sheet_scale("sans échelle") == 200
    assert vp.sheet_scale("incomplète") == 200


def test_a_fit_at_the_wrong_scale_is_refused():
    # A 30 cm sheet at 1:200 covers 60 m.
    assert vp.scale_holds(vp.fitted_scale(63, 30.0), 200)
    # Rue du Milieu-des-Ursins n°4: fitted so that a 37.4 cm sheet would cover 351 m.
    assert not vp.scale_holds(vp.fitted_scale(351, 37.4), vp.sheet_scale("14.8 cm / 30 m"))
    assert not vp.scale_holds(vp.fitted_scale(38, 32.1), 200)
    # A sheet drawn at 1:400 may cover twice the ground.
    assert vp.scale_holds(vp.fitted_scale(120, 30.0), vp.sheet_scale("7.4 cm / 30 m"))
    # No paper size in the index: nothing to check against.
    assert vp.scale_holds(vp.fitted_scale(351, None), 200)


def _ground(sheet, angle=0.0):
    """A sheet outline (pixels, y down) as it lies on the ground: 0.05 m per pixel, turned, moved."""
    return translate(rotate(scale(vp.to_math(sheet), 0.05, 0.05, origin=(0, 0)), angle, origin=(0, 0)), 652100, 6862300)


def test_turn_between_measures_walls_against_the_parcels_sides():
    plot = Polygon([(0, 0), (20, 0), (20, 12), (0, 12)])
    assert vp.turn_between(plot, plot) == 0
    assert abs(vp.turn_between(rotate(plot, 10, origin="centroid"), plot) - 10) < 0.2
    # Walls are compared with the side they run along, so a square turned 45° is 45° off, not 0.
    square = Polygon([(0, 0), (15, 0), (15, 15), (0, 15)])
    assert abs(vp.turn_between(rotate(square, 45, origin="centroid"), square) - 45) < 0.2
    # Steps in a wall shorter than a room are not sides.
    stepped = Polygon([(0, 0), (20, 0), (20, 12), (11, 12), (11, 12.4), (10, 12.4), (10, 12), (0, 12)])
    assert vp.turn_between(stepped, plot) == 0
    # Nothing long enough to compare.
    assert vp.turn_between(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]), plot) is None


def test_straighten_keeps_a_fit_whose_walls_follow_the_parcel():
    sheet = Polygon([(0, 0), (300, 0), (300, 120), (120, 120), (120, 400), (0, 400)])
    ground = _ground(sheet, 37)
    fit = vp.register(sheet, ground)
    kept = vp.straighten(sheet, ground, fit)
    assert kept.angle == fit.angle and kept.turned_back == 0
    assert kept.turn < 1


def test_straighten_turns_back_a_fit_that_overlaps_best_askew():
    # A fit handed over 11° off a parcel it matches is turned back onto it.
    sheet = Polygon([(0, 0), (400, 0), (400, 300), (0, 300)])
    ground = _ground(sheet)
    askew = vp.Fit(scale=0.05, angle=11.0, dx=0, dy=0, iou=0.8)
    back = vp.straighten(sheet, ground, askew)
    assert back is not None
    assert abs(back.turned_back + 11) <= 3 and back.turn <= vp.GOOD_TURN
    assert back.iou > 0.9
    placed = vp.place(vp.to_math(sheet), back)
    assert placed.symmetric_difference(ground).area / ground.area < 0.15


def test_straighten_rejects_a_drawing_that_only_fits_askew():
    # A rectangle fits a square of the same area best along its diagonal, as
    # rue des Marmousets n°17 did: turned straight, it no longer overlaps enough.
    sheet = Polygon([(0, 0), (480, 0), (480, 300), (0, 300)])
    side = math.sqrt(480 * 300) * 0.05
    ground = Polygon([(0, 0), (side, 0), (side, side), (0, side)])
    fit = vp.register(sheet, ground)
    assert fit.iou < vp.MIN_IOU or vp.straighten(sheet, ground, fit) is None
    turned = vp.Fit(scale=0.05, angle=30.0, dx=0, dy=0, iou=0.73)
    assert vp.straighten(sheet, ground, turned) is None

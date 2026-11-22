---
stream: cite1836
priority: 3
status: open
added: 2026-11-22
needs: []
---
# Fit the sheets at their own scale

Why: the registration takes its scale from the areas, so a drawing of part of a parcel is blown up to fill it, and a drawing whose shape differs a little from the parcel settles askew. The checks added since (scale in PR #23, walls against the parcel's sides in PR #31) can only reject such fits: 15 fits are rejected at the wrong scale and 7 for being turned. The scale is known (1:200, or the sheet's own bar, with the paper size in the index), so the fit could keep it and search only the angle and the position.

Done when: `register()` fits at the sheet's scale (within the margin the scans leave, measured on the fits that hold today), the 22 sheets rejected by the scale and turn checks are tried again, and the PR gives how many are traced, with no sheet traced today lost without a reason.

Notes:
- `register()` and `straighten()` in `pipeline/rpr/sources/vasserot_plans.py`. The position can no longer come from the centroids when the drawing covers part of the parcel: slide it so that the walls lie on the parcel's sides.
- The 7 rejected for their turn (PR #31): plans 8158 (rue des Marmousets n°17: a long rectangle on the sheet, a squarish parcel), 8133 (rue Cocatrix n°16), 8292 (rue Saint-Landry n°4), 8234 (rue du Milieu-des-Ursins n°1), 8093 and 8085 (rue Chanoinesse n°6 and n°22: the outline read is the hull of a thin wash), 106 (place Dauphine n°14: a rectangle on the sheet, a slanted parcel). Some of them simply disagree with the parcel; say which.
- Place Dauphine n°14 and n°18 (plans 106, 108): the sheets draw square corners where the ALPAGE parcels are slanted. Check against the houses that still stand.
- `turn` and `turned_back` on each traced footprint show the wall check.

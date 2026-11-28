---
stream: cite1836
priority: 3
status: open
added: 2026-11-22
needs: []
---
# Ink drawings read only in part, yet traced

Why: two sheets drawn in ink pass every check with an outline that cuts across the drawing. Rue des Marmousets n°15 (plan 8159, IoU 0.73) is read as a triangle: the outline runs along a diagonal through the rooms. Rue Chanoinesse n°8 (plan 8092, IoU 0.82) is read as a hull that leaves out the rooms along one side. Their footprints in the 3D model are wrong in shape, though in the right place.

Done when: a reading whose outline crosses the drawn walls is caught (for instance, the share of the wall ink that falls outside the outline, or long outline sides with no wall under them), the two sheets are read whole or rejected, and the ink sheets traced today are checked one by one with the numbers in the PR.

Notes: `ink_walls()`, `walled_area()` and `segment()` in `pipeline/rpr/sources/vasserot_plans.py`. `walled_area()` falls back on the convex hull when the closed walls leave the shape open; that is where the diagonal comes from. See also `cite1836-partial-wash` and `cite1836-open-yards`.

Update 2026-11-28 (PR #39): an ink reading that fits only once turned back is now rejected. That catches both sheets above and two more (rue de la Pelleterie n°9, plan 8265; rue de Perpignan n°11, plan 8271), so none of the traced footprints is known to be read in part. What is left: read these four whole, and the 11 other sheets with a corrected number rejected for the same reason (plans 8086, 8089, 8090, 8203, 8205, 8263, 8264, 8266, 8267, 8270, 8280: one strip of the drawing, or a hull cut by a diagonal). Tried and dropped: the share of drawn line under each hull side does not tell these apart from sheets whose street front is left open (place Dauphine n°27, rue de la Lanterne n°11 to 15 score as low).

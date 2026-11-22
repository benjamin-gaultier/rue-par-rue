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

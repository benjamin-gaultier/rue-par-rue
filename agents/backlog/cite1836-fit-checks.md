---
stream: cite1836
priority: 2
status: open
added: 2026-11-21
needs: []
---
# Catch accepted fits that are turned or scaled wrongly

Why: IoU alone accepts some wrong placements. Rue du Haut-Moulin n°3 (parcel PA7819, IoU 0.786) is turned about 45° inside its square parcel. Because the scale comes from the areas, a drawing of part of a parcel is blown up to fill it: four sheets traced from their wash fit a sheet whose long side would cover 132 to 351 m, where 73 of 77 cover 37-92 m (plans 8249 at 351 m, 8185 at 184 m, 8247 at 157 m, 8241 at 132 m; see `sheet_m` in `vasserot-traced-cite.geojson`).

Done when: the outliers are checked against the scale bar or the dimensions written on the sheet, an edge-alignment test (the main walls parallel to the parcel's sides, within a few degrees) is added to the registration, and wrong fits are rejected or corrected, with the numbers in the PR.

Notes: `register()` in `pipeline/rpr/sources/vasserot_plans.py`. Ink readings already have a 100 m bound (`MAX_INK_SHEET_M`); one bound for all sheets may do, if the scale bars agree.

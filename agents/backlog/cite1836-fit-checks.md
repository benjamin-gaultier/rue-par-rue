---
stream: cite1836
priority: 2
status: done
done: 2026-11-22, PR #31 — the walls of each fit are compared with the parcel's sides: of 114 fits, 13 are turned back onto their parcel (by 2° to 13°) and 7 that only fit askew are rejected (114 → 107 traced, median IoU 0.84 → 0.85); follow-ups in cite1836-known-scale-fit and cite1836-ink-read-in-part
added: 2026-11-21
needs: []
---
# Catch accepted fits that are turned or scaled wrongly

Why: IoU alone accepts some wrong placements. Rue du Haut-Moulin n°3 (parcel PA7819, IoU 0.786) is turned about 45° inside its square parcel. Because the scale comes from the areas, a drawing of part of a parcel is blown up to fill it: four sheets traced from their wash fit a sheet whose long side would cover 132 to 351 m, where 73 of 77 cover 37-92 m (plans 8249 at 351 m, 8185 at 184 m, 8247 at 157 m, 8241 at 132 m; see `sheet_m` in `vasserot-traced-cite.geojson`).

Done when: the outliers are checked against the scale bar or the dimensions written on the sheet, an edge-alignment test (the main walls parallel to the parcel's sides, within a few degrees) is added to the registration, and wrong fits are rejected or corrected, with the numbers in the PR.

Notes: `register()` in `pipeline/rpr/sources/vasserot_plans.py`. Ink readings already have a 100 m bound (`MAX_INK_SHEET_M`); one bound for all sheets may do, if the scale bars agree.

Progress (PR #23): the scale half is done. Each fit is checked against the sheet's own scale (1:200, or its scale bar) through the paper size in the index. It rejects the four outliers named above, rue du Haut-Moulin n°3 (it came out at 1:328) and rue des Marmousets n°20 (1:119). Left for this item: the edge-alignment test. Fits to look at first: Cocatrix n°16 (plan 8133, IoU 0.788) and Marmousets n°18 bis (plan 8221, IoU 0.774) fit loosely; plans 8078, 8272 and 8273 have the right outline but a patchy built area.

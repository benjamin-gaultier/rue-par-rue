---
stream: cite1836
priority: 3
status: done
done: 2026-11-28, PR #39 — the 42 rejects sorted by cause; the red-ink number under many of these drawings was read as the wash: a pink mark outside an ink drawing is now ignored (rue de la Licorne n°10, 12, 14, rue de Perpignan n°7 traced), and ink readings that fit only once turned back are rejected (4, all read in part): 107 → 109 traced, median IoU 0.85; the 13 numbers without a point explained in the README; follow-ups in cite1836-grey-wash and cite1836-numbers-without-points
added: 2026-11-21
needs: []
---
# Sort the rejects among the sheets with a corrected number

Why: PR #23 reads the 85 Cité sheets whose number the index corrects. 25 are traced, 42 fit their parcel poorly, the others have no address point. Nobody has looked at the 42 yet, and 14 sheets in all have a number the cadastre lacks.

Done when: the 42 rejects are sorted by cause next to their parcels (as PR #19 did), at least one cause is handled, and the sheets whose written number has no address point are explained (a number the cadastre skips, or a street where the written number is not the cadastre's).

Notes:
- `scale` on each traced footprint and the "wrong scale" count in the metadata of `vasserot-traced-cite.geojson` show the scale check: 15 fits passed the IoU bar at an impossible scale. Many rue de la Licorne, rue de la Pelleterie and rue de Perpignan sheets fit at 1:250 to 1:700: look at what the segmenter caught there.
- On a few streets the corrected number may be the cadastre's after all (rue Saint-Christophe n°20 has no point, "en fait 18" has one). Decide street by street, from sheets that fit only one of the two, never sheet by sheet from the better fit.
- The scale is known (1:200, or the sheet's bar), so the registration could fix the scale instead of taking it from the areas. That would make a partial drawing fit part of its parcel instead of being blown up, and tell neighbours of the same shape apart by size.

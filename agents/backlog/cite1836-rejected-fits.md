---
stream: cite1836
priority: 2
status: done
done: 2026-11-21, PR #19 — the 49 rejects sorted by cause; sheets drawn in ink only are read from their walls: 78 → 93 traced, none lost, median IoU 0.83; follow-ups in cite1836-fit-checks, cite1836-open-yards, cite1836-partial-wash
added: 2026-11-20
needs: []
---
# Recover the sheets rejected for a poor fit

Why: 42 sheets were rejected because their drawing fit the parcel with IoU below 0.72. Some may be drawn mirrored, cover two parcels, or include a courtyard the parcel lacks.

Done when: the rejected sheets are sorted by cause in the PR, at least one cause is handled, more sheets traced, no accepted fit below 0.72.

Notes:
- Look at the worst ten by eye first (the sheet next to its parcel) before changing the registration.
- PR #17 found an accepted fit that is visibly wrong: rue du Haut-Moulin n°3 (parcel PA7819, IoU 0.786) is placed about 45° off its parcel. IoU alone does not catch a square drawing turned inside a square parcel; check the edge alignment too.

Result (PR #19): the 49 rejected sheets, looked at one by one next to their parcels:
- 18 drawn in ink only, with no pink wash: the segmenter took a strip of the scanner's margin or a stray pink mark. Handled: read from the thick ink walls. 10 now traced, plus 3 of the 9 sheets with "no drawing found".
- 7 washed only in part (other rooms brown or grey): 2 now traced through the ink walls; 5 left (cite1836-partial-wash).
- 7 near misses (IoU 0.67-0.72) whose yard, open on one side, is left out of the drawn property (cite1836-open-yards).
- 17 where sheet and parcel genuinely disagree: the sheet draws part of the parcel (179 and 180 share one parcel), a single apartment (193-195), or the parcel was divided differently. Left as they are.

---
stream: cite1836
priority: 2
status: open
added: 2026-11-20
needs: []
---
# Recover the sheets rejected for a poor fit

Why: 42 sheets were rejected because their drawing fit the parcel with IoU below 0.72. Some may be drawn mirrored, cover two parcels, or include a courtyard the parcel lacks.

Done when: the rejected sheets are sorted by cause in the PR, at least one cause is handled, more sheets traced, no accepted fit below 0.72.

Notes:
- Look at the worst ten by eye first (the sheet next to its parcel) before changing the registration.
- PR #17 found an accepted fit that is visibly wrong: rue du Haut-Moulin n°3 (parcel PA7819, IoU 0.786) is placed about 45° off its parcel. IoU alone does not catch a square drawing turned inside a square parcel; check the edge alignment too.

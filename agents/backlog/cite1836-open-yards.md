---
stream: cite1836
priority: 3
status: open
added: 2026-11-21
needs: []
---
# Sheets whose open yard is left out of the drawn property

Why: 7 sheets fit their parcel at IoU 0.67-0.72, just under the 0.72 bar, because a yard open on one side is not closed by the boundary lines the segmenter looks for, so the property drawn is smaller than the parcel (plans 8226, 8227, 8288, 8070, 8170, 8181, 8252).

Done when: the property outline includes a yard bounded by the parcel's own sides (for example: fit the built part, then score it by how much of it falls inside the parcel rather than by IoU with the whole parcel), these sheets traced if the fit holds, and no accepted fit visibly wrong in a check by eye.

Update 2026-11-28: 4 more among the sheets with a corrected number leave out an open yard or an outbuilding (plans 8093, 8177, 8366, 8367).

---
stream: cite1836
priority: 3
status: open
added: 2026-11-28
needs: []
---
# Sheets washed in grey

Why: the four rue du Cloître-Notre-Dame sheets with a corrected number (plans 8123, 8127, 8128, 8129, drawn about 1851) wash their built rooms in grey, not pink. The segmenter finds no pink, so it reads a stamp, a red number or one strip of the walls, and the fit fails (IoU 0.22-0.72, or a scale 3 to 25 times the sheet's). These are canons' houses of the cloister, among the oldest on the island.

Done when: a grey wash (darker than the sheet's paper, neither pink nor ink-black) is read as built, these sheets traced where the fit holds, and no sheet traced today lost or changed.

Notes: `segment()` in `pipeline/rpr/sources/vasserot_plans.py` measures colour against the sheet's own paper; a grey wash is lower in L* with a* and b* near the paper's. See also `cite1836-partial-wash`, whose sheets mix pink with grey or brown rooms: one reading may serve both.

---
stream: photos
priority: 3
status: open
added: 2026-11-21
needs: []
---
# Find out what the Albert-Kahn positions are

Why: `rpr/sources/kahn.py` marks every Kahn position as the camera's (`pose: recorded`, confidence 0.8). The data suggests many are the subject's instead: 44 photos share one point 11 m from Notre-Dame, 49 another point; 4,302 photos have only 1,860 distinct positions; titles naming the Arc de Triomphe sit 4 to 7 m from it. If so, the photo card overstates the precision, and a heading towards a named landmark would be wrong.

Done when: the meaning of the coordinates is established from the dataset's documentation or a hand check of 20 photos against the place shown; positions that are subjects or rough points carry a lower confidence and an honest pose label; the README says what Kahn positions are.

Notes:
- Dataset: `archives-de-la-planete-paris` on opendata.hauts-de-seine.fr (Opendatasoft); read its field descriptions first.
- A shared point used by many photos with different subjects is a sign of a rough position.

---
stream: photos
priority: 1
status: done
done: 2026-11-21, PR #24 — the dataset documents the point as the operator's position; a hand check confirms it for 2,213 photos (own point, or plates of one view) and shows the other 2,089 share a point that is a place; those are flagged, at confidence 0.5 or 0.3, and the photo card says so
added: 2026-11-21
needs: []
---
# Find out what the Albert-Kahn positions are

Why: `rpr/sources/kahn.py` marks every Kahn position as the camera's (`pose: recorded`, confidence 0.8). The data suggests many are the subject's instead: 44 photos share one point 11 m from Notre-Dame, 49 another point; 4,302 photos have only 1,860 distinct positions; titles naming the Arc de Triomphe sit 4 to 7 m from it. If so, the photo card overstates the precision, and a heading towards a named landmark would be wrong.

Done when: the meaning of the coordinates is established from the dataset's documentation or a hand check of 20 photos against the place shown; positions that are subjects or rough points carry a lower confidence and an honest pose label; the README says what Kahn positions are.

Notes:
- Dataset: `archives-de-la-planete-paris` on opendata.hauts-de-seine.fr (Opendatasoft); read its field descriptions first.
- A shared point used by many photos with different subjects is a sign of a rough position.
- Raised to priority 1 on 2026-11-21: 3,993 of the 5,752 photos dated to 1900–1929 are Albert-Kahn's, and `era1920-pose-auto` needs to know what their positions mean.

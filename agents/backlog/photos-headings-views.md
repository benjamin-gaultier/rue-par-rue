---
stream: photos
priority: 2
status: open
added: 2026-11-21
needs: [photos-headings]
---
# Headings for street views, corners and named subjects

Why: Only photos placed at a house number face a direction (1,699 of 9,423, PR #18). Views down a street, views from a corner and photos of a named monument still face the walker in 3D, and the viewer cannot turn to the subject.

Done when: a heading on at least a third of the photos (3,141), each with its method and confidence, and a hand check of 20 new headings.

Notes:
- "Rue X, vue prise de la rue Y", placed at the corner of X and Y: the camera looks down rue X, away from the corner. Use today's street outlines (`rpr headings` already downloads them, `pipeline/cache/streets/`): take the part of rue X's outline 30 to 80 m from the corner; one piece gives the direction, two (X crosses Y) give none. New method `street_axis` in `pipeline/rpr/headings.py`.
- Captions that name a subject and a viewpoint ("Notre-Dame, vue prise du quai…"): bearing from the viewpoint to the subject. A landmark gazetteer was in open PR #16 (another session); use it once it is merged, never copy it.
- Albert-Kahn: see photos-kahn-positions first; a bearing to a named landmark only makes sense if the position is the camera's.

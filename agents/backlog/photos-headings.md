---
stream: photos
priority: 2
status: done
done: 2026-11-21, PR #18 — first slice: 1,699 of 9,423 photos (18%) face the building at their address (method facade); the third-of-photos target moves to photos-headings-views
added: 2026-11-20
needs: [photos-land-pr12-pr14]
---
# Face each photo towards its subject

Why: Albert-Kahn records have a position but no direction, and Paris Musées captions are placed at a point. The then-and-now viewer cannot turn to the subject by itself, and 3D frames face the walker rather than the scene.

Done when: a heading (bearing in degrees, with how it was obtained and a confidence) on at least a third of the photos, shown by the viewer and the 3D frames; a hand check of 20 headings against the photos.

Notes:
- Captions often name the subject ("Notre-Dame, vue prise du quai…", "vue prise de la rue Y"): the bearing from the camera position to the subject's position is a good first heading. The 1836 address points and today's addresses give the subject's position.
- A landmark gazetteer was being built in another session (look for a merged or open PR about landmarks); use it if it landed.
- Add the heading to the schema in `pipeline/rpr/photo.py` with its method (`subject_bearing`, `street_axis`…), never as a recorded value.

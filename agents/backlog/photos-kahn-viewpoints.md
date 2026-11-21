---
stream: photos
priority: 3
status: open
added: 2026-11-21
needs: []
---
# Move Albert-Kahn photos off a shared point when the caption names the viewpoint

Why: 2,089 Albert-Kahn photos sit on a point that is the place they show, not where the camera stood (PR #24). Many captions say where the operator was: "Le barrage de la Monnaie depuis le quai de Conti", "La rue St-Martin vue de la rue Meslay", "vus de la terrasse du Bord-de-l'Eau". The geocoder already places such captions for Paris Musées.

Done when: the photos flagged `position_of: "place"` whose caption names a viewpoint ("depuis", "vu de", "vue prise de") are counted; those the geocoder can place at that viewpoint move there, with pose `geocoded`, the usual precision and method in `extra`, and the archive's point kept in `extra` as the subject; a hand check of 20 moved photos; the rest stay where they are.

Notes:
- Start with a count by caption pattern on `web/public/data/photos/kahn.geojson`; if fewer than 100 captions name a viewpoint, close the item with the count.
- `pipeline/rpr/geocode.py` handles "vue prise de" for Paris Musées captions; the Kahn captions are in today's French and name today's streets.
- With the viewpoint placed and the archive's point as the subject, the bearing from one to the other is a heading (see photos-headings-views).
- Never move a photo whose point is its own: that one is the camera's.

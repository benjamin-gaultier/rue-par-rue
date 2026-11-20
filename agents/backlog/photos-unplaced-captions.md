---
stream: photos
priority: 3
status: open
added: 2026-11-20
needs: [photos-land-pr12-pr14]
---
# Sort the captions still unplaced and fix the largest group

Why: About 2,000 of the 6,725 Paris Musées captions are still unplaced. Each group of failures (a spelling, a kind of place, a phrasing) that gets fixed puts dozens of photos on the map.

Done when: the unplaced captions are bucketed by reason in the PR, the largest bucket is fixed, placed count goes up, and a random sample of 20 newly placed photos has no wrong placement.

Notes:
- Start from the saved works (`pipeline/cache/parismusees-works.json.gz`) and `python -m rpr parismusees --offline`: no token needed.
- Matching rules and their confidences are in `pipeline/rpr/geocode.py` and the README table; keep the table true.

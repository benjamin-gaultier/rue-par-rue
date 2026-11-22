---
stream: photos
priority: 1
status: done
done: 2026-11-22, PR #30 — a caption that ends on another town after a comma is not placed: 15 photos of Rouen, Beauvais, Compiègne, Houdan and Vanves leave the map (10,032 → 10,017 photos), no other placement changes
added: 2026-11-21
needs: []
---
# Take captions from other towns off Paris streets

Why: About 15 Paris Musées photos taken outside Paris sit on a Paris street of the same name: rue Saint-Romain in Rouen (5), streets of Beauvais (5), rue des Lombards in Compiègne (2), Houdan (2), rue Fabert in Vanves. They are wrong placements, the worst kind of error for this project.

Done when: a caption whose last piece names a town other than Paris (and no arrondissement) is never placed on a Paris street, those photos are unplaced, no right placement is lost, and the PR lists every photo that leaves the map.

Notes:
- `Geocoder._other_town` in `pipeline/rpr/geocode.py` already guards the landmark and spelling steps, but it is too broad to guard plain street matches: it also flags captions that end on a Paris street ("…, Rue Saint-Dominique."). A narrower check is needed, for example a list of French communes, or a town name after the last comma that is not a street of Paris.
- Measure with the full works dump: `python -m rpr parismusees --offline`, no token needed.

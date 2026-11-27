---
stream: cite1836
priority: 3
status: open
added: 2026-11-27
needs: []
---
# House lots from a source, not from the 9 m rule

Why: A footprint over 160 m² is still cut into lots of about 9 m by rule (`split_houses` in `pipeline/rpr/sources/model3d.py`), so the party walls between houses are guessed. The built part itself now comes from the block atlas.

Done when: the lots of a parcel follow a source where one exists, the building card says which, and the README gives how many parcels are still split by rule.

Notes:
- The atlas layer (`pipeline/cache/vasserot/BATI.shp`, see "The Vasserot block atlas" in DATA_SOURCES.md) draws two or more built polygons in about 340 parcels of the model area: keep them apart instead of merging and cutting again.
- The 1836 address points (`Num_Voies_Vasserot`) give one point per house door: a parcel with three numbers on the street held three houses. Cutting square to the street between the points is still a rule, so flag it as reasoned.
- Measure: parcels split by rule before and after; look at the rue de la Calandre and the quai des Orfèvres in the app.

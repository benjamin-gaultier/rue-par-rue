---
stream: cite1836
priority: 4
status: open
added: 2026-11-27
needs: []
---
# Parcels the block atlas does not sort

Why: 56 parcels of demolished houses in the model area keep the old rule (the whole parcel, or a 9 m ring over 400 m²), because the atlas layer covers under 90% of them with built or open polygons. Two are on the island: the Palais de Justice (PA3536, 170 lots) and PA26500 (21 lots).

Done when: each of the 56 is sorted by cause in the README, and those that have a source are drawn from it.

Notes:
- The atlas layer marks the Palais as "not sorted" (`BATI` = 3) but names its courts as open polygons (Cour de Harlay, Cour du Palais de Justice, Cour de Lamoignon, Cour des Comptes, Cour de la Préfecture de Police): the built part may be the parcel less those courts. Check against `rpr landmarks`, which already draws the Palais, so nothing is drawn twice.
- List them with: features of `web/public/data/3d/cite-1836.geojson` of kind `reconstructed` with neither `atlas`, `traced` nor `institution`.
- `ATLAS_COVERAGE` in `pipeline/rpr/sources/model3d.py` is the 90% threshold.

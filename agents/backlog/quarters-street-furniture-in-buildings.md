---
stream: quarters
priority: 3
status: open
added: 2026-11-22
needs: []
---
# Keep kerb stones and lamp posts out of the buildings

Why: In the streets before 1860, about one kerb stone in ten is drawn inside a house, and a few lamp posts, columns and benches too. Walking the old streets, they poke through walls or are hidden. Each new quarter will have the same fault.

Done when: no item of `streets-<area>.json` lies more than 0.35 m inside a model building that stands during the item's years (or its years are cut, as `vehicles` does), a test covers it, and the PR gives the counts before and after.

Notes:
- Measured on 2026-11-22 (PR #34) against `cite-1836.geojson`, each building shrunk by about 0.35 m: kerb stones 1780–1860: 38 of 415; candelabra 1850–1860: 2 of 361, 1860–1960: 3 of 406, from 1860: 9 of 616; columns 1839–1860: 4 of 26, from 1860: 1 of 32; benches: 4 of 332. Oil lamps on posts: 0 of 361. No parked vehicle is inside a building.
- Kerb stones are placed in `pipeline/rpr/sources/streets.py` (`item("kerb_stone", …)`), from the Vasserot street space. The model's reconstructed buildings come from the Vasserot parcels and the traced sheets, which do not always agree with the street space.
- `pipeline/rpr/sources/vehicles.py` already cuts each vehicle's years against the model: the same check may be reused.
- Items of today (benches, lamps) inside a standing building may be a small disagreement between the City's positions and APUR's footprints: say which in the PR.

---
stream: era1920
priority: 1
status: open
added: 2026-11-21
needs: []
---
# Check what the Albert-Kahn licence allows for wall textures

Why: 3,993 of the 5,752 photos dated to 1900–1929 are Albert-Kahn autochromes, and they are the only colour source of the era. DATA_SOURCES.md says their licence is set per item (CC0, CC BY or not reusable) and that the data.gouv.fr record lists none. Cutting a photo into wall textures, and generating facades from it, makes derived works.

Done when: DATA_SOURCES.md says, for each licence value found in the dataset, whether textures and generated facades may be derived from the photo and what credit they need, with the number of era photos under each value; each Kahn photo carries its own licence in `photos.geojson`, so later steps can filter on it.

Notes:
- Dataset: `archives-de-la-planete-paris` on opendata.hauts-de-seine.fr; read the field descriptions and the museum's terms first. The harvester is `pipeline/rpr/sources/kahn.py`; a fresh harvest runs from GitHub Actions only (PROGRAM.md, "The Harvest workflow").
- If the terms do not settle it, stop: `status: blocked`, `blocked: owner — <question>`. Until then, later items use Paris Musées photos (CC0) only.

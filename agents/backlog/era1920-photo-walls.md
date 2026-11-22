---
stream: era1920
priority: 2
status: open
added: 2026-11-21
needs: [era1920-pose-by-hand, era1920-image-borders]
---
# Lay the posed photos on the walls of one street

Why: The first proof that a dated photo can become the facade itself, on one street before the whole island.

Done when:
- The pilot street is chosen: the Cité street with the most posed photos of 1900–1929 (counts per street in the PR).
- A pipeline command straightens each posed photo onto the walls it sees and writes one texture per wall, with the photo's id and date, the share of the wall it covers, and a mask of what hides the wall (trees, carts, people, other buildings).
- Walls seen at too flat an angle are left out; the PR states the limit and why.
- The PR shows a contact sheet: each wall of the street, with its photo texture or empty.

Notes:
- A wall is one edge of a footprint in `web/public/data/3d/cite-1836.geojson`, as high as the building. What a photo sees comes from casting rays against the model of the photo's year.
- Several photos of one wall: keep the most frontal one, record the others.
- Textures stay in `pipeline/cache/` for now; `era1920-atlas-in-app` decides the published format.
- Photos keep their licence and credit on every texture cut from them.

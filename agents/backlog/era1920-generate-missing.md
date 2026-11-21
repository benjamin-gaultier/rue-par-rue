---
stream: era1920
priority: 3
status: open
added: 2026-11-21
needs: [era1920-photo-walls, era1920-kahn-licence]
---
# Generate the walls no photo shows, from the photos of the same street

Why: Photos cover some walls of a street and miss others, and a street with holes cannot be walked. The missing walls are generated from what the photos show next door, and labelled as generated (CLAUDE.md, standing rules).

Done when:
- An open-weights image model is chosen and written into DATA_SOURCES.md: its name, its licence, and that it runs on this PC (RTX 3070, 8 GB).
- On the pilot street, each wall without a photo, and each hidden part of a photographed wall, is generated from the wall's known width, height, period and roof (APUR) and from the nearest photographed walls of the street.
- Every generated texture records the model, the seed and the ids of the photos it was made from. The same seed gives the same texture.
- The PR shows photo walls and generated walls side by side, and says what looks wrong.

Notes:
- Generation runs in the pipeline, never in the browser.
- No paid service, and no model whose licence limits publishing what it makes: stop for the owner instead (`status: blocked`).
- Atget's prints are black and white. Colouring a wall from the autochromes of the street is generation too: say so on the wall, or leave it grey. Decide in the PR, with examples of both.
- Only walls are generated. Footprints, heights, positions and dates keep coming from their sources.

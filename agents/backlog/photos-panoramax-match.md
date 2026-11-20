---
stream: photos
priority: 4
status: open
added: 2026-11-20
needs: [photos-headings]
---
# Pilot: refine photo positions by matching Panoramax pictures

Why: Geocoded positions sit on a street or a house number, not where the photographer stood. Matching the archive photo against today's street-level pictures nearby can find the real viewpoint for views of buildings still standing.

Done when: a pilot on 20 Cité photos with surviving buildings reports how many found a match and how far positions moved; matches go in as `matched` poses with a confidence, failures change nothing.

Notes:
- Panoramax API: pictures by place, already used by the viewer (`web/src`). Keep the pipeline standard-library first; a heavier matcher goes behind an optional extra, as `[depth]` and `[vision]` do.

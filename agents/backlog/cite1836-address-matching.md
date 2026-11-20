---
stream: cite1836
priority: 1
status: open
added: 2026-11-20
needs: []
---
# Match more Vasserot sheets to their parcels

Why: 63 of the 169 Cité sheets with a street number find no address match, so their real footprints are not drawn.

Done when: fewer than 30 sheets without a match, more sheets traced, the README numbers updated.

Notes:
- Likely causes from the README: renamed streets and number ranges ("12-14", bis, ter). The former street names table (`python -m rpr streetnames`) helps with renames.
- `python -m rpr trace --area cite` (needs `pip install -e ".[geo,vision]"`); output `web/public/data/3d/vasserot-traced-cite.geojson`.

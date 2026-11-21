---
stream: photos
priority: 3
status: open
added: 2026-11-21
needs: []
---
# Markets, courtyards and squares the gazetteers miss

Why: About 50 unplaced captions name a market or a square with a known site but no street of that name today: place Saint-Médard (14), markets (about 20: des Carmes, des Patriarches, Edgar-Quinet, des Blancs-Manteaux, Popincourt, Saint-Honoré, and 7 inside the pavilions of the Halles), the cour de l'Institut (6), the cour Saint-Julien-le-Pauvre (4), the carrefour Sainte-Opportune (2).

Done when: each name is matched to a site from a source (a former-name table, a market list of the City of Paris, BD TOPO, the street index), with the source recorded; names with no source stay unplaced; placed count goes up and 20 newly placed photos checked by hand are all right.

Notes:
- The place gazetteer is `pipeline/rpr/sources/places.py` (`python -m rpr places`); it already holds some markets by their BD TOPO outline.
- A market hall since moved or demolished must be placed where it stood in the photo's year, or not at all.

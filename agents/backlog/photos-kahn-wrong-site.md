---
stream: photos
priority: 4
status: open
added: 2026-11-21
needs: []
---
# Find Albert-Kahn photos filed on the wrong shared point

Why: Some shared points mix two places. One point carries the nave of Saint-Louis-en-l'Île and a statue "à l'intérieur de l'église St-Paul-St-Louis", 600 m away; the point inside Notre-Dame carries a view of the Bazar de l'Hôtel de Ville. Such a photo shows up in the wrong street.

Done when: the photos whose caption names a church, bridge, square or street that the places gazetteer puts more than 200 m from their shared point are listed with their distance; the clear cases are counted in the PR; and the app either places them from the caption (pose `geocoded`, archive point kept in `extra`) or leaves them, with the reason.

Notes:
- Only photos flagged `position_of: "place"` (PR #24). The gazetteer is `pipeline/cache/paris-places.json` (`python -m rpr places`).
- A procession or a view from a tower can name a far place and still be right: read 20 by hand before moving anything.

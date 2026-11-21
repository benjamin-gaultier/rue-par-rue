---
stream: quarters
priority: 3
status: open
added: 2026-11-21
needs: []
---
# What the sources hold for the Île Saint-Louis

Why: The island is the next quarter (`quarters-ile-saint-louis`). Knowing first what each source covers, and each bridge's history, keeps that item to drawing, and keeps anything from being invented.

Done when: a section in DATA_SOURCES.md (or the item's `done:` line, if short) gives for the island: Vasserot parcels and plan sheets that cover it, APUR buildings by period, Vasserot street outlines, trees and gardens, address points of 1836, and photos placed there; and `BRIDGES` in `pipeline/rpr/sources/site.py` has a sourced history, passing `check_history`, for each bridge of the island that lacks one.

Notes:
- The Cité's box (`AREAS["cite"]["bbox"]`, east edge 2.3565) already reaches the island's west point: `site-cite.geojson` draws the pont Saint-Louis, the pont Louis-Philippe and the pont de la Tournelle. Check which of them has a full history in `BRIDGES` and which only a year in `BRIDGE_YEARS` (`pipeline/rpr/sources/streets.py`). The pont Marie and the pont de Sully are outside the box and have only a year there.
- Find each bridge's generations (dates, material, arches, the houses on the pont Marie) in sources, as the Cité's were (structurae.net, paris.fr), and name them in `sources`. A value that is reasoned rather than read is flagged as such.
- About 485 of the 9,423 photos lie in a box around the island (2.3515, 48.8495, 2.3625, 48.8545), which overlaps the Cité's east end; count again with the island's outline.
- Adding a history for a bridge inside the Cité's box changes `site-cite.geojson`: rebuild with `python -m rpr site --area cite` and look at the bridge in the app at 1790, 1836, 1900 and today.
- Do not add the area itself here; propose its `bbox`, `focus` and `focus_river_m` in the write-up for `quarters-ile-saint-louis`.

---
stream: cite1836
priority: 3
status: open
added: 2026-11-27
needs: [cite1836-shop-names]
---
# Letter the directory's names and trades on the 1836 shopfronts

Why: `web/public/data/3d/directories-cite.json` says who kept shop in 1,789 buildings around 1836 (1,211 listings carry a trade the fronts can letter, `trade`), but every front still shows a trade picked by hash (`tradeOf` in `web/src/facades.ts`, `signRow` in `web/src/signs.ts`).

Done when: around 1836 (the years the directories cover, with a margin stated in the code), a shop in a building with a listing shows its listed trade and, where the front is wide enough, the name ("ROGÉ ÉPICIER"); outside those years and in buildings with no listing, the lettering stays generic; the README says how many fronts carry a real name; FXC compile times are measured before and after with `tools/fxc/`.

Notes:
- The sign atlas (`ATLAS`, 4 × 32 cells of 512 × 64) has no room for about a thousand names. A second atlas drawn at load time from the listings of the focus area (cells of 256 × 32, about 2,000) would; the shader needs the cell index and the year window per shop, for instance in the `info` value of the casing and the awning.
- The listing gives no frontage: put the listed shops on the building's shop runs in order, and say so in the code.
- The plain model (`model3d.ts`) and the detailed one (`city3d.ts`) both open the card; only the detailed one draws fronts.

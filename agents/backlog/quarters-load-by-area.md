---
stream: quarters
priority: 2
status: open
added: 2026-11-20
needs: [quarters-ile-saint-louis]
---
# Load each quarter only when it is near

Why: Every new quarter adds to the download and GPU memory. The Cité alone holds 74 MB of GPU buffers (measured on 2026-11-22, README "Baseline: the Cité alone"; the 20 MB quoted here before was out of date). A phone will not survive three quarters loaded at once.

Done when: quarters load as the camera comes near and unload when far; memory with two quarters stays near one quarter's.

Notes:
- Geometry packing is in `web/src/meshpack.ts`; the layer is `web/src/city3d.ts`.
- Measure with `node tools/baseline/measure.mjs` (tools/baseline/README.md) before and after.

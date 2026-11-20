---
stream: quarters
priority: 2
status: open
added: 2026-11-20
needs: [quarters-ile-saint-louis]
---
# Load each quarter only when it is near

Why: Every new quarter adds to the download and GPU memory. The phone budget (about 20 MB of GPU buffers for the Cité) will not survive three quarters loaded at once.

Done when: quarters load as the camera comes near and unload when far; memory with two quarters stays near one quarter's.

Notes:
- Geometry packing is in `web/src/meshpack.ts`; the layer is `web/src/city3d.ts`.

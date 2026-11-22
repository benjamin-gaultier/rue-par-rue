---
stream: quarters
priority: 2
status: done
done: 2026-11-22, PR #29, `tools/baseline/` measures an area (sizes.py, measure.mjs, `rpr.measure()` behind `?debug`); the Cité's numbers are in the README: 3,157 detailed buildings, 6.25 MB of data (0.91 MB gzipped), 74 MB of GPU buffers (not 20), first 3D frame 12 to 15 s, 2 to 6 ms a frame on this PC
added: 2026-11-21
needs: []
---
# Measure the Cité alone, as the baseline for every quarter

Why: Each quarter item asks for data size and frame time "against the Cité alone", but those numbers are written nowhere. Without them nobody can tell what a new quarter costs on a phone.

Done when: one documented way to measure (a script or a short list of steps anyone can repeat) gives, for the Cité at 1836 and today: buildings in the model, download size of `web/public/data/3d/` raw and gzipped, GPU buffer memory, time to first 3D frame, and frame time on this PC and in a phone-sized viewport; the numbers are in the README with the date and the machine.

Notes:
- On 2026-11-21 `cite-1836.geojson` holds 8,515 features in 4.8 MB, and `web/public/data/3d/` is 16 MB with the thumbnails and depth maps. Split the size by file.
- `quarters-load-by-area` quotes "about 20 MB of GPU buffers for the Cité": find where that came from and measure it again. Geometry packing is in `web/src/meshpack.ts`.
- Run the app on port 5176 (PROGRAM.md). `renderer.info` in three.js gives geometry and draw-call counts; frame time can come from `requestAnimationFrame` deltas over a fixed walk.
- Share the method with `robustness-load-time` rather than writing a second one if that item is done first.
- No shader change, so this does not wait for `robustness-fxc-check`.

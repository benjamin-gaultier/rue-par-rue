---
stream: quarters
priority: 2
status: open
added: 2026-11-22
needs: []
---
# Cut the Cité's GPU buffers before adding a quarter

Why: The detailed Cité holds 74 MB of vertex and index buffers, not the 20 MB the README gave until 2026-11-22. A second quarter of the same kind would double it, and phones drop the WebGL context when memory runs out.

Done when: the buffers by material are understood (which attributes, how many vertices each), the largest are cut without changing what is drawn, and `node tools/baseline/measure.mjs` gives the before and after; aim for under 40 MB. The README baseline is updated.

Notes:
- Measured on 2026-11-22 (README, "Baseline: the Cité alone"): unnamed materials 19.6 MB (trees, streets, street furniture, vehicles), details 17.7, roofs 16.4, facades 10.9, landmarks 7.2, walls 2.5.
- Give the materials of the trees (`web/src/city3d.ts`), streets (`web/src/streets.ts`) and vehicles (`web/src/vehicles.ts`) a name first, so the table splits them. A name becomes `#define SHADER_NAME` in the shader, and `onShaderError` in `city3d.ts` reads names starting with `walls-`: pick others.
- `web/src/meshpack.ts` packs the core meshes: positions and the `a_a`, `a_b`, `a_c` attributes are 32-bit floats, 12 to 16 bytes each per vertex. Check whether the module meshes (landmarks, streets, vehicles) go through `packMesh` at all, and whether `a_c` is stored for meshes that never read it.
- Positions are local metres within about 1 km: 16-bit integers at 2 cm steps would halve them. Check picking (`City3D.pick`) still works: it reads the position attribute.
- No shader logic should change; if an attribute type changes, run `python -I tools/fxc/check.py`.

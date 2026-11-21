---
stream: era1920
priority: 4
status: open
added: 2026-11-21
needs: [era1920-generate-missing]
---
# Show the era's walls in the app, and say what each one is

Why: The textures only matter once you can walk the street in 1920 and tell which walls are photographs.

Done when:
- For 1900–1929 the pilot street draws its walls from a texture atlas up close, and from today's shaders at a distance and in every other year.
- A building's card says of each wall: a photo (link and date), generated from photos (links, and the model), or drawn by rule. The 3D view has a legend for the three.
- The PR gives the atlas download size, GPU memory with and without it, the FXC compile time of the changed shaders, and the frame time on this PC and a phone-sized viewport.

Notes:
- The layer is `web/src/city3d.ts`, shaders in `web/src/cityshaders.ts`. Put the textured wall in a shader variant of its own (CLAUDE.md, the Windows Chrome rule) and measure it with `tools/fxc/`.
- Load the atlas only when the 3D view is open on a year of the era. The phone budget is about 20 MB of GPU buffers today.
- Images drawn by WebGL must be served from the site itself (no CORS headers on Paris Musées), so the atlas is committed generated data: built by a command, never edited by hand.

# What an area costs

Two scripts measure the 3D model of an area: what it downloads, what it holds on the GPU, how long the first 3D frame takes and how long a frame takes. Run them before and after adding a quarter. Today's numbers for the Île de la Cité are in the main README, under Performance.

## Download size

```sh
python -I tools/baseline/sizes.py --markdown
```

Prints each data file of the area in `web/public/data/3d/`, as stored and gzipped, the photo thumbnails and depth maps, and the number of buildings in the model. `--area` picks the area (default `cite`).

## In the browser

Build the app and serve it on the quarters port, then run the script from the repository root:

```sh
cd web
npm run build
npx vite preview --host 127.0.0.1 --port 5176 --strictPort
```

```sh
node tools/baseline/measure.mjs
```

It needs Node 22 or later and Chrome or Edge, and takes about three minutes. For each year (`--years 1836,2026`) and each viewport (1920 × 1080, and 375 × 812 at 3 device pixels per pixel, like a phone) it:

1. starts headless Chrome with an empty profile, so nothing is cached and every shader is compiled again;
2. opens the app in 3D at that year (`?debug#y=1836&d=3d`) and waits for the first frame with the detailed area;
3. calls `rpr.measure()` (`web/src/measure.ts`), which turns the camera once above the area and once at eye height where the walk starts, 360 frames each, after a first turn that is not timed.

It prints tables for the README and exits with 1 on a console error. Options: `--url`, `--years`, `--frames`, `--chrome PATH`, `--headed` (a visible window), `--json FILE` (everything measured).

What the numbers mean:

- **Detailed buildings**: those the detailed layer draws, with the houses on the bridges; "standing" are the ones shown that year.
- **GPU buffers**: vertex and index buffers of the detailed layer, by material. The plain blocks around the area, the map tiles and the textures are not counted.
- **First 3D frame**: from the start of the page load to the first frame with the detailed area. The files come from the same PC, so there is no network time in it.
- **Draw**: one frame drawn and finished by the GPU (`map.redraw()` then `gl.finish()`). This is the cost to compare between areas.
- **Between frames**: what the browser paints. It cannot go below the screen's refresh interval, so on a fast PC it only shows that no frame was late.

The phone-sized viewport runs on this PC's graphics card. It shows what the smaller, denser screen changes, not how fast a phone is. That needs a real phone: run `await rpr.measure()` in its console, through remote debugging, for the same numbers.

By hand, in any browser: open `http://127.0.0.1:5176/?debug#y=1836&d=3d`, wait for the island, and run `await rpr.measure()` in the console.

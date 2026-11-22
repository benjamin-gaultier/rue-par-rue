# Browser smoke test of the 3D view

The unit tests do not load WebGL. A shader that does not compile, a data file that is missing or a module that throws only shows in a browser. This test opens the built site in one.

```sh
cd web
npm run build
npm run smoke
```

It needs Node 22 or later and Chrome, Chromium or Edge. It installs nothing from npm: it talks to the browser over the DevTools protocol. It takes about 15 seconds:

1. serves `web/dist` on a free loopback port;
2. starts headless Chrome with software WebGL (SwiftShader), so the result does not depend on the computer's GPU;
3. opens the site on the Île de la Cité in 3D at 1836, waits for the detailed island to draw three frames, then does the same for today;
4. prints the time to the first 3D frames and the number of buildings drawn in detail.

It exits with 1 when:

- the page logs a console error or throws an uncaught error;
- a file of the site itself does not load (a 404 on a data file, a script that fails);
- a city module fails, a shader does not compile, or the WebGL context is lost;
- the page shows "The detailed island cannot be drawn on this device";
- the detailed island has not drawn after `--timeout` seconds (180 by default).

Trouble on other sites (IGN tiles, the cadastre server, Google Fonts) is printed but does not fail the test: those can be down without the build being wrong. The request for `/favicon.ico`, which the site does not have, is ignored.

## Options

| Option | Does |
| --- | --- |
| `--years 1790,1836,1900,today` | The years to show (default `1836,today`) |
| `--gl gpu` | Use this computer's GPU instead of software WebGL. On Windows this goes through Direct3D, so the time to the first frames includes the FXC shader compiles (see [../fxc/README.md](../fxc/README.md)) |
| `--screenshots DIR` | Save a picture of each year in `DIR` |
| `--dist DIR` | Test another build than `web/dist` |
| `--chrome PATH` | The browser to use (default: the `CHROME` variable, then the usual install places) |
| `--timeout SECONDS` | How long one year may take to draw |

With npm, give options after `--`: `npm run smoke -- --gl gpu --years 1790,1836,1900,today`.

## The parts

| File | Does |
| --- | --- |
| `smoke.mjs` | Starts the server and the browser, drives the page, prints the result |
| `lib.mjs` | What counts as a failure, and the static file server. Tested by `web/test/smoke.test.mjs` |

The test reads the page through `window.rpr`, which `web/src/main.ts` sets when the address has `?debug`, and through `City3D.frames`, the number of frames of the detailed island drawn without error.

## Not in CI yet

CI does not run this test: adding it changes `.github/`, which the owner reviews. The lines to add are in `agents/backlog/robustness-smoke-test-ci.md`.

# Shader compile check for Windows (FXC)

On Windows, Chrome draws WebGL through ANGLE, which translates each shader to HLSL and compiles it with Direct3D's FXC compiler (`d3dcompiler_47.dll`) on the GPU process thread. Long, branchy shaders take seconds there, and deep call chains can overflow its 1 MB stack and lose the WebGL context (fixed in PR #10). These scripts reproduce that compile outside the browser. Windows only.

## The check

```sh
python -I tools/fxc/check.py
```

Run it on a Windows PC before a pull request that changes a shader (CI runs on Linux and cannot). It needs `npm ci` done in `web/`, Chrome or Edge, and the .NET Framework compiler that ships with Windows. It takes about 20 seconds:

1. starts the Vite dev server (port 5177) and the loopback receiver;
2. opens `check.html` in headless Chrome on ANGLE's Direct3D 11 back end, which builds every 3D shader with three.js and posts the HLSL of each fragment shader;
3. compiles each one with `d3dcompiler_47` on a thread with a 1 MB stack, as Chrome's GPU process does, and prints the time and the instruction slots.

It exits with 1 when a shader does not compile, overflows the stack, or compiles for longer than 5 seconds (`--max-seconds`). Today's numbers are in the main README, under Performance. Times move by about 15 % from run to run; instruction slots do not.

`walls-all` is the wall shader with every family in one program, as it was before PR #10 split it. The app never draws it. It is compiled for comparison and marked "not drawn": the time limit does not apply to it.

Options: `--keep DIR` keeps the captured and filled HLSL (and `fxcstack.exe`) in `DIR`, to study one shader with the steps below; `--markdown` prints the table for the README; `--chrome PATH`, `--vite-port N`, `--stack-kb N`.

Only fragment shaders are compiled: the vertex shaders are short. Add new shader programs to the list in `harness.js`.

## The parts

| File | Does |
| --- | --- |
| `check.py` | The check above: runs everything below in one go |
| `check.html` | The page headless Chrome opens: runs `harness.js` and tells the receiver when it is done |
| `recv.py` | Loopback receiver: serves `check.html` and `harness.js`, and writes what the page posts to a folder |
| `harness.js` | Runs in `check.html` or in the dev page: builds every 3D shader with three.js, never links it, and posts the ANGLE HLSL of each fragment shader |
| `fill.py` | Fills ANGLE's placeholders so the HLSL compiles on its own |
| `fxc.py` | Compiles one HLSL file with `d3dcompiler_47` and prints time and instruction slots |
| `fxcstack.cs` | The same compile on a thread with a chosen stack size, to catch stack overflows; also prints time and instruction slots |

## By hand

To study one shader, or to compare a change with a capture you kept:

```sh
# 1. Receiver (keep it running), writing captures to cap/
mkdir cap
python -I tools/fxc/recv.py cap 8766

# 2. Dev server
cd web && npm run dev
```

3. In the dev page (http://localhost:5173), in the browser console:

   ```js
   window.__harnessTag = 'base'
   await import('http://127.0.0.1:8766/harness.js?' + Date.now())
   await window.__harness   // one line per shader: GLSL and HLSL sizes
   ```

   `cap/` now holds `base__<shader>.fs.hlsl` for every 3D shader. Add new shader programs to the list in `harness.js`.

4. Compile:

   ```sh
   mkdir filled
   python -I tools/fxc/fill.py filled cap/base__*.fs.hlsl
   python -I tools/fxc/fxc.py filled/base__walls.fs.hlsl default    # time and instruction slots

   # Stack check, 1 MB as in Chrome's GPU process (build once with the .NET Framework compiler):
   C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe /out:fxcstack.exe tools/fxc/fxcstack.cs
   ./fxcstack.exe filled/base__walls.fs.hlsl 1024                     # OK <seconds> <slots>, FAIL …, or the process dies of a stack overflow
   ```

`fxc.py` takes the config `default` (what ANGLE uses), `skipopt`, `avoidflow`, `preferflow`, `skipval` or `level3`, to see which compiler pass is slow. Keep `cap/`, `filled/` and `fxcstack.exe` out of the repository.

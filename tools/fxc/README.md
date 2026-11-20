# Shader compile check for Windows (FXC)

On Windows, Chrome draws WebGL through ANGLE, which translates each shader to HLSL and compiles it with Direct3D's FXC compiler (`d3dcompiler_47.dll`) on the GPU process thread. Long, branchy shaders take seconds there, and deep call chains can overflow its 1 MB stack and lose the WebGL context (fixed in PR #10). These scripts reproduce that compile outside the browser. Windows only.

| File | Does |
| --- | --- |
| `recv.py` | Loopback receiver: serves `harness.js` and writes what the page posts to a folder |
| `harness.js` | Runs in the dev page: builds every 3D shader with three.js, never links it, and posts the ANGLE HLSL of each fragment shader |
| `fill.py` | Fills ANGLE's placeholders so the HLSL compiles on its own |
| `fxc.py` | Compiles one HLSL file with `d3dcompiler_47` and prints time and instruction slots |
| `fxcstack.cs` | The same compile on a thread with a chosen stack size, to catch stack overflows |

## Steps

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
   ./fxcstack.exe filled/base__walls.fs.hlsl 1024                     # OK <seconds>, FAIL …, or the process dies of a stack overflow
   ```

`fxc.py` takes the config `default` (what ANGLE uses), `skipopt`, `avoidflow`, `preferflow`, `skipval` or `level3`, to see which compiler pass is slow. Keep `cap/`, `filled/` and `fxcstack.exe` out of the repository.

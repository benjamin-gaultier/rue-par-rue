// Loaded by check.html (python tools/fxc/check.py) or by hand in the dev page, see README.md. Builds every city shader program with three.js, never links it
// (so the D3D compiler never runs in the browser), and posts the ANGLE-translated HLSL of each
// fragment shader to the loopback receiver as <tag>__<label>.fs.hlsl.
window.__harness = (async () => {
  const tag = window.__harnessTag || 'run'
  const t = Date.now()
  // The Vite dev server the shaders come from ('' in the dev page itself), and the receiver this file came from.
  const vite = window.__harnessBase || ''
  const receiver = new URL(import.meta.url).origin
  const THREE = await import(`${vite}/node_modules/three/build/three.module.js`)
  const S = await import(`${vite}/src/cityshaders.ts?t=${t}`)
  const SS = await import(`${vite}/src/streetshaders.ts?t=${t}`)
  const VS = await import(`${vite}/src/vehicleshaders.ts?t=${t}`)
  const LS = await import(`${vite}/src/landmarkshaders.ts?t=${t}`)
  const variant = S.shaderVariant || ((src) => src)
  const walls = (fam) => variant(S.wallFragment, fam)
  const progs = [
    ['water', S.groundVertex, S.waterFragment],
    ['ground', S.groundVertex, S.groundFragment],
    ['lawns', S.gardenVertex, S.gardenFragment],
    ['walls', S.wallVertex, walls([])],
    ['walls-bridges', S.wallVertex, walls(['WALL_BRIDGES'])],
    ['walls-institutions', S.wallVertex, walls(['WALL_INSTITUTIONS'])],
    ['walls-landmarks', S.wallVertex, walls(['WALL_LANDMARKS'])],
    ['walls-all', S.wallVertex, walls(['WALL_BRIDGES', 'WALL_INSTITUTIONS', 'WALL_LANDMARKS'])],
    ['facades', S.wallVertex, S.facadeFragment],
    ['details', S.wallVertex, S.detailFragment],
    ['roofs', S.roofVertex, S.roofFragment],
    ['crown', S.crownVertex, S.crownFragment],
    ['trunk', S.trunkVertex, S.trunkFragment],
    ['treeShadow', S.treeShadowVertex, S.treeShadowFragment],
    ['props', LS.propVertex, LS.propFragment],
    ['pavement', SS.pavementVertex, SS.pavementFragment],
    ['decal', SS.decalVertex, SS.decalFragment],
    ['furniture', SS.furnitureVertex, SS.furnitureFragment],
    ['vehicle', VS.vehicleVertex, VS.vehicleFragment],
    ['vehicleShadow', VS.shadowVertex, VS.shadowFragment]
  ]
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas })
  const gl = renderer.getContext()
  const dbg = gl.getExtension('WEBGL_debug_shaders')
  const captured = []
  const src = new WeakMap()
  const ss = gl.shaderSource.bind(gl)
  gl.shaderSource = (s, text) => { src.set(s, text); ss(s, text) }
  const as = gl.attachShader.bind(gl)
  gl.attachShader = (p, s) => { (p.__sh ||= []).push(s); as(p, s) }
  gl.linkProgram = (p) => {
    p.__fake = true
    const sh = p.__sh
    const fs = sh.find((s) => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER)
    captured.push({ glsl: src.get(fs), hlsl: dbg.getTranslatedShaderSource(fs), ok: gl.getShaderParameter(fs, gl.COMPILE_STATUS), log: gl.getShaderInfoLog(fs) })
  }
  const gp = gl.getProgramParameter.bind(gl)
  gl.getProgramParameter = (p, n) => (p && p.__fake ? (n === gl.LINK_STATUS ? true : n === gl.ACTIVE_UNIFORMS || n === gl.ACTIVE_ATTRIBUTES ? 0 : gp(p, n)) : gp(p, n))
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  const camera = new THREE.PerspectiveCamera()
  const post = (n, b) => fetch(`${receiver}/${n}`, { method: 'POST', body: b }).then((r) => r.text())
  const out = []
  for (const [label, vs, fs] of progs) {
    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(geo, new THREE.ShaderMaterial({ name: label, vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide, transparent: true })))
    const before = captured.length
    renderer.compile(scene, camera)
    const c = captured[before]
    if (!c) { out.push(`${label}: no program`); continue }
    await post(`${tag}__${label}.fs.hlsl`, c.hlsl)
    await post(`${tag}__${label}.fs.glsl`, c.glsl)
    out.push(`${label}: glsl ${c.glsl.length} hlsl ${c.hlsl.length}${c.ok ? '' : ' COMPILE ERROR ' + c.log.slice(0, 200)}`)
  }
  renderer.dispose()
  return out.join('\n')
})()

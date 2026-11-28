/**
 * Photo scenes: a posed photograph painted onto the 3D model.
 *
 * A slide projector stands where the photographer stood and throws the
 * picture onto the model's walls, roofs and ground. Seen from that place the
 * model looks like the photograph; walk a few steps and the streets keep the
 * photograph's light and wear, until you reach a wall the camera did not see.
 *
 * Nothing new is drawn. A surface takes the photograph's colour only where
 * the camera saw it (a depth map rendered from the photo's camera), where
 * the picture is not sky, leaves or a museum's label (masks made by
 * `python -m rpr scenes`), and where it does not face the camera edge on.
 * Everywhere else the model shows as it always does.
 *
 * The pictures are same-origin copies in data/3d/scenes/: a WebGL texture
 * needs CORS, which the archives do not send.
 */

import * as THREE from 'three'
import type { Camera } from './photos'

/** Near and far planes of the projector, metres. */
export const NEAR = 0.3
export const FAR = 2500

const rad = (d: number) => (d * Math.PI) / 180

/**
 * The photo camera's view and projection, in the city's local metres (x east,
 * y north, z up; `eye` is the camera there). Clip space covers the picture:
 * x and y from -1 to 1 across its width and height. The point straight ahead
 * sits below the middle by the rising front (`shift`), as in standin.ts.
 * `roll` turns the camera clockwise about its axis, as MapLibre's roll does.
 */
export function photoMatrices(c: Pick<Camera, 'bearing' | 'pitch' | 'roll' | 'hfov' | 'shift'>, eye: THREE.Vector3, aspect: number) {
  const b = rad(c.bearing)
  const p = rad(c.pitch)
  const r = rad(c.roll)
  const f0 = new THREE.Vector3(Math.sin(b), Math.cos(b), 0)
  const r0 = new THREE.Vector3(Math.cos(b), -Math.sin(b), 0)
  const u0 = new THREE.Vector3(0, 0, 1)
  const fwd = f0.clone().multiplyScalar(Math.cos(p)).addScaledVector(u0, Math.sin(p))
  const up1 = u0.clone().multiplyScalar(Math.cos(p)).addScaledVector(f0, -Math.sin(p))
  const right = r0.clone().multiplyScalar(Math.cos(r)).addScaledVector(up1, -Math.sin(r))
  const up = up1.clone().multiplyScalar(Math.cos(r)).addScaledVector(r0, Math.sin(r))
  // The camera's own frame (x right, y up, looking down -z), placed at the eye.
  const world = new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()).setPosition(eye)
  const view = world.clone().invert()
  const fx = 0.5 / Math.tan(rad(c.hfov) / 2)
  const fy = fx * aspect
  const proj = new THREE.Matrix4().set(
    2 * fx, 0, 0, 0,
    0, 2 * fy, 2 * c.shift, 0,
    0, 0, -(FAR + NEAR) / (FAR - NEAR), (-2 * FAR * NEAR) / (FAR - NEAR),
    0, 0, -1, 0
  )
  return { world, view, proj, viewProj: proj.clone().multiply(view) }
}

const aliveGlsl = /* glsl */ `
uniform float u_year;
attribute vec4 a_life;
bool alive() {
  return u_year >= a_life.x && u_year < a_life.y && !(u_year >= a_life.z && u_year < a_life.w);
}
`

/**
 * Distance seen from the photo's camera, of what stands that year. It is
 * packed into the three bytes of an ordinary colour target (a share of FAR,
 * to about a millimetre): depth textures read back as zero on some devices.
 */
export const depthVertex = /* glsl */ `
${aliveGlsl}
varying float v_dist;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  v_dist = -mv.z;
  gl_Position = alive() ? projectionMatrix * mv : vec4(0.0, 0.0, 2.0, 1.0);
}
`
export const depthFragment = /* glsl */ `
varying float v_dist;
void main() {
  float d = clamp(v_dist / ${FAR.toFixed(1)}, 0.0, 1.0) * 0.99999;
  vec3 e = fract(d * vec3(1.0, 255.0, 65025.0));
  e -= e.yzz * vec3(1.0 / 255.0, 1.0 / 255.0, 0.0);
  gl_FragColor = vec4(e, 1.0);
}
`

export const paintVertex = /* glsl */ `
${aliveGlsl}
varying vec3 v_world;
varying vec3 v_normal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  v_world = w.xyz;
  v_normal = mat3(modelMatrix) * normal;
  gl_Position = alive() ? projectionMatrix * modelViewMatrix * vec4(position, 1.0) : vec4(0.0, 0.0, 2.0, 1.0);
}
`

/**
 * Kept short and branch-light for Direct3D's shader compiler (CLAUDE.md):
 * one projection, three texture reads, no loops.
 */
export const paintFragment = /* glsl */ `
uniform sampler2D u_photo;
uniform sampler2D u_mask;
uniform sampler2D u_depth;
uniform mat4 u_photoMatrix;
uniform vec3 u_eye;
uniform float u_opacity;
varying vec3 v_world;
varying vec3 v_normal;
float metres(vec3 e) {
  return dot(e, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0)) * ${FAR.toFixed(1)};
}
void main() {
  vec4 c = u_photoMatrix * vec4(v_world, 1.0);
  if (c.w < ${NEAR.toFixed(2)}) discard;
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  float inside = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  if (inside < 0.0) discard;
  // Seen by the camera: no nearer surface in its depth map (bias grows with distance).
  if (c.w > metres(texture2D(u_depth, uv).rgb) + 0.3 + 0.012 * c.w) discard;
  vec3 m = texture2D(u_mask, uv).rgb;
  if (max(m.r, max(m.g, m.b)) > 0.5) discard;
  vec3 n = normalize(v_normal);
  float facing = abs(dot(n, normalize(u_eye - v_world)));
  // Ground keeps the picture at any angle; a wall seen edge on would smear it.
  float a = abs(n.z) > 0.9 ? 1.0 : smoothstep(0.06, 0.22, facing);
  a *= smoothstep(0.0, 0.015, inside) * u_opacity;
  gl_FragColor = vec4(texture2D(u_photo, uv).rgb, a);
}
`

/** True for meshes the photograph can be painted on: plain (not instanced) model geometry with years and normals. */
export function paintable(mesh: THREE.Mesh): boolean {
  const g = mesh.geometry
  const m = mesh.material as THREE.Material
  if (Array.isArray(mesh.material) || g instanceof THREE.InstancedBufferGeometry) return false
  if (!g.getAttribute('a_life') || !g.getAttribute('normal')) return false
  return m.name !== 'water' && m.depthWrite !== false
}

export interface PhotoScene {
  id: string
  camera: Camera
  /** Local metres of the camera on the ground (z is added from camera.height). */
  at: [number, number]
  image: string
  mask: string
  aspect: number
}

/**
 * Paints one photograph onto a set of meshes. Owned by City3D: it calls
 * `depthPass` before its frame when `needsDepth` and `paint` after it.
 */
export class PhotoProjector {
  readonly paintScene = new THREE.Scene()
  private depthScene = new THREE.Scene()
  private cam = new THREE.Camera()
  private target?: THREE.WebGLRenderTarget
  private photo?: THREE.Texture
  private mask?: THREE.Texture
  private loading = 0
  private depthMaterial: THREE.ShaderMaterial
  private paintMaterial: THREE.ShaderMaterial
  scene?: PhotoScene
  /** True when the depth map must be drawn again (new photo, camera or year). */
  needsDepth = false
  /** True once both pictures are loaded and the depth map is drawn. */
  ready = false

  constructor(year: THREE.IUniform<number>) {
    this.depthMaterial = new THREE.ShaderMaterial({ name: 'photo-depth', vertexShader: depthVertex, fragmentShader: depthFragment, uniforms: { u_year: year }, side: THREE.DoubleSide })
    this.paintMaterial = new THREE.ShaderMaterial({
      name: 'photo-paint',
      vertexShader: paintVertex,
      fragmentShader: paintFragment,
      uniforms: {
        u_year: year,
        u_photo: { value: null },
        u_mask: { value: null },
        u_depth: { value: null },
        u_photoMatrix: { value: new THREE.Matrix4() },
        u_eye: { value: new THREE.Vector3() },
        u_opacity: { value: 1 }
      },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthFunc: THREE.LessEqualDepth,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2
    })
    this.cam.matrixAutoUpdate = false
  }

  /** Paint on these meshes (their geometry is shared, not copied). */
  setMeshes(meshes: THREE.Mesh[]) {
    this.paintScene.clear()
    this.depthScene.clear()
    for (const src of meshes.filter(paintable)) {
      for (const [scene, material] of [
        [this.paintScene, this.paintMaterial],
        [this.depthScene, this.depthMaterial]
      ] as const) {
        const m = new THREE.Mesh(src.geometry, material)
        m.matrixAutoUpdate = false
        m.matrix.copy(src.matrixWorld)
        m.frustumCulled = false
        scene.add(m)
      }
    }
    this.needsDepth = true
  }

  get meshCount(): number {
    return this.paintScene.children.length
  }

  /** Show a photograph, or none. Resolves when its pictures are loaded. */
  async set(scene: PhotoScene | undefined, onLoad: () => void): Promise<void> {
    const token = ++this.loading
    this.ready = false
    this.scene = scene
    this.photo?.dispose()
    this.mask?.dispose()
    this.photo = this.mask = undefined
    if (!scene) return
    const loader = new THREE.TextureLoader()
    const [photo, mask] = await Promise.all([loader.loadAsync(scene.image), loader.loadAsync(scene.mask)])
    if (token !== this.loading) {
      photo.dispose()
      mask.dispose()
      return
    }
    photo.colorSpace = THREE.NoColorSpace // the shaders work in the picture's own values, as the walls do
    for (const t of [photo, mask]) {
      t.generateMipmaps = false
      t.minFilter = THREE.LinearFilter
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
    }
    this.photo = photo
    this.mask = mask
    const u = this.paintMaterial.uniforms
    u.u_photo.value = photo
    u.u_mask.value = mask
    this.setCamera(scene.camera)
    onLoad()
  }

  /** Move the projector (adjust mode moves the camera while you watch). */
  setCamera(camera: Camera) {
    if (!this.scene) return
    this.scene.camera = camera
    const eye = new THREE.Vector3(this.scene.at[0], this.scene.at[1], camera.height)
    const { world, proj, viewProj } = photoMatrices(camera, eye, this.scene.aspect)
    this.cam.matrix.copy(world)
    this.cam.projectionMatrix.copy(proj)
    this.cam.projectionMatrixInverse.copy(proj).invert()
    this.paintMaterial.uniforms.u_photoMatrix.value.copy(viewProj)
    this.paintMaterial.uniforms.u_eye.value.copy(eye)
    this.needsDepth = true
  }

  set opacity(v: number) {
    this.paintMaterial.uniforms.u_opacity.value = v
  }

  get opacity(): number {
    return this.paintMaterial.uniforms.u_opacity.value
  }

  /** Draw the depth map from the photo's camera. Leaves the renderer drawing to the canvas again. */
  depthPass(renderer: THREE.WebGLRenderer) {
    if (!this.scene || !this.photo) return
    const w = 1024
    const h = Math.max(64, Math.round(w / this.scene.aspect))
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.dispose()
      this.target = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false })
      this.paintMaterial.uniforms.u_depth.value = this.target.texture
    }
    this.cam.updateMatrixWorld(true)
    renderer.setRenderTarget(this.target)
    const d = renderer.state.buffers.depth
    d.setTest(true)
    d.setMask(true) // the map may leave depth writes off, and clear() does not turn them on
    renderer.setClearColor(0xffffff, 1) // nothing there: as far as can be
    renderer.clear(true, true, false)
    renderer.render(this.depthScene, this.cam)
    renderer.setRenderTarget(null)
    this.needsDepth = false
    this.ready = true
  }

  /** True when there is something to paint this frame. */
  get active(): boolean {
    return this.ready && !!this.scene && this.opacity > 0
  }

  dispose() {
    this.loading++
    this.photo?.dispose()
    this.mask?.dispose()
    this.target?.dispose()
    this.depthMaterial.dispose()
    this.paintMaterial.dispose()
  }
}

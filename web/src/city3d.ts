/**
 * The detailed island (the Île de la Cité and the facing quays): procedural
 * buildings with storeys, windows, shopfronts, mansard and tile roofs,
 * chimneys, paved streets, and the Seine sunk between its quays with each
 * bridge as it stood that year (bridges.ts).
 *
 * A MapLibre custom layer drawn with three.js in the map's WebGL context,
 * sharing its depth buffer with the plain blocks of the rest of the model.
 * The year is a shader uniform: changing it costs nothing, buildings that do
 * not stand that year are dropped on the GPU.
 *
 * Data: the massing model (python -m rpr model3d), whose buildings in the
 * focus area carry `focus: true`, and the site file (python -m rpr site):
 * river, ground, quay edges, bridge decks and the spire of Notre-Dame.
 */

import * as THREE from 'three'
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl'
import {
  addQuay,
  addRailing,
  addSpire,
  addSurface,
  buildCity,
  insidePoly,
  MeshData,
  normalisePoly,
  ROOF_MATERIAL,
  STYLE,
  type BuildingSpec,
  type Poly,
  type Pt,
  type RoofShape,
  type TreeSpec
} from './citygen'
import * as S from './cityshaders'
import { addBridgeHistory, type BridgeProps } from './bridges'
import { packMesh } from './meshpack'
import { signAtlas } from './signs'
import type { ModelProps } from './model3d'

export const SITE_URL = 'data/3d/site-cite.geojson'
export const GREENERY_URL = 'data/3d/greenery-cite.json'

interface Greenery {
  gardens: { features: { geometry: Geometry; properties: { name: string; from: number; until?: number; dated: boolean; note: string } }[] }
  trees: { fields: string[]; rows: number[][] }
}

/** Trees from the compact rows of the greenery file. */
export function treesOf(g: Greenery, project: (p: number[]) => Pt): TreeSpec[] {
  const f = g.trees.fields
  const col = (name: string) => f.indexOf(name)
  const [lon, lat, h, group, planted, girth] = ['lon', 'lat', 'height_m', 'group', 'planted', 'girth_cm'].map(col)
  return g.trees.rows.map((r) => {
    const [x, y] = project([r[lon], r[lat]])
    return { x, y, height: r[h], group: r[group], planted: r[planted], girth: r[girth] || 0 }
  })
}

/** Instanced geometry: one copy of `base` per tree, with the tree's attributes. */
function treeGeometry(base: THREE.BufferGeometry, trees: TreeSpec[]): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  g.setAttribute('position', base.getAttribute('position'))
  if (base.getAttribute('normal')) g.setAttribute('normal', base.getAttribute('normal'))
  const a = new Float32Array(trees.length * 4)
  const b = new Float32Array(trees.length * 4)
  trees.forEach((t, i) => {
    a.set([t.x, t.y, t.height, t.group], i * 4)
    b.set([t.planted, seedOf(`${t.x.toFixed(2)}:${t.y.toFixed(2)}`), t.girth, 0], i * 4)
  })
  g.setAttribute('a_tree', new THREE.InstancedBufferAttribute(a, 4))
  g.setAttribute('a_tree2', new THREE.InstancedBufferAttribute(b, 4))
  g.instanceCount = trees.length
  return g
}

/**
 * Crown detail by distance from the camera (metres): icosahedra of detail 2
 * (180 faces) within the first radius, 1 (80) within the second, 0 (20)
 * beyond, where the haze has begun and a crown is a few pixels wide.
 */
export const TREE_LEVELS_M = [160, 450]
/** The trees are sorted again when the camera has moved this far. */
const TREE_RESORT_M = 30

/** Indices of the trees in each distance band from (x, y): one list per radius, and one for the rest. */
export function partitionTrees(trees: Pick<TreeSpec, 'x' | 'y'>[], x: number, y: number, radii: number[] = TREE_LEVELS_M): number[][] {
  const out = [...radii, Infinity].map(() => [] as number[])
  const r2 = radii.map((r) => r * r)
  trees.forEach((t, i) => {
    const d2 = (t.x - x) ** 2 + (t.y - y) ** 2
    let level = r2.findIndex((r) => d2 < r)
    if (level < 0) level = radii.length
    out[level].push(i)
  })
  return out
}

/**
 * A cheap level of detail for the crowns: every crown mesh holds every
 * tree's attributes and draws only the trees of its distance band, refilled
 * when the camera has moved TREE_RESORT_M.
 */
function treeLevels(trees: TreeSpec[], levels: THREE.InstancedBufferGeometry[]) {
  const src = ['a_tree', 'a_tree2'].map((k) => Float32Array.from((levels[0].getAttribute(k) as THREE.InstancedBufferAttribute).array as Float32Array))
  let last: [number, number] | undefined
  return (camera: THREE.Vector3) => {
    if (last && Math.hypot(camera.x - last[0], camera.y - last[1]) < TREE_RESORT_M) return
    last = [camera.x, camera.y]
    const bands = partitionTrees(trees, camera.x, camera.y)
    levels.forEach((g, level) => {
      const list = bands[level]
      ;['a_tree', 'a_tree2'].forEach((k, j) => {
        const attr = g.getAttribute(k) as THREE.InstancedBufferAttribute
        const out = attr.array as Float32Array
        list.forEach((i, n) => out.set(src[j].subarray(i * 4, i * 4 + 4), n * 4))
        attr.needsUpdate = true
      })
      g.instanceCount = list.length
    })
  }
}

export interface CityProps extends ModelProps {
  id: string
  from?: number
  until?: number
  roof?: 'flat' | 'mansard' | 'gable'
  roof_material?: 'tile' | 'zinc' | 'mineral' | 'planted'
  landmark?: boolean
  focus?: boolean
}

type Geometry = { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] }
interface Feature<P> {
  geometry: Geometry | { type: 'Point'; coordinates: number[] } | { type: 'LineString'; coordinates: number[][] }
  properties: P
}

const OPEN = 1e4

/** A stable 0..1 number from a string. */
export function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10007) / 10007
}

/** Years a building stands, as the shader reads them: [from, until, gapFrom, gapUntil]. */
export function lifeOf(p: Pick<CityProps, 'kind' | 'from' | 'until'>): [number, number, number, number] {
  if (p.kind === 'standing') return [-OPEN, OPEN, 0, 0]
  if (p.kind === 'reconstructed') return [p.from ?? -OPEN, p.until ?? 1860, 0, 0]
  return [p.from ?? 1851, OPEN, 0, 0]
}

export function styleOf(p: CityProps): number {
  if (p.landmark) return STYLE.monument
  if (p.kind === 'standing' || p.kind === 'reconstructed') return STYLE.old
  if (p.kind === 'later' && (p.from ?? 0) >= 1915) return STYLE.modern
  return STYLE.haussmann
}

export function roofOf(p: CityProps): { shape: RoofShape; material: number } {
  if (p.roof === 'flat') return { shape: 'flat', material: p.landmark ? ROOF_MATERIAL.stone : ROOF_MATERIAL.mineral }
  if (p.landmark) return { shape: 'gable', material: ROOF_MATERIAL.lead }
  const material = ROOF_MATERIAL[p.roof_material ?? 'zinc'] ?? ROOF_MATERIAL.zinc
  return { shape: p.roof === 'gable' ? 'gable' : 'mansard', material }
}

export function specOf(p: CityProps, polys: Poly[]): BuildingSpec {
  const roof = roofOf(p)
  return { polys, height: p.height, roof: roof.shape, roofMaterial: roof.material, style: styleOf(p), seed: seedOf(p.id ?? ''), life: lifeOf(p) }
}

/**
 * Where a church's west front stands: the line across its westernmost
 * points, perpendicular to the axis (a compass bearing, west to east).
 */
export function westFront(polys: Poly[], bearing: number): { centre: Pt; axis: Pt; half: number } {
  const r = (bearing * Math.PI) / 180
  const axis: Pt = [Math.sin(r), Math.cos(r)]
  const across: Pt = [-axis[1], axis[0]]
  const pts = polys.flatMap((p) => p[0])
  const along = (p: Pt) => p[0] * axis[0] + p[1] * axis[1]
  const side = (p: Pt) => p[0] * across[0] + p[1] * across[1]
  const west = Math.min(...pts.map(along))
  const front = pts.filter((p) => along(p) < west + 3)
  const t0 = Math.min(...front.map(side))
  const t1 = Math.max(...front.map(side))
  const t = (t0 + t1) / 2
  return { centre: [axis[0] * west + across[0] * t, axis[1] * west + across[1] * t], axis, half: (t1 - t0) / 2 }
}

export function aliveIn(life: [number, number, number, number], year: number): boolean {
  return year >= life[0] && year < life[1] && !(year >= life[2] && year < life[3])
}

/** GPU geometry for a mesh, with shared vertices merged behind an index (see meshpack.ts). */
function geometry(m: MeshData): THREE.BufferGeometry {
  const p = packMesh(m)
  const g = new THREE.BufferGeometry()
  g.setIndex(new THREE.BufferAttribute(p.index, 1))
  g.setAttribute('position', new THREE.BufferAttribute(p.position, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3, true))
  g.setAttribute('a_a', new THREE.BufferAttribute(p.a, 4))
  g.setAttribute('a_b', new THREE.BufferAttribute(p.b, 4))
  g.setAttribute('a_life', new THREE.BufferAttribute(p.life, 4))
  if (p.c) g.setAttribute('a_c', new THREE.BufferAttribute(p.c, 4))
  g.computeBoundingSphere()
  return g
}

/** The sun from the south-west, about 40° up: light on the Seine-facing facades of the Cité. */
const SUN = new THREE.Vector3(-0.55, -0.6, 0.64).normalize()

/** Shader uniforms shared by every mesh of the city: pass this object to a ShaderMaterial as is. */
export interface CityUniforms {
  [name: string]: THREE.IUniform
  /** The year shown. Hide what does not stand: see `alive()` in cityshaders.ts. */
  u_year: { value: number }
  /** The camera, in local metres (for haze, reflections). */
  u_camera: { value: THREE.Vector3 }
  /** Unit vector toward the sun. */
  u_sun: { value: THREE.Vector3 }
  /** The detailed ground box (x0, y0, x1, y1), where everything fades out at the edge. */
  u_box: { value: THREE.Vector4 }
  u_fog: { value: THREE.Color }
  u_front: { value: THREE.Vector4 }
  u_frontHalf: { value: number }
  /** Lettering for shop signs and house numbers (signs.ts), drawn on a canvas at load. */
  u_signs: { value: THREE.Texture }
}

/** What every city module can read before and after the buildings are built. */
export interface PrepareContext {
  /** Local metres (x east, y north) for [lon, lat]. */
  project: (lonlat: number[]) => Pt
  /** URL prefix for data files: fetch(`${ctx.base}data/3d/…`). */
  base: string
  model: { features: Feature<CityProps>[]; metadata?: Record<string, unknown> }
  site: { features: Feature<Record<string, unknown>>[]; metadata?: Record<string, unknown> }
  /** The detailed buildings; index i is the owner id of their wall and roof triangles. */
  buildings: { specs: BuildingSpec[]; props: CityProps[] }
}

/** What a module gets once the core city is built. */
export interface CityContext extends PrepareContext {
  uniforms: CityUniforms
  water: Poly[]
  bridges: Poly[]
  /** Water surface height, metres relative to the street (about -6.6). */
  waterZ: number
  /** Add an object to the scene. Core render orders: water 0, ground 1, walls 2, roofs 3, trees 4. */
  add(object: THREE.Object3D): void
  /** Walking: return true where nobody can stand in `year` (local metres). */
  block(test: (p: Pt, year: number) => boolean): void
  /** Called before each frame; return true to ask for another frame (animation). Keep it cheap. */
  animate(step: (seconds: number) => boolean): void
  /** Ask the map for a new frame. */
  repaint(): void
}

/**
 * A layer of detail added to the city in its own file (registered in
 * citymodules.ts). `prepare` runs before the buildings are built and may
 * change their specs (style, roof, height, or empty `polys` to draw a
 * building itself); `build` runs after and adds meshes. A module that throws
 * is skipped with a warning: the rest of the city still shows.
 */
export interface CityModule {
  name: string
  prepare?(ctx: PrepareContext): void | Promise<void>
  build?(ctx: CityContext): void | Promise<void>
}

export class City3D implements CustomLayerInterface {
  readonly id = 'city-3d'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  private map?: MapLibreMap
  private renderer?: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private origin: MercatorCoordinate
  private meter: number
  private matrix = new THREE.Matrix4()
  private inverse = new THREE.Matrix4()
  private visible = true
  private specs: BuildingSpec[] = []
  private props: CityProps[] = []
  private pickables: { mesh: THREE.Mesh; owner: Int32Array }[] = []
  private water: Poly[] = []
  private bridges: Poly[] = []
  private uniforms: CityUniforms = {
    u_year: { value: 1836 },
    u_camera: { value: new THREE.Vector3() },
    u_sun: { value: SUN },
    u_box: { value: new THREE.Vector4(-1e5, -1e5, 1e5, 1e5) },
    u_fog: { value: new THREE.Color('#e6e1d6') },
    u_front: { value: new THREE.Vector4() },
    u_frontHalf: { value: 0 },
    u_signs: { value: signAtlas() }
  }
  /** Number of detailed buildings and trees, for the legend and tests. */
  count = 0
  trees = 0
  private extras: THREE.Mesh[] = []
  private treeLod?: (camera: THREE.Vector3) => void
  private blockers: ((p: Pt, year: number) => boolean)[] = []
  private steps: ((seconds: number) => boolean)[] = []
  /** Modules that failed to load, by name (shown in the console only). */
  failed: string[] = []

  constructor(center: [number, number]) {
    this.origin = MercatorCoordinate.fromLngLat(center, 0)
    this.meter = this.origin.meterInMercatorCoordinateUnits()
  }

  /** Local metres (x east, y north) for a longitude/latitude. */
  project = ([lon, lat]: number[]): Pt => {
    const m = MercatorCoordinate.fromLngLat([lon, lat], 0)
    return [(m.x - this.origin.x) / this.meter, -(m.y - this.origin.y) / this.meter]
  }

  private polys(g: Geometry): Poly[] {
    const list = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
    return list.map((rings) => normalisePoly(rings.map((r) => r.map(this.project)))).filter((p): p is Poly => p !== null)
  }

  /** Build every mesh from the model and site files, then let each module add its own. */
  async load(modelUrl: string, siteUrl: string, greeneryUrl?: string, modules: CityModule[] = [], base = '') {
    const [model, site, greenery] = await Promise.all([
      fetch(modelUrl).then((r) => r.json()),
      fetch(siteUrl).then((r) => r.json()),
      greeneryUrl
        ? fetch(greeneryUrl)
            .then((r) => (r.ok ? (r.json() as Promise<Greenery>) : undefined))
            .catch(() => undefined)
        : Promise.resolve(undefined)
    ])
    const features = (model.features as Feature<CityProps>[]).filter((f) => f.properties.focus)
    const cathedral = (site.features as Feature<{ kind: string; ids?: string[]; axis_bearing?: number }>[]).find((f) => f.properties.kind === 'cathedral')?.properties
    const cathedralIds = new Set(cathedral?.ids ?? [])
    const cathedralPolys: Poly[] = []
    for (const f of features) {
      const polys = this.polys(f.geometry as Geometry)
      if (!polys.length) continue
      const spec = specOf(f.properties, polys)
      if (cathedralIds.has(f.properties.id)) {
        spec.style = STYLE.cathedral
        cathedralPolys.push(...polys)
      }
      this.specs.push(spec)
      this.props.push(f.properties)
    }
    const prepare: PrepareContext = { project: this.project, base, model, site, buildings: { specs: this.specs, props: this.props } }
    for (const mod of modules) {
      try {
        await mod.prepare?.(prepare)
      } catch (err) {
        this.failed.push(mod.name)
        console.warn(`City module ${mod.name} failed to prepare:`, err)
      }
    }
    if (cathedral?.axis_bearing !== undefined && cathedralPolys.length) {
      const front = westFront(cathedralPolys, cathedral.axis_bearing)
      this.uniforms.u_front.value.set(front.centre[0], front.centre[1], front.axis[0], front.axis[1])
      this.uniforms.u_frontHalf.value = front.half
    }
    this.count = this.specs.length
    const { walls, facades, roofs, details } = buildCity(this.specs)

    const meta = site.metadata ?? {}
    const waterZ = (meta.water_level_m ?? 27) - (meta.street_level_m ?? 34) + 0.4
    if (meta.ground_box) {
      const [x0, y0] = this.project([meta.ground_box[0], meta.ground_box[1]])
      const [x1, y1] = this.project([meta.ground_box[2], meta.ground_box[3]])
      this.uniforms.u_box.value.set(x0, y0, x1, y1)
    }
    const ground = new MeshData()
    const water = new MeshData()
    const siteFeatures = site.features as Feature<{ kind: string; [k: string]: unknown }>[]
    // Quay walls stop under the decks of bridges still standing; a deck of the past leaves no gap.
    const standing: Poly[] = []
    for (const f of siteFeatures) {
      if (f.properties.kind !== 'bridge') continue
      const polys = this.polys(f.geometry as Geometry)
      this.bridges.push(...polys)
      const history = (f.properties as unknown as BridgeProps).history
      if (!history?.length || history[history.length - 1].until == null) standing.push(...polys)
    }
    const underDeck = (p: Pt) => standing.some((b) => insidePoly(p, b))
    for (const f of siteFeatures) {
      const k = f.properties.kind
      if (k === 'ground') for (const poly of this.polys(f.geometry as Geometry)) addSurface(ground, poly, 0)
      else if (k === 'water') {
        const polys = this.polys(f.geometry as Geometry)
        this.water.push(...polys)
        for (const poly of polys) addSurface(water, poly, waterZ)
      } else if (k === 'quay' && f.geometry.type === 'LineString') {
        addQuay(walls, f.geometry.coordinates.map(this.project), waterZ - 0.3, 0.9, -1.2, underDeck)
      } else if (k === 'spire' && f.geometry.type === 'Point') {
        const p = f.properties as unknown as { base_m: number; height_m: number; from: number; gap?: [number, number] }
        const life: [number, number, number, number] = [p.from, OPEN, p.gap?.[0] ?? 0, p.gap?.[1] ?? 0]
        addSpire(roofs, -1, this.project(f.geometry.coordinates), 3.0, p.base_m, p.base_m + 9, p.height_m, life)
      }
    }
    // Bridges through time: each structure of each crossing in the years it stood (bridges.ts).
    for (const f of siteFeatures) {
      if (f.properties.kind !== 'bridge') continue
      const history = (f.properties as unknown as BridgeProps).history
      for (const deck of this.polys(f.geometry as Geometry)) addBridgeHistory(walls, deck, waterZ - 0.3, history)
    }

    // Gardens: lawns inside cast-iron railings, from the year they opened.
    const lawns = new MeshData()
    let trees: TreeSpec[] = []
    if (greenery) {
      for (const f of greenery.gardens.features) {
        const life = [f.properties.from, f.properties.until ?? OPEN, 0, 0]
        for (const poly of this.polys(f.geometry)) {
          addSurface(lawns, poly, 0.05, 0, life)
          addRailing(walls, poly, 1.0, life)
        }
      }
      trees = treesOf(greenery, this.project)
      this.trees = trees.length
    }
    const material = (vertexShader: string, fragmentShader: string, order: number) => {
      const m = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, side: THREE.DoubleSide, transparent: true })
      return { m, order }
    }
    const meshes: [MeshData, ReturnType<typeof material>, boolean][] = [
      [water, material(S.groundVertex, S.waterFragment, 0), true],
      [ground, material(S.groundVertex, S.groundFragment, 1), true],
      [lawns, material(S.gardenVertex, S.gardenFragment, 1), false],
      [walls, material(S.wallVertex, S.wallFragment, 2), true],
      [facades, material(S.wallVertex, S.facadeFragment, 2), true],
      [details, material(S.wallVertex, S.detailFragment, 2), true],
      [roofs, material(S.roofVertex, S.roofFragment, 3), true]
    ]
    for (const [data, { m, order }, pickable] of meshes) {
      if (!data.triangles) continue
      const mesh = new THREE.Mesh(geometry(data), m)
      mesh.renderOrder = order
      mesh.frustumCulled = false
      this.scene.add(mesh)
      if (pickable) this.pickables.push({ mesh, owner: Int32Array.from(data.owner) })
      else this.extras.push(mesh)
    }
    if (trees.length) {
      // Trees: instanced meshes (crowns, trunks, ground shadows), one draw call each. Crowns
      // come in three levels of detail by distance (TREE_LEVELS_M).
      const crownShapes = [2, 1, 0].map((detail) => new THREE.IcosahedronGeometry(1, detail))
      const parts: [THREE.BufferGeometry, string, string, number, boolean][] = [
        ...crownShapes.map((g): [THREE.BufferGeometry, string, string, number, boolean] => [g, S.crownVertex, S.crownFragment, 4, false]),
        [new THREE.CylinderGeometry(1, 1, 1, 7, 1, true), S.trunkVertex, S.trunkFragment, 4, false],
        [new THREE.PlaneGeometry(1, 1), S.treeShadowVertex, S.treeShadowFragment, 1.5, true]
      ]
      const crowns: THREE.InstancedBufferGeometry[] = []
      for (const [base, vs, fs, order, shadow] of parts) {
        const m = new THREE.ShaderMaterial({
          vertexShader: vs,
          fragmentShader: fs,
          uniforms: this.uniforms,
          side: THREE.DoubleSide,
          transparent: shadow,
          depthWrite: !shadow
        })
        const g = treeGeometry(base, trees)
        if (crownShapes.includes(base as THREE.IcosahedronGeometry)) crowns.push(g)
        const mesh = new THREE.Mesh(g, m)
        mesh.renderOrder = order
        mesh.frustumCulled = false
        this.scene.add(mesh)
        this.extras.push(mesh)
      }
      this.treeLod = treeLevels(trees, crowns)
    }
    const ctx: CityContext = {
      ...prepare,
      uniforms: this.uniforms,
      water: this.water,
      bridges: this.bridges,
      waterZ,
      add: (object) => {
        this.scene.add(object)
        if (object instanceof THREE.Mesh) this.extras.push(object)
      },
      block: (test) => this.blockers.push(test),
      animate: (step) => this.steps.push(step),
      repaint: () => this.map?.triggerRepaint()
    }
    await Promise.all(
      modules
        .filter((mod) => !this.failed.includes(mod.name))
        .map(async (mod) => {
          try {
            await mod.build?.(ctx)
          } catch (err) {
            this.failed.push(mod.name)
            console.warn(`City module ${mod.name} failed to build:`, err)
          }
        })
    )
    this.map?.triggerRepaint()
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true })
    this.renderer.autoClear = false
  }

  onRemove() {
    for (const mesh of [...this.pickables.map((p) => p.mesh), ...this.extras]) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.uniforms.u_signs.value.dispose()
  }

  setYear(year: number) {
    this.uniforms.u_year.value = year
    this.map?.triggerRepaint()
  }

  setVisible(v: boolean) {
    this.visible = v
    this.map?.triggerRepaint()
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.visible || !this.renderer || !this.pickables.length) return
    const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
    const l = new THREE.Matrix4().makeTranslation(this.origin.x, this.origin.y, this.origin.z).scale(new THREE.Vector3(this.meter, -this.meter, this.meter))
    this.matrix.copy(m.multiply(l))
    this.camera.projectionMatrix.copy(this.matrix)
    this.inverse.copy(this.matrix).invert()
    // The camera sits where clip space has x = y = w = 0.
    const c = new THREE.Vector4(0, 0, 1, 0).applyMatrix4(this.inverse)
    if (Math.abs(c.w) > 1e-12) this.uniforms.u_camera.value.set(c.x / c.w, c.y / c.w, c.z / c.w)
    this.treeLod?.(this.uniforms.u_camera.value)
    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
    if (this.steps.length) {
      const t = performance.now() / 1000
      let more = false
      for (const step of this.steps) more = step(t) || more
      if (more) this.map?.triggerRepaint()
    }
  }

  /** The building under a screen point, if a detailed one is visible there. */
  pick(point: { x: number; y: number }): CityProps | undefined {
    if (!this.map || !this.visible) return undefined
    const canvas = this.map.getCanvas()
    const x = (point.x / canvas.clientWidth) * 2 - 1
    const y = 1 - (point.y / canvas.clientHeight) * 2
    const near = new THREE.Vector4(x, y, -1, 1).applyMatrix4(this.inverse)
    const far = new THREE.Vector4(x, y, 1, 1).applyMatrix4(this.inverse)
    const o = new THREE.Vector3(near.x / near.w, near.y / near.w, near.z / near.w)
    const f = new THREE.Vector3(far.x / far.w, far.y / far.w, far.z / far.w)
    const ray = new THREE.Raycaster(o, f.sub(o).normalize())
    const year = this.uniforms.u_year.value
    const hits = ray.intersectObjects(
      this.pickables.map((p) => p.mesh),
      false
    )
    for (const h of hits) {
      const owners = this.pickables.find((p) => p.mesh === h.object)?.owner
      const owner = owners && h.faceIndex !== undefined && h.faceIndex !== null ? owners[h.faceIndex] : -1
      if (owner < 0) {
        // Ground, water, bridges and the spire: stop if they stand this year.
        const life = (h.object as THREE.Mesh).geometry.getAttribute('a_life')
        const v = h.face ? h.face.a : 0
        if (aliveIn([life.getX(v), life.getY(v), life.getZ(v), life.getW(v)], year)) return undefined
        continue
      }
      if (aliveIn(this.specs[owner].life, year)) return this.props[owner]
    }
    return undefined
  }

  /** True if a point (longitude, latitude) is on the river and not on a bridge. */
  inWater(lonlat: [number, number]): boolean {
    const p = this.project(lonlat)
    return this.water.some((w) => insidePoly(p, w)) && !this.bridges.some((b) => insidePoly(p, b))
  }

  /** True where nobody can stand in `year`: the river, or anything a module blocks. */
  isBlocked(lonlat: [number, number], year: number): boolean {
    if (this.inWater(lonlat)) return true
    if (!this.blockers.length) return false
    const p = this.project(lonlat)
    return this.blockers.some((test) => test(p, year))
  }
}

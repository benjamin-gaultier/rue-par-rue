/**
 * Period vehicles and boats in the 3D city: carts, handcarts, cabs and
 * horse omnibuses, then motor taxis, buses and cars; barges, wash-boats,
 * floating baths and river steamers on the Seine.
 *
 * Data: python -m rpr vehicles --area cite (pipeline/rpr/sources/vehicles.py)
 * places them along the kerbs, junctions, bridges and banks of each period,
 * with the years each one stands. Here each type is one instanced draw call
 * (models in vehiclemodels.ts, shaders in vehicleshaders.ts); the year is
 * checked in the vertex shader, as for the trees.
 *
 * Cheap on phones: only instances near the year shown and inside the
 * detailed ground are uploaded (the set is rebuilt when the year moves by
 * more than a few years), and the few moving ones are animated on the CPU,
 * at most 30 times a second, only while one of them is on screen.
 */

import * as THREE from 'three'
import type { CityContext, CityModule } from './city3d'
import { GridIndex, insidePoly, polyBbox, type BuildingSpec, type Pt } from './citygen'
import { MODELS, ModelBuilder } from './vehiclemodels'
import * as S from './vehicleshaders'

export const VEHICLES_URL = 'data/3d/vehicles-cite.json'

/** Instances uploaded around the year shown (± years). */
const WINDOW = 6
/** Draw order: after the ground (1), with the trees (4). */
const ORDER = 4

export interface VehicleData {
  types: { id: string; from: number; until: number; length: number; width: number; note?: string }[]
  paths: number[][][]
  parked: { fields: string[]; rows: number[][] }
  moving: { fields: string[]; rows: number[][] }
}

export interface Path {
  pts: Pt[]
  /** Distance along the path at each point. */
  cum: number[]
  length: number
}

export interface Move {
  path: Path
  speed: number
  /** 0..1, where along its cycle the vehicle is at time 0. */
  phase: number
  /** +1 along the path, -1 against it. */
  dir: 1 | -1
  /** Metres to the right of the path, in the direction of travel. */
  lane: number
}

export interface Vehicle {
  type: string
  length: number
  width: number
  x: number
  y: number
  z: number
  /** Radians, counter-clockwise from east. */
  heading: number
  from: number
  until: number
  seed: number
  /** 1 unhitched, 2 moving. */
  flags: number
  move?: Move
}

export const FLAG = { unhitched: 1, moving: 2 } as const

/* ------------------------------------------------------------- pure helpers */

export function makePath(pts: Pt[]): Path {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  return { pts, cum, length: cum[cum.length - 1] }
}

/** The point `s` metres along a path walked in direction `dir`, offset `lane` metres to the right. */
export function pointAt(path: Path, s: number, dir: 1 | -1, lane: number): { x: number; y: number; heading: number } {
  const d = Math.max(0, Math.min(path.length, dir > 0 ? s : path.length - s))
  let lo = 0
  let hi = path.cum.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (path.cum[mid] <= d) lo = mid
    else hi = mid
  }
  const a = path.pts[lo]
  const b = path.pts[Math.min(lo + 1, path.pts.length - 1)]
  const seg = path.cum[Math.min(lo + 1, path.cum.length - 1)] - path.cum[lo] || 1
  const t = Math.max(0, Math.min(1, (d - path.cum[lo]) / seg))
  let dx = (b[0] - a[0]) * dir
  let dy = (b[1] - a[1]) * dir
  const n = Math.hypot(dx, dy) || 1
  dx /= n
  dy /= n
  // Right of the direction of travel: (dy, -dx).
  return { x: a[0] + (b[0] - a[0]) * t + dy * lane, y: a[1] + (b[1] - a[1]) * t - dx * lane, heading: Math.atan2(dy, dx) }
}

/** Gap at the end of each trip, in metres of travel: the vehicle is out of sight, gone down a side street. */
export function tripGap(path: Path): number {
  return 20 + path.length * 0.25
}

/** Where a moving vehicle is at time t (seconds), or undefined while it is between two trips. */
export function travel(m: Move, t: number): { x: number; y: number; heading: number } | undefined {
  const cycle = m.path.length + tripGap(m.path)
  const s = (((m.phase * cycle + m.speed * t) % cycle) + cycle) % cycle
  if (s > m.path.length) return undefined
  return pointAt(m.path, s, m.dir, m.lane)
}

/** Remove the years [cut) from a list of [from, until) spans. */
export function subtractSpan(spans: [number, number][], cut: [number, number]): [number, number][] {
  const out: [number, number][] = []
  for (const [s, e] of spans) {
    if (cut[1] <= s || cut[0] >= e) {
      out.push([s, e])
      continue
    }
    if (s < cut[0]) out.push([s, cut[0]])
    if (cut[1] < e) out.push([cut[1], e])
  }
  return out
}

/** Years a building stands, as [from, until) spans (its life may have a gap). */
export function standingSpans(life: BuildingSpec['life']): [number, number][] {
  const [a, b, g0, g1] = life
  return g0 < g1 ? subtractSpan([[a, b]], [g0, g1]) : [[a, b]]
}

/** Corners (pulled in a little) and centre of a vehicle's footprint. */
export function footprint(v: Pick<Vehicle, 'x' | 'y' | 'heading' | 'length' | 'width'>): Pt[] {
  const c = Math.cos(v.heading)
  const s = Math.sin(v.heading)
  const hl = v.length / 2 - 0.3
  const hw = v.width / 2 - 0.2
  const out: Pt[] = [[v.x, v.y]]
  for (const [a, b] of [
    [hl, hw],
    [hl, -hw],
    [-hl, hw],
    [-hl, -hw]
  ])
    out.push([v.x + c * a - s * b, v.y + s * a + c * b])
  return out
}

/** Buildings by grid cell, to find those standing on a point. */
export class BuildingIndex {
  private grid = new GridIndex(20)
  private boxes: [number, number, number, number][] = []
  constructor(private specs: BuildingSpec[]) {
    specs.forEach((s, i) => {
      if (!s.polys.length) return
      const b = polyBbox(s.polys)
      this.boxes[i] = b
      this.grid.add(i, b)
    })
  }

  /** The years when no building stands on any of the points, within [from, until). */
  freeYears(points: Pt[], from: number, until: number): [number, number][] {
    let spans: [number, number][] = [[from, until]]
    const seen = new Set<number>()
    for (const p of points) {
      for (const i of this.grid.near(p)) {
        if (seen.has(i)) continue
        const b = this.boxes[i]
        if (!b || p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue
        if (!this.specs[i].polys.some((poly) => insidePoly(p, poly))) continue
        seen.add(i)
        for (const span of standingSpans(this.specs[i].life)) spans = subtractSpan(spans, span)
        if (!spans.length) return spans
      }
    }
    return spans
  }
}

/** Read the data file into vehicles in local metres; boats float at `waterZ`. */
export function parseVehicles(data: VehicleData, project: (lonlat: number[]) => Pt, waterZ: number): Vehicle[] {
  const types = data.types
  const col = (fields: string[]) => (name: string) => fields.indexOf(name)
  const out: Vehicle[] = []
  const pc = col(data.parked.fields)
  const [T, LON, LAT, H, F, U, FL] = ['type', 'lon', 'lat', 'heading', 'from', 'until', 'flags'].map(pc)
  data.parked.rows.forEach((r, i) => {
    const t = types[r[T]]
    if (!t || !MODELS[t.id]) return
    const [x, y] = project([r[LON], r[LAT]])
    out.push({
      type: t.id,
      length: t.length,
      width: t.width,
      x,
      y,
      z: MODELS[t.id].boat ? waterZ : 0,
      heading: (r[H] * Math.PI) / 180,
      from: r[F],
      until: r[U],
      seed: fract(i * 0.6180339 + r[LON] * 913.7),
      flags: r[FL] ?? 0
    })
  })
  const paths = data.paths.map((p) => makePath(p.map((c) => project(c))))
  const mc = col(data.moving.fields)
  const [MT, MP, MF, MU, SP, PH, DIR, LANE] = ['type', 'path', 'from', 'until', 'speed', 'phase', 'dir', 'lane'].map(mc)
  data.moving.rows.forEach((r, i) => {
    const t = types[r[MT]]
    const path = paths[r[MP]]
    if (!t || !MODELS[t.id] || !path || path.length < 1) return
    const move: Move = { path, speed: r[SP], phase: r[PH], dir: r[DIR] < 0 ? -1 : 1, lane: r[LANE] }
    const at = pointAt(path, path.length / 2, move.dir, move.lane)
    out.push({
      type: t.id,
      length: t.length,
      width: t.width,
      x: at.x,
      y: at.y,
      z: MODELS[t.id].boat ? waterZ : 0,
      heading: at.heading,
      from: r[MF],
      until: r[MU],
      seed: fract(i * 0.7548776 + 0.31),
      flags: FLAG.moving,
      move
    })
  })
  return out
}

/** Cut each vehicle's years to those when no building of the city stands where it is (or along its route). */
export function keepOutOfBuildings(vehicles: Vehicle[], index: BuildingIndex): Vehicle[] {
  const out: Vehicle[] = []
  for (const v of vehicles) {
    if (MODELS[v.type]?.boat && !v.move) {
      out.push(v) // checked against the model by the pipeline; boats moor off the quay walls
      continue
    }
    let points: Pt[]
    if (v.move) {
      points = []
      const step = 4
      for (let s = 0; s <= v.move.path.length; s += step) {
        const p = pointAt(v.move.path, s, v.move.dir, v.move.lane)
        points.push([p.x, p.y])
      }
    } else points = footprint(v)
    for (const [from, until] of index.freeYears(points, v.from, v.until)) {
      if (until - from >= 1) out.push({ ...v, from, until })
    }
  }
  return out
}

/** Is the vehicle uploaded for this year? (Shown in the window around it, inside the detailed ground.) */
export function wanted(v: Vehicle, year: number, box: THREE.Vector4, half = WINDOW, camera?: { x: number; y: number; z: number }): boolean {
  if (v.until <= year - half || v.from > year + half) return false
  if (v.move) return true // anywhere along its route
  const m = 5
  if (!(v.x > box.x - m && v.x < box.z + m && v.y > box.y - m && v.y < box.w + m)) return false
  // Parked vehicles far from the camera are a few pixels each: left out.
  return !camera || Math.hypot(v.x - camera.x, v.y - camera.y, v.z - camera.z) < VEHICLE_RADIUS_M
}

/** Parked vehicles are drawn within this distance of the camera (metres)... */
export const VEHICLE_RADIUS_M = 380
/** ...and chosen again when the camera has moved this far. */
const VEHICLE_REFILL_M = 40

function fract(x: number): number {
  return x - Math.floor(x)
}

/* ------------------------------------------------------------- layer */

interface TypeMesh {
  id: string
  mesh: THREE.Mesh
  geometry: THREE.InstancedBufferGeometry
  inst: THREE.InstancedBufferAttribute
  info: THREE.InstancedBufferAttribute
  all: Vehicle[]
  shown: Vehicle[]
  /** Index in `shown` of the first moving vehicle (they come last). */
  firstMoving: number
  /** The whole instance buffer must go to the GPU (not only the moving part). */
  full: boolean
}

function baseGeometry(b: ModelBuilder): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normal, 3))
  g.setAttribute('a_col', new THREE.Float32BufferAttribute(b.colour, 3))
  g.setAttribute('a_part', new THREE.Float32BufferAttribute(b.part, 4))
  g.setAttribute('a_plife', new THREE.Float32BufferAttribute(b.life, 2))
  g.setIndex(b.index)
  return g
}

function palette(colours: THREE.Vector3Tuple[] | undefined): THREE.Vector3[] {
  const out = (colours ?? []).slice(0, 8).map((c) => new THREE.Vector3(...c))
  while (out.length < 8) out.push(new THREE.Vector3(1, 1, 1))
  return out
}

class VehicleLayer {
  private meshes: TypeMesh[] = []
  private shadow?: { geometry: THREE.InstancedBufferGeometry; inst: THREE.InstancedBufferAttribute; info: THREE.InstancedBufferAttribute; dim: THREE.InstancedBufferAttribute; list: Vehicle[] }
  private time = { value: 0 }
  private year = NaN
  private uploadedFrom = new THREE.Vector3(1e9, 1e9, 1e9)
  private matrix = new THREE.Matrix4()
  private clip = new THREE.Vector4()
  private pending = false
  /** When the last animation frame was asked for, and how long frames take to come (ms). */
  private asked = 0
  private latency = 0
  /** Stop the traffic (the console, tests). */
  paused = false

  constructor(
    private ctx: CityContext,
    vehicles: Vehicle[]
  ) {
    const byType = new Map<string, Vehicle[]>()
    for (const v of vehicles) {
      const list = byType.get(v.type)
      if (list) list.push(v)
      else byType.set(v.type, [v])
    }
    const capture = (_r: unknown, _s: unknown, camera: THREE.Camera) => this.matrix.copy(camera.projectionMatrix)
    for (const [id, all] of byType) {
      const def = MODELS[id]
      const builder = new ModelBuilder()
      def.build(builder)
      const base = baseGeometry(builder)
      const geometry = new THREE.InstancedBufferGeometry()
      geometry.index = base.index
      for (const name of ['position', 'normal', 'a_col', 'a_part', 'a_plife']) geometry.setAttribute(name, base.getAttribute(name))
      const inst = new THREE.InstancedBufferAttribute(new Float32Array(all.length * 4), 4)
      const info = new THREE.InstancedBufferAttribute(new Float32Array(all.length * 4), 4)
      inst.setUsage(THREE.DynamicDrawUsage)
      info.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute('a_inst', inst)
      geometry.setAttribute('a_info', info)
      geometry.instanceCount = 0
      const material = new THREE.ShaderMaterial({
        vertexShader: S.vehicleVertex,
        fragmentShader: S.vehicleFragment,
        uniforms: {
          ...ctx.uniforms,
          u_time: this.time,
          u_tip: { value: new THREE.Vector3(...(def.tip ?? [0, 0, 0])) },
          u_pal: { value: palette(def.palette) },
          u_pal2: { value: palette(def.palette2) },
          u_palN: { value: new THREE.Vector2(Math.min(8, def.palette.length), Math.min(8, def.palette2?.length ?? 0)) }
        },
        side: THREE.DoubleSide
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = ORDER
      mesh.frustumCulled = false
      mesh.visible = false
      mesh.onBeforeRender = capture as unknown as THREE.Mesh['onBeforeRender']
      ctx.add(mesh)
      this.meshes.push({ id, mesh, geometry, inst, info, all, shown: [], firstMoving: 0, full: true })
    }
    const street = vehicles.filter((v) => MODELS[v.type]?.shadow)
    if (street.length) {
      const geometry = new THREE.InstancedBufferGeometry()
      const plane = new THREE.PlaneGeometry(1, 1)
      geometry.index = plane.index
      geometry.setAttribute('position', plane.getAttribute('position'))
      const inst = new THREE.InstancedBufferAttribute(new Float32Array(street.length * 4), 4)
      const info = new THREE.InstancedBufferAttribute(new Float32Array(street.length * 4), 4)
      const dim = new THREE.InstancedBufferAttribute(new Float32Array(street.length * 2), 2)
      inst.setUsage(THREE.DynamicDrawUsage)
      geometry.setAttribute('a_inst', inst)
      geometry.setAttribute('a_info', info)
      geometry.setAttribute('a_dim', dim)
      geometry.instanceCount = 0
      const material = new THREE.ShaderMaterial({
        vertexShader: S.shadowVertex,
        fragmentShader: S.shadowFragment,
        uniforms: { ...ctx.uniforms, u_time: this.time },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 1.6
      mesh.frustumCulled = false
      ctx.add(mesh)
      this.shadow = { geometry, inst, info, dim, list: [] }
    }
    this.upload(ctx.uniforms.u_year.value)
    ctx.animate((t) => this.step(t))
  }

  /** Vehicles standing in the year shown, by type (for tests and the console). */
  stats(): Record<string, { shown: number; alive: number; moving: number }> {
    const year = this.ctx.uniforms.u_year.value
    const out: Record<string, { shown: number; alive: number; moving: number }> = {}
    for (const m of this.meshes) {
      const alive = m.shown.filter((v) => year >= v.from && year < v.until)
      out[m.id] = { shown: m.shown.length, alive: alive.length, moving: alive.filter((v) => v.move).length }
    }
    return out
  }

  /** Upload the vehicles shown around `year`, parked ones first, moving ones after. */
  private upload(year: number) {
    this.year = year
    const box = this.ctx.uniforms.u_box.value
    const camera = this.ctx.uniforms.u_camera.value
    this.uploadedFrom.copy(camera)
    const shadows: Vehicle[] = []
    for (const m of this.meshes) {
      const parked: Vehicle[] = []
      const moving: Vehicle[] = []
      for (const v of m.all) if (wanted(v, year, box, WINDOW, camera)) (v.move ? moving : parked).push(v)
      m.shown = parked.concat(moving)
      m.firstMoving = parked.length
      const a = m.inst.array as Float32Array
      const b = m.info.array as Float32Array
      m.shown.forEach((v, i) => {
        a.set([v.x, v.y, v.z, v.heading], i * 4)
        b.set([v.from, v.until, v.seed, v.flags], i * 4)
      })
      m.inst.clearUpdateRanges()
      m.inst.needsUpdate = true
      m.info.needsUpdate = true
      m.full = true
      m.geometry.instanceCount = m.shown.length
      m.mesh.visible = m.shown.length > 0
      if (MODELS[m.id].shadow) shadows.push(...m.shown)
    }
    if (this.shadow) {
      const s = this.shadow
      s.list = shadows
      const a = s.inst.array as Float32Array
      const b = s.info.array as Float32Array
      const d = s.dim.array as Float32Array
      shadows.forEach((v, i) => {
        a.set([v.x, v.y, v.z, v.heading], i * 4)
        b.set([v.from, v.until, v.seed, v.flags], i * 4)
        d.set([v.length, v.width], i * 2)
      })
      s.inst.needsUpdate = true
      s.info.needsUpdate = true
      s.dim.needsUpdate = true
      s.geometry.instanceCount = shadows.length
    }
  }

  /** Called after each frame: refresh the set when the year moved, move what moves. */
  private step(t: number): boolean {
    const year = this.ctx.uniforms.u_year.value
    if (!(Math.abs(year - this.year) < WINDOW - 2) || this.uploadedFrom.distanceTo(this.ctx.uniforms.u_camera.value) > VEHICLE_REFILL_M) {
      this.upload(year)
      this.ctx.repaint()
    }
    let onScreen = false
    const camera = this.ctx.uniforms.u_camera.value
    const box = this.ctx.uniforms.u_box.value
    this.time.value = t
    for (const m of this.meshes) {
      if (m.firstMoving >= m.shown.length) continue
      const a = m.inst.array as Float32Array
      for (let i = m.firstMoving; i < m.shown.length; i++) {
        const v = m.shown[i]
        if (year < v.from || year >= v.until) continue
        const at = travel(v.move!, t)
        if (!at) {
          a[i * 4] = 1e7
          continue
        }
        a[i * 4] = v.x = at.x
        a[i * 4 + 1] = v.y = at.y
        a[i * 4 + 3] = v.heading = at.heading
        if (!onScreen && at.x > box.x && at.x < box.z && at.y > box.y && at.y < box.w && Math.hypot(at.x - camera.x, at.y - camera.y) < 700) {
          this.clip.set(at.x, at.y, v.z + 1, 1).applyMatrix4(this.matrix)
          const w = this.clip.w
          onScreen = w > 0 && Math.abs(this.clip.x / w) < 1.1 && Math.abs(this.clip.y / w) < 1.1
        }
      }
      if (!m.full) {
        // Only the moving part changed since the last upload.
        m.inst.clearUpdateRanges()
        m.inst.addUpdateRange(m.firstMoving * 4, (m.shown.length - m.firstMoving) * 4)
      }
      m.inst.needsUpdate = true
    }
    // The renderer uploads before the next frame; after that only moving parts change.
    for (const m of this.meshes) m.full = false
    if (this.shadow) {
      // Shadows follow the moving vehicles (they share the objects).
      const s = this.shadow
      const a = s.inst.array as Float32Array
      let first = -1
      s.list.forEach((v, i) => {
        if (!v.move) return
        if (first < 0) first = i
        const hidden = !travel(v.move, t)
        a[i * 4] = hidden ? 1e7 : v.x
        a[i * 4 + 1] = v.y
        a[i * 4 + 3] = v.heading
      })
      if (first >= 0) s.inst.needsUpdate = true
    }
    if (this.asked) {
      this.latency = 0.8 * this.latency + 0.2 * (performance.now() - this.asked)
      this.asked = 0
    }
    if (onScreen && !this.paused && !this.pending && typeof document !== 'undefined' && !document.hidden) {
      // At most 30 frames a second for the traffic (the map may draw more for its
      // own reasons), fewer when frames are slow to come, so a slow phone keeps
      // most of its time for panning and walking.
      this.pending = true
      setTimeout(
        () => {
          this.pending = false
          this.asked = performance.now()
          this.ctx.repaint()
        },
        Math.min(500, Math.max(33, this.latency * 4))
      )
    }
    return false
  }
}

const vehicles: CityModule = {
  name: 'vehicles',
  async build(ctx) {
    const res = await fetch(`${ctx.base}${VEHICLES_URL}`)
    if (!res.ok) throw new Error(`${VEHICLES_URL}: HTTP ${res.status}`)
    const data = (await res.json()) as VehicleData
    const index = new BuildingIndex(ctx.buildings.specs)
    const list = keepOutOfBuildings(parseVehicles(data, ctx.project, ctx.waterZ), index)
    const layer = new VehicleLayer(ctx, list)
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug')) Object.assign(window, { rprVehicles: layer })
    ctx.repaint()
  }
}

export default vehicles

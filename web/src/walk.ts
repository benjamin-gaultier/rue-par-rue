/**
 * Walk mode: move through the 3D model at street level.
 *
 * The camera is placed with MapLibre's calculateCameraOptionsFromTo: a point
 * about 2 m above the street, looking at the ground a little ahead. Keys move
 * and turn; dragging turns. Buildings that exist in the chosen year block
 * the way, so you walk the streets of that year.
 */

import { LngLat, type Map as MapLibreMap } from 'maplibre-gl'
import { existsIn, type ModelProps } from './model3d'

export const EYE_HEIGHT = 2.2 // metres; a little above eye level keeps the ground out of the near plane
export const LOOK_AHEAD = 16 // metres to the ground point the camera aims at (about 82° pitch)
export const WALK_SPEED = 4 // metres per second
export const RUN_SPEED = 12
export const TURN_SPEED = 75 // degrees per second
export const LOOK_UP = 8 // degrees above the horizon at the start
export const LOOK_RANGE: [number, number] = [-30, 45]

/** Move `metres` from a point along a compass heading. */
export function offset([lon, lat]: [number, number], heading: number, metres: number): [number, number] {
  const r = (heading * Math.PI) / 180
  return [lon + (Math.sin(r) * metres) / (111320 * Math.cos((lat * Math.PI) / 180)), lat + (Math.cos(r) * metres) / 110574]
}

type Ring = [number, number][]
interface Obstacle {
  bbox: [number, number, number, number]
  rings: Ring[][] // polygons, each a list of rings (outer first)
  props: ModelProps & { until?: number; from?: number }
}

function insideRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function insidePolygon(p: [number, number], rings: Ring[]): boolean {
  if (!insideRing(p, rings[0])) return false
  return !rings.slice(1).some((hole) => insideRing(p, hole))
}

export function toObstacles(geojson: { features: { geometry: { type: string; coordinates: unknown }; properties: ModelProps }[] }): Obstacle[] {
  const out: Obstacle[] = []
  for (const f of geojson.features) {
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][]
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const poly of polys)
      for (const [x, y] of poly[0]) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    out.push({ bbox: [x0, y0, x1, y1], rings: polys, props: f.properties })
  }
  return out
}

/**
 * One step of `metres` towards `heading`, sliding along whatever blocks the
 * way: if the straight step is blocked, try headings turned towards the wall's
 * line, shortened as the turn grows (the part of the step along the wall).
 * Walking into a wall at a slant keeps you moving along it, as in a street;
 * walking straight into it stops you. Returns null if no step is free.
 */
export function slide(from: [number, number], heading: number, metres: number, isBlocked: (p: [number, number]) => boolean): [number, number] | null {
  const ahead = offset(from, heading, metres)
  if (!isBlocked(ahead)) return ahead
  for (const turn of SLIDE_TURNS)
    for (const side of [1, -1]) {
      const p = offset(from, heading + side * turn, metres * Math.cos((turn * Math.PI) / 180))
      if (!isBlocked(p)) return p
    }
  return null
}
const SLIDE_TURNS = [20, 40, 60, 75]

/** True if a building standing in `year` covers the point. */
export function blocked(p: [number, number], year: number, obstacles: Obstacle[], skip?: Set<string>): boolean {
  for (const o of obstacles) {
    if (skip?.has((o.props as { id?: string }).id ?? '')) continue
    const [x0, y0, x1, y1] = o.bbox
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue
    if (!existsIn(o.props, year)) continue
    if (o.rings.some((poly) => insidePolygon(p, poly))) return true
  }
  return false
}

export class Walker {
  active = false
  private pos: [number, number] = [0, 0]
  private heading = 0
  private lookUp = LOOK_UP
  private keys = new Set<string>()
  private raf = 0
  private last = 0
  private drag?: { x: number; y: number; heading: number; lookUp: number; id: number }
  private touchAction = ''
  private obstacles: Obstacle[] = []
  /** More places you cannot walk, such as the river (set by the detailed layer). */
  extraBlock?: (p: [number, number]) => boolean
  /** Buildings whose blocking extraBlock takes over (the detailed layer, with its own dates). */
  skipIds?: Set<string>

  constructor(
    private map: MapLibreMap,
    private modelUrl: string,
    private year: () => number
  ) {}

  async start(at: [number, number], heading: number) {
    if (this.active) return
    if (!this.obstacles.length) {
      try {
        this.obstacles = toObstacles(await (await fetch(this.modelUrl)).json())
      } catch {
        this.obstacles = []
      }
    }
    this.active = true
    this.heading = heading
    this.pos = this.freeSpotNear(at)
    const m = this.map
    m.dragPan.disable()
    m.dragRotate.disable()
    m.scrollZoom.disable()
    m.doubleClickZoom.disable()
    m.touchZoomRotate.disable()
    m.keyboard.disable()
    m.setMaxZoom(24)
    // Looking above the horizon needs pitch > 90°, which needs an unclamped centre.
    m.setCenterClampedToGround(false)
    m.setMaxPitch(150)
    this.lookUp = LOOK_UP
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.clearKeys)
    const c = m.getCanvas()
    // With the map's own gestures off, MapLibre lets the browser pan and zoom
    // the page on touch, which cancels our drag: keep touches for the walk.
    this.touchAction = c.style.touchAction
    c.style.touchAction = 'none'
    c.addEventListener('pointerdown', this.onPointerDown)
    c.addEventListener('pointermove', this.onPointerMove)
    c.addEventListener('pointerup', this.onPointerUp)
    c.addEventListener('pointercancel', this.onPointerUp)
    this.place()
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  stop() {
    if (!this.active) return
    this.active = false
    cancelAnimationFrame(this.raf)
    this.clearKeys()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.clearKeys)
    const c = this.map.getCanvas()
    c.removeEventListener('pointerdown', this.onPointerDown)
    c.removeEventListener('pointermove', this.onPointerMove)
    c.removeEventListener('pointerup', this.onPointerUp)
    c.removeEventListener('pointercancel', this.onPointerUp)
    c.style.touchAction = this.touchAction
    this.drag = undefined
    const m = this.map
    m.dragPan.enable()
    m.dragRotate.enable()
    m.scrollZoom.enable()
    m.doubleClickZoom.enable()
    m.touchZoomRotate.enable()
    m.keyboard.enable()
    m.setCenterClampedToGround(true)
    m.setMaxPitch(85)
    m.setMaxZoom(21)
  }

  /** After a year change: step out of any building that now stands here. */
  ensureFree() {
    if (!this.active) return
    const free = this.freeSpotNear(this.pos)
    if (free !== this.pos) {
      this.pos = free
      this.place()
    }
  }

  /** Press or release a movement key (used by the on-screen buttons too). */
  press(key: string, down: boolean) {
    if (down) this.keys.add(key)
    else this.keys.delete(key)
  }

  private isBlocked(p: [number, number]): boolean {
    return blocked(p, this.year(), this.obstacles, this.skipIds) || (this.extraBlock?.(p) ?? false)
  }

  private freeSpotNear(at: [number, number]): [number, number] {
    if (!this.isBlocked(at)) return at
    for (let r = 2; r <= 80; r += 2)
      for (let a = 0; a < 360; a += 30) {
        const p = offset(at, a, r)
        if (!this.isBlocked(p)) return p
      }
    return at
  }

  private place() {
    const ahead = offset(this.pos, this.heading, LOOK_AHEAD)
    const aimAltitude = EYE_HEIGHT + LOOK_AHEAD * Math.tan((this.lookUp * Math.PI) / 180)
    const camera = this.map.calculateCameraOptionsFromTo(LngLat.convert(this.pos), EYE_HEIGHT, LngLat.convert(ahead), aimAltitude)
    this.map.jumpTo(camera)
  }

  private tick = (now: number) => {
    if (!this.active) return
    const dt = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    const k = this.keys
    let turn = 0
    let forward = 0
    let side = 0
    if (k.has('arrowleft') || k.has('a') || k.has('q')) turn -= 1
    if (k.has('arrowright') || k.has('d') || k.has('e')) turn += 1
    if (k.has('arrowup') || k.has('w') || k.has('z')) forward += 1
    if (k.has('arrowdown') || k.has('s')) forward -= 1
    if (k.has('strafe-left')) side -= 1
    if (k.has('strafe-right')) side += 1
    if (turn || forward || side) {
      this.heading = (this.heading + turn * TURN_SPEED * dt + 360) % 360
      const speed = k.has('shift') ? RUN_SPEED : WALK_SPEED
      if (forward || side) {
        const way = this.heading + (Math.atan2(side, forward) * 180) / Math.PI
        const next = slide(this.pos, way, speed * dt, (p) => this.isBlocked(p))
        if (next) this.pos = next
      }
      this.place()
    }
    this.raf = requestAnimationFrame(this.tick)
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    const key = e.key.toLowerCase()
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'z', 'q', 'e', 'shift'].includes(key)) {
      e.preventDefault()
      this.keys.add(key)
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase())
  }

  private clearKeys = () => this.keys.clear()

  private onPointerDown = (e: PointerEvent) => {
    if (this.drag) return // a second finger: keep following the first
    this.drag = { x: e.clientX, y: e.clientY, heading: this.heading, lookUp: this.lookUp, id: e.pointerId }
    try {
      this.map.getCanvas().setPointerCapture(e.pointerId)
    } catch {
      // Synthetic or already-released pointers cannot be captured.
    }
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return
    // Drag the scene, as in street-level viewers: right turns left, down looks up.
    this.heading = (this.drag.heading - (e.clientX - this.drag.x) * 0.3 + 360) % 360
    const [lo, hi] = LOOK_RANGE
    this.lookUp = Math.max(lo, Math.min(hi, this.drag.lookUp + (e.clientY - this.drag.y) * 0.25))
    this.place()
  }

  private onPointerUp = (e: PointerEvent) => {
    if (this.drag && e.pointerId === this.drag.id) this.drag = undefined
  }
}

/**
 * What an area costs: buildings, GPU buffers, time to the first 3D frame and
 * frame time over two fixed camera paths. Loaded only with `?debug` in the
 * URL, and run from the console: `await rpr.measure()`. The steps and today's
 * numbers are in tools/baseline/README.md and the main README.
 */

import { LngLat, type Map as MapLibreMap } from 'maplibre-gl'
import type { Area } from './areas'
import type { City3D } from './city3d'
import { EYE_HEIGHT, LOOK_AHEAD, LOOK_UP, offset } from './walk'

/** The mark City3D sets when its first frame is drawn: milliseconds since the page began to load. */
export const FIRST_FRAME_MARK = 'rpr-first-3d-frame'

export interface FrameStats {
  frames: number
  medianMs: number
  p95Ms: number
  maxMs: number
}

const round = (v: number) => Math.round(v * 10) / 10

/** Median, 95th percentile and worst of a list of frame times (milliseconds). */
export function frameStats(times: number[]): FrameStats {
  if (!times.length) return { frames: 0, medianMs: 0, p95Ms: 0, maxMs: 0 }
  const s = [...times].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]
  return { frames: s.length, medianMs: round(at(0.5)), p95Ms: round(at(0.95)), maxMs: round(s[s.length - 1]) }
}

interface AttributeLike {
  array: { byteLength: number }
  count: number
}
interface ObjectLike {
  isMesh?: boolean
  geometry?: { index: AttributeLike | null; attributes: Record<string, AttributeLike> }
  material?: { name?: string } | { name?: string }[]
}

export interface SceneBuffers {
  bytes: number
  meshes: number
  buffers: number
  /** Bytes by material name, largest first. A shared buffer goes to the first mesh that uses it. */
  parts: [string, number][]
}

/**
 * Bytes of vertex and index buffers under a three.js scene. A buffer shared
 * by several geometries (the tree shapes) is on the GPU once, so it counts once.
 */
export function sceneBuffers(root: { traverse(visit: (o: object) => void): void }): SceneBuffers {
  const seen = new Set<AttributeLike>()
  const parts = new Map<string, number>()
  let meshes = 0
  let bytes = 0
  root.traverse((object) => {
    const o = object as ObjectLike
    if (!o.isMesh || !o.geometry) return
    meshes++
    const material = Array.isArray(o.material) ? o.material[0] : o.material
    const name = material?.name || 'unnamed'
    for (const a of [o.geometry.index, ...Object.values(o.geometry.attributes)]) {
      if (!a || seen.has(a)) continue
      seen.add(a)
      bytes += a.array.byteLength
      parts.set(name, (parts.get(name) ?? 0) + a.array.byteLength)
    }
  })
  return { bytes, meshes, buffers: seen.size, parts: [...parts].sort((a, b) => b[1] - a[1]) }
}

export interface PathResult {
  /** Time between frames as the browser paints them. Never below the screen's refresh interval. */
  interval: FrameStats
  /** Time to draw one frame and wait for the GPU to finish it: the cost itself, not capped by the screen. */
  draw: FrameStats
  /** Triangles and draw calls of the detailed city in the last frame of the path. */
  triangles: number
  calls: number
}

export interface Measurement {
  area: string
  year: number
  when: string
  gpu: string
  viewport: { width: number; height: number; pixelRatio: number }
  /** Detailed buildings across all years, and those standing in `year`. */
  buildings: { all: number; standing: number }
  trees: number
  /** Vertex and index buffers of the detailed city, in MB (1 MB = 1,000,000 bytes). */
  bufferMB: number
  /** The same by material name, largest first, in MB. */
  bufferParts: [string, number][]
  meshes: number
  textures: number
  /** Milliseconds from the start of the page load to the first frame with the detailed city, when the page was opened in 3D. */
  firstFrameMs: number | null
  /** A full turn above the island, from the area's opening view. */
  orbit: PathResult
  /** A full turn at eye height where the area's walk starts. */
  street: PathResult
}

export interface MeasureOptions {
  /** Frames per path: one full turn. */
  frames?: number
}

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))

/** Run a camera path twice, the first time to load tiles and compile shaders, and time the second. */
async function runPath(map: MapLibreMap, city: City3D, frames: number, place: (i: number) => void): Promise<PathResult> {
  const gl = map.getCanvas().getContext('webgl2') as WebGL2RenderingContext | null
  let intervals: number[] = []
  let draws: number[] = []
  for (let lap = 0; lap < 2; lap++) {
    intervals = []
    draws = []
    let last = await frame()
    for (let i = 0; i < frames; i++) {
      place(i)
      const t0 = performance.now()
      map.redraw()
      gl?.finish()
      draws.push(performance.now() - t0)
      const now = await frame()
      intervals.push(now - last)
      last = now
    }
  }
  const drawn = city.stats()
  return { interval: frameStats(intervals), draw: frameStats(draws), triangles: drawn.triangles, calls: drawn.calls }
}

/**
 * Measure the area as it is shown now. Open the page in 3D with the year in
 * the URL (`?debug#y=1836&d=3d`), wait for the island, then call this.
 * It leaves the map walking at the area's start point.
 */
export async function measure(map: MapLibreMap, city: City3D, area: Area, year: number, walk: () => Promise<void>, options: MeasureOptions = {}): Promise<Measurement> {
  const frames = options.frames ?? 360
  const step = 360 / frames
  const canvas = map.getCanvas()
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null
  const info = gl?.getExtension('WEBGL_debug_renderer_info')
  const first = performance.getEntriesByName(FIRST_FRAME_MARK)[0]

  const orbit = await runPath(map, city, frames, (i) => map.jumpTo({ ...area.view, bearing: area.view.bearing + i * step }))

  await walk()
  const at = area.walk.start
  const aim = EYE_HEIGHT + LOOK_AHEAD * Math.tan((LOOK_UP * Math.PI) / 180)
  const street = await runPath(map, city, frames, (i) => {
    const ahead = offset(at, area.walk.bearing + i * step, LOOK_AHEAD)
    map.jumpTo(map.calculateCameraOptionsFromTo(LngLat.convert(at), EYE_HEIGHT, LngLat.convert(ahead), aim))
  })

  const held = city.stats()
  return {
    area: area.key,
    year,
    when: new Date().toISOString(),
    gpu: gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
    viewport: { width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: window.devicePixelRatio },
    buildings: { all: city.count, standing: city.standing(year) },
    trees: city.trees,
    bufferMB: Math.round(held.bytes / 1e4) / 100,
    bufferParts: held.parts.map(([name, bytes]): [string, number] => [name, Math.round(bytes / 1e4) / 100]),
    meshes: held.meshes,
    textures: held.textures,
    firstFrameMs: first ? Math.round(first.startTime) : null,
    orbit,
    street
  }
}

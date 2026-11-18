/**
 * Streets through time: pure geometry and data helpers for streets.ts.
 *
 * Reads the compact streets file (python -m rpr streets), works out when each
 * piece can be shown (never inside a building standing that year, never a
 * wall plaque without its wall), and builds the triangle arrays: raised
 * pavements with kerbs, and flat decals on the roadway (gutters, crossings,
 * road markings, tree grates). No WebGL here: streets.ts uploads the arrays.
 */

import { ShapeUtils, Vector2 } from 'three'
import { GridIndex, insidePoly, polyBbox, type Poly, type Pt } from './citygen'

/** Years something is shown, as the shaders read them: [from, until, gapFrom, gapUntil]. */
export type Life = [number, number, number, number]
export type Span = [number, number]
export const OPEN = 1e4

/** Pavement height above the roadway: a granite kerb about 15 cm high. */
export const KERB_HEIGHT = 0.15
export const KERB_WIDTH = 0.28
export const GUTTER_WIDTH = 0.38
export const CENTRE_GUTTER_HALF = 0.45

/** What each pavement or decal vertex is, for the street shaders (a_d.x). */
export const PART = {
  oldSlabs: 0,
  asphaltPavement: 1,
  square: 2,
  kerbTop: 3,
  kerbFace: 4,
  sideFace: 5,
  gutter: 10,
  centreGutter: 11,
  crossing: 12,
  mainRoad: 13,
  centreLine: 14,
  grate: 15
} as const

/** Decal heights above the street (with a polygon offset on top), lowest first. */
const DECAL_Z = { mainRoad: 0.008, gutter: 0.016, mark: 0.022 }

/** Item types in the data file (rpr/sources/streets.py ITEM). */
export const ITEM = {
  lantern: 0,
  potence: 1,
  candelabra: 2,
  pole: 3,
  wallLamp: 4,
  kerbStone: 5,
  bollard: 6,
  plaque: 7,
  column: 8,
  vespasienne: 9,
  wallace: 10,
  kiosk: 11,
  bench: 12
} as const

export interface StreetsData {
  metadata: { origin: [number, number]; scale: number; [k: string]: unknown }
  pavements: { rows: [number, number, number, number[][], string[]][] }
  gutters: { rows: [number, number, number[]][] }
  main_roads: { rows: [number, number[][]][] }
  crossings: { rows: [number, number, number[]][] }
  centre_lines: { rows: [number, number[]][] }
  items: { rows: [number, number, number, number[], number[], number[]][] }
}

/** Lon/lat pairs from a flat delta-encoded integer list. */
export function decode(values: number[], origin: [number, number], scale: number): [number, number][] {
  const out: [number, number][] = []
  let x = 0
  let y = 0
  for (let i = 0; i + 1 < values.length; i += 2) {
    x += values[i]
    y += values[i + 1]
    out.push([origin[0] + x / scale, origin[1] + y / scale])
  }
  return out
}

/* ------------------------------------------------------------- lives */

/** The spans of a life, its gap cut out. */
export function spansOf(life: Life): Span[] {
  const [a, b, g0, g1] = life
  if (!(g1 > g0) || g1 <= a || g0 >= b) return a < b ? [[a, b]] : []
  return ([[a, Math.min(b, g0)], [Math.max(a, g1), b]] as Span[]).filter(([s, e]) => s < e)
}

function merge(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => a < b).sort((p, q) => p[0] - q[0])
  const out: Span[] = []
  for (const s of sorted) {
    const last = out[out.length - 1]
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1])
    else out.push([s[0], s[1]])
  }
  return out
}

/**
 * A life from a list of spans: one span, or two with a gap between them. With
 * more, the longest span is kept (a conservative choice: hide rather than guess).
 */
export function lifeFrom(spans: Span[]): Life | null {
  const s = merge(spans)
  if (!s.length) return null
  if (s.length === 1) return [s[0][0], s[0][1], 0, 0]
  if (s.length === 2) return [s[0][0], s[1][1], s[0][1], s[1][0]]
  const best = s.reduce((p, q) => (q[1] - q[0] > p[1] - p[0] ? q : p))
  return [best[0], best[1], 0, 0]
}

/** The years of `span` when none of `blocks` stands. */
export function avoid(span: Span, blocks: Span[]): Life | null {
  let free: Span[] = [[span[0], span[1]]]
  for (const [b0, b1] of merge(blocks)) {
    free = free.flatMap(([a, b]): Span[] => {
      if (b1 <= a || b0 >= b) return [[a, b]]
      return ([[a, b0], [b1, b]] as Span[]).filter(([s, e]) => s < e)
    })
  }
  return lifeFrom(free)
}

/** The years of `span` when one of `supports` stands (a plaque needs its wall). */
export function need(span: Span, supports: Span[]): Life | null {
  return lifeFrom(merge(supports).map(([a, b]): Span => [Math.max(a, span[0]), Math.min(b, span[1])]))
}

/** Buildings by position, with the spans of years each stands. */
export class Buildings {
  private grid = new GridIndex(20)
  private list: { polys: Poly[]; spans: Span[] }[] = []

  add(polys: Poly[], life: Life) {
    if (!polys.length) return
    this.grid.add(this.list.length, polyBbox(polys))
    this.list.push({ polys, spans: spansOf(life) })
  }

  /** Spans of years when some building covers the point. */
  at(p: Pt): Span[] {
    const out: Span[] = []
    for (const i of this.grid.near(p)) {
      const b = this.list[i]
      if (b.polys.some((poly) => insidePoly(p, poly))) out.push(...b.spans)
    }
    return out
  }

  /**
   * The nearest facade within `max` metres of a point, among buildings that
   * stand at some time in `span`: the point on it, its outward normal, and the
   * years that building stands. For hanging plaques and lamps on real walls.
   */
  nearestWall(p: Pt, max: number, span: Span): { at: Pt; normal: Pt; spans: Span[] } | null {
    let best: { at: Pt; normal: Pt; spans: Span[]; d: number } | null = null
    const seen = new Set<number>()
    for (const dx of [-max, 0, max])
      for (const dy of [-max, 0, max])
        for (const i of this.grid.near([p[0] + dx, p[1] + dy])) {
          if (seen.has(i)) continue
          seen.add(i)
          const b = this.list[i]
          if (!b.spans.some(([a, e]) => a < span[1] && e > span[0])) continue
          for (const poly of b.polys)
            for (const ring of poly)
              for (let k = 0; k < ring.length; k++) {
                const a = ring[k]
                const c = ring[(k + 1) % ring.length]
                const ex = c[0] - a[0]
                const ey = c[1] - a[1]
                const L2 = ex * ex + ey * ey
                if (L2 < 1e-6) continue
                const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2))
                const q: Pt = [a[0] + ex * t, a[1] + ey * t]
                const d = Math.hypot(p[0] - q[0], p[1] - q[1])
                if (d > max || (best && d >= best.d)) continue
                const L = Math.sqrt(L2)
                // Outer rings run counter-clockwise and holes clockwise: outside is to the right.
                best = { at: q, normal: [ey / L, -ex / L], spans: b.spans, d }
              }
        }
    return best && { at: best.at, normal: best.normal, spans: best.spans }
  }

  get size() {
    return this.list.length
  }
}

/**
 * When a pavement can be shown: its nominal span minus the years a building
 * covers a good part of it (more than `share` of its area, so that a facade
 * a few centimetres out does not hide the whole pavement).
 */
export function pavementLife(span: Span, triangles: Pt[][], buildings: Buildings, share = 0.15): Life | null {
  let total = 0
  const weights = new Map<string, { span: Span; w: number }>()
  for (const t of triangles) {
    const w = Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2
    total += w
    const c: Pt = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3]
    for (const s of buildings.at(c)) {
      const k = `${s[0]}:${s[1]}`
      const e = weights.get(k)
      if (e) e.w += w
      else weights.set(k, { span: s, w })
    }
  }
  const blocks = [...weights.values()].filter((e) => e.w > share * total).map((e) => e.span)
  return avoid(span, blocks)
}

/* ------------------------------------------------------------- meshes */

/** Interleaved arrays for one street mesh. `d` is (part, u, v, extra) for the shader. */
export class StreetMesh {
  position: number[] = []
  normal: number[] = []
  d: number[] = []
  life: number[] = []

  get vertices() {
    return this.position.length / 3
  }

  vertex(p: [number, number, number], n: [number, number, number], d: [number, number, number, number], life: Life) {
    this.position.push(p[0], p[1], p[2])
    this.normal.push(n[0], n[1], n[2])
    this.d.push(d[0], d[1], d[2], d[3])
    this.life.push(life[0], life[1], life[2], life[3])
  }

  /** A quad a-b-c-d (counter-clockwise seen from the normal side) as two triangles. */
  quad(v: [number, number, number][], n: [number, number, number], d: [number, number, number, number][], life: Life) {
    for (const i of [0, 1, 2, 0, 2, 3]) this.vertex(v[i], n, d[i], life)
  }
}

/** Triangles of a polygon given as rings (outer counter-clockwise, holes clockwise). */
export function triangulate(rings: Pt[][]): Pt[][] {
  if (!rings.length || rings[0].length < 3) return []
  const contour = rings[0].map(([x, y]) => new Vector2(x, y))
  const holes = rings.slice(1).filter((r) => r.length >= 3)
  const all = [...rings[0], ...holes.flat()]
  return ShapeUtils.triangulateShape(
    contour,
    holes.map((r) => r.map(([x, y]) => new Vector2(x, y)))
  ).map((t) => t.map((i) => all[i]))
}

const UP: [number, number, number] = [0, 0, 1]

/**
 * Offsets of each vertex of a ring toward its left (into a pavement for an
 * outer ring counter-clockwise or a hole clockwise), mitred where both edges
 * at the vertex are kerbs, square where only one is.
 */
export function kerbInset(ring: Pt[], kerbs: string, width: number): { from: Pt; to: Pt }[] {
  const n = ring.length
  const normals: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    normals.push([-(b[1] - a[1]) / L, (b[0] - a[0]) / L])
  }
  const out: { from: Pt; to: Pt }[] = []
  for (let i = 0; i < n; i++) {
    // Edge i runs ring[i] -> ring[i+1]; its start uses the vertex i miter, its end vertex i+1.
    const ends: Pt[] = [0, 1].map((k) => {
      const v = (i + k) % n
      const prevEdge = (v + n - 1) % n
      const nextEdge = v
      const n1 = normals[prevEdge]
      const n2 = normals[nextEdge]
      if (kerbs[prevEdge] === '1' && kerbs[nextEdge] === '1') {
        const den = Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1])
        return [((n1[0] + n2[0]) / den) * width, ((n1[1] + n2[1]) / den) * width] as Pt
      }
      return [normals[i][0] * width, normals[i][1] * width] as Pt
    })
    out.push({ from: ends[0], to: ends[1] })
  }
  return out
}

/**
 * One pavement: the raised top, the kerb faces all round, a granite kerb top
 * along the kerb edges, and the gutter on the road side of them (into `decals`).
 */
export function addPavement(pavements: StreetMesh, decals: StreetMesh, rings: Pt[][], kerbs: string[], part: number, life: Life, triangles = triangulate(rings)) {
  const h = KERB_HEIGHT
  for (const t of triangles) for (const p of t) pavements.vertex([p[0], p[1], h], UP, [part, p[0], p[1], 0], life)
  rings.forEach((ring, ri) => {
    const flags = kerbs[ri] ?? ''
    const inset = kerbInset(ring, flags, KERB_WIDTH)
    const outset = kerbInset(ring, flags, -GUTTER_WIDTH)
    let u = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 1e-3) continue
      const out: [number, number, number] = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0]
      const kerb = flags[i] === '1'
      const face = kerb ? PART.kerbFace : PART.sideFace
      pavements.quad(
        [
          [a[0], a[1], 0],
          [b[0], b[1], 0],
          [b[0], b[1], h],
          [a[0], a[1], h]
        ],
        out,
        [
          [face, u, 0, 0],
          [face, u + L, 0, 0],
          [face, u + L, h, 0],
          [face, u, h, 0]
        ],
        life
      )
      if (kerb) {
        const { from, to } = inset[i]
        const z = h + 0.004
        pavements.quad(
          [
            [a[0], a[1], z],
            [b[0], b[1], z],
            [b[0] + to[0], b[1] + to[1], z],
            [a[0] + from[0], a[1] + from[1], z]
          ],
          UP,
          [
            [PART.kerbTop, u, 0, 0],
            [PART.kerbTop, u + L, 0, 0],
            [PART.kerbTop, u + L, 1, 0],
            [PART.kerbTop, u, 1, 0]
          ],
          life
        )
        const g = outset[i]
        const zg = DECAL_Z.gutter
        decals.quad(
          [
            [a[0] + g.from[0], a[1] + g.from[1], zg],
            [b[0] + g.to[0], b[1] + g.to[1], zg],
            [b[0], b[1], zg],
            [a[0], a[1], zg]
          ],
          UP,
          [
            [PART.gutter, u, 1, 0],
            [PART.gutter, u + L, 1, 0],
            [PART.gutter, u + L, 0, 0],
            [PART.gutter, u, 0, 0]
          ],
          life
        )
      }
      u += L
    }
  })
}

/** Mitred offsets of a polyline's vertices to its left, `half` metres. */
function lineOffsets(line: Pt[], half: number): Pt[] {
  const n = line.length
  const normal = (a: Pt, b: Pt): Pt => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L]
  }
  return line.map((_, i) => {
    const n1 = normal(line[Math.max(0, i - 1)], line[Math.max(1, i)])
    const n2 = normal(line[Math.min(n - 2, i)], line[Math.min(n - 1, i + 1)])
    const den = Math.max(0.3, 1 + n1[0] * n2[0] + n1[1] * n2[1])
    return [((n1[0] + n2[0]) / den) * half, ((n1[1] + n2[1]) / den) * half] as Pt
  })
}

/**
 * A flat strip along a polyline (a gutter, a road line), one quad per
 * segment so that each can have its own life. `d` gets (part, u along, v
 * across from -1 to 1, extra).
 */
export function addStrip(m: StreetMesh, line: Pt[], half: number, z: number, part: number, life: (mid: Pt) => Life | null, extra = 0) {
  if (line.length < 2) return
  const off = lineOffsets(line, half)
  let u = 0
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]
    const b = line[i + 1]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const l = life([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
    if (l && L > 1e-3) {
      const [oa, ob] = [off[i], off[i + 1]]
      m.quad(
        [
          [a[0] - oa[0], a[1] - oa[1], z],
          [b[0] - ob[0], b[1] - ob[1], z],
          [b[0] + ob[0], b[1] + ob[1], z],
          [a[0] + oa[0], a[1] + oa[1], z]
        ],
        UP,
        [
          [part, u, -1, extra],
          [part, u + L, -1, extra],
          [part, u + L, 1, extra],
          [part, u, 1, extra]
        ],
        l
      )
    }
    u += L
  }
}

export function addCentreGutter(m: StreetMesh, line: Pt[], life: (mid: Pt) => Life | null) {
  addStrip(m, line, CENTRE_GUTTER_HALF, DECAL_Z.gutter, PART.centreGutter, life)
}

export function addCentreLine(m: StreetMesh, line: Pt[], life: Life) {
  addStrip(m, line, 0.065, DECAL_Z.mark, PART.centreLine, () => life)
}

/**
 * A pedestrian crossing. `angle` is the road's direction (degrees from east):
 * white bars run along it and repeat across; studs mark the two sides.
 */
export function addCrossing(m: StreetMesh, ring: Pt[], angle: number, life: Life) {
  const r = (angle * Math.PI) / 180
  const dir: Pt = [Math.cos(r), Math.sin(r)]
  const along = (p: Pt) => p[0] * dir[0] + p[1] * dir[1]
  const across = (p: Pt) => -p[0] * dir[1] + p[1] * dir[0]
  const a0 = Math.min(...ring.map(along))
  const a1 = Math.max(...ring.map(along))
  const c0 = Math.min(...ring.map(across))
  for (const t of triangulate([ring]))
    for (const p of t) m.vertex([p[0], p[1], DECAL_Z.mark], UP, [PART.crossing, along(p) - a0, across(p) - c0, a1 - a0], life)
}

export function addArea(m: StreetMesh, rings: Pt[][], part: number, life: Life) {
  for (const t of triangulate(rings)) for (const p of t) m.vertex([p[0], p[1], DECAL_Z.mainRoad], UP, [part, p[0], p[1], 0], life)
}

/** A round cast-iron grate around a street tree. */
export function addGrate(m: StreetMesh, c: Pt, radius: number, life: Life) {
  const n = 10
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2
    const a1 = ((i + 1) / n) * Math.PI * 2
    const pts: Pt[] = [
      [0, 0],
      [Math.cos(a0) * radius, Math.sin(a0) * radius],
      [Math.cos(a1) * radius, Math.sin(a1) * radius]
    ]
    for (const p of pts) m.vertex([c[0] + p[0], c[1] + p[1], DECAL_Z.mark], UP, [PART.grate, p[0], p[1], radius], life)
  }
}

/** Whether a point is inside the box (x0, y0, x1, y1) grown by `margin`. */
export function inBox(p: Pt, box: [number, number, number, number], margin = 0): boolean {
  return p[0] >= box[0] - margin && p[0] <= box[2] + margin && p[1] >= box[1] - margin && p[1] <= box[3] + margin
}

/** Whether a set of points comes within the box grown by `margin`. */
export function touchesBox(pts: Pt[], box: [number, number, number, number], margin = 0): boolean {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return x1 >= box[0] - margin && x0 <= box[2] + margin && y1 >= box[1] - margin && y0 <= box[3] + margin
}

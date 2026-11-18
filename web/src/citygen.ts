/**
 * Procedural buildings for the detailed focus area.
 *
 * Turns footprints (in local metres: x east, y north) into wall and roof
 * triangles. Walls carry what the facade shader needs to draw storeys,
 * windows and shopfronts; roofs are mansards (the Paris brisis-terrasson),
 * pitched tile roofs, or flat. Party walls, the walls that touch a
 * neighbour standing at the same time, are found here so the shader leaves
 * them blind, as Paris gable walls are.
 *
 * Pure geometry, no WebGL: the layer in city3d.ts uploads the arrays.
 */

import { ShapeUtils, Vector2 } from 'three'
import {
  addBalconyRail,
  addDormer,
  addPots,
  addShopfronts,
  addStrip,
  bays,
  corbelRing,
  FACADE,
  floorLayout,
  groundLayout,
  ihash,
  MOULDING,
  packCodes,
  packHeightYear,
  PART,
  SIDE,
  sidOf,
  sillOf,
  stripOffsets
} from './facades'

export type Pt = [number, number]
export type Ring = Pt[]
/** Outer ring first (counter-clockwise), then holes (clockwise). */
export type Poly = Ring[]

/** Facade styles understood by the shader. */
export const STYLE = { old: 0, haussmann: 1, modern: 2, monument: 3, bridge: 4, quay: 5, cathedral: 6, railing: 7 } as const
/** Roof materials understood by the shader. */
export const ROOF_MATERIAL = { tile: 0, zinc: 1, mineral: 2, planted: 3, lead: 4, stone: 5, chimney: 6 } as const
/** Roof face kinds: flat tops, mansard slopes, plain slopes, chimneys, dormers, chimney pots. */
export const FACE = { flat: 0, brisis: 1, slope: 2, chimney: 3, dormer: 4, pots: 5 } as const

export type RoofShape = 'flat' | 'mansard' | 'gable' | 'hip'

export interface BuildingSpec {
  polys: Poly[]
  /** Median height (APUR) or estimate, metres. */
  height: number
  roof: RoofShape
  roofMaterial: number
  style: number
  /** 0..1, stable per building: picks colours and bay widths. */
  seed: number
  /** [from, until, gapFrom, gapUntil]: shown when from <= year < until, outside the gap. */
  life: [number, number, number, number]
}

const NO_C = [0, 0, 0, 0]

/** Interleaved per-vertex arrays for one mesh; `owner` maps each triangle to a building. */
export class MeshData {
  position: number[] = []
  normal: number[] = []
  /** Walls: u along the wall, z, wall length, flags. Roofs: u, v on the face, edge length, slope length. */
  a: number[] = []
  /** Walls: style, seed, eave height, floor height. Roofs: material, face kind, style, seed. */
  b: number[] = []
  /** Building walls and their relief: part (PART in facades.ts), building id × 64 + wall, then per part. Zero elsewhere. */
  c: number[] = []
  life: number[] = []
  owner: number[] = []
  /** Three vertex indices per triangle, in the order of `owner`: vertex() adds its own, quad() shares corners. */
  index: number[] = []

  get triangles(): number {
    return this.owner.length
  }

  /** Add a vertex; every three calls make a triangle (push its owner). */
  vertex(p: [number, number, number], n: [number, number, number], a: number[], b: number[], life: number[], c: number[] = NO_C) {
    this.index.push(this.position.length / 3)
    this.push(p, n, a, b, life, c)
  }

  /** A quad from four corners (in order around it) as two triangles sharing two vertices; owner pushed too. */
  quad(p: [number, number, number][], n: [number, number, number], a: number[][], b: number[], life: number[], c: number[], owner: number) {
    const v = this.position.length / 3
    for (let i = 0; i < 4; i++) this.push(p[i], n, a[i], b, life, c)
    this.index.push(v, v + 1, v + 2, v, v + 2, v + 3)
    this.owner.push(owner, owner)
  }

  private push(p: [number, number, number], n: [number, number, number], a: number[], b: number[], life: number[], c: number[]) {
    this.position.push(p[0], p[1], p[2])
    this.normal.push(n[0], n[1], n[2])
    this.a.push(a[0], a[1], a[2], a[3])
    this.b.push(b[0], b[1], b[2], b[3])
    this.c.push(c[0], c[1], c[2], c[3])
    this.life.push(life[0], life[1], life[2], life[3])
  }
}

/* ------------------------------------------------------------- polygons */

export function signedArea(ring: Ring): number {
  let s = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
  return s / 2
}

/** Drop the closing point and points closer than `eps` to their predecessor. */
export function cleanRing(ring: Ring, eps = 0.05): Ring {
  const out: Ring = []
  for (const p of ring) {
    const q = out[out.length - 1]
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push([p[0], p[1]])
  }
  while (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop()
  return out
}

/** Clean rings and orient them: outer counter-clockwise, holes clockwise. Returns null if degenerate. */
export function normalisePoly(poly: Ring[]): Poly | null {
  const rings = poly.map((r) => cleanRing(r)).filter((r) => r.length >= 3)
  if (!rings.length) return null
  return rings.map((r, i) => {
    const ccw = signedArea(r) > 0
    return (i === 0) === ccw ? r : [...r].reverse()
  })
}

function insideRing([x, y]: Pt, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function insidePoly(p: Pt, poly: Poly): boolean {
  return insideRing(p, poly[0]) && !poly.slice(1).some((h) => insideRing(p, h))
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = o(a, b, c)
  const d2 = o(a, b, d)
  const d3 = o(c, d, a)
  const d4 = o(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** True if no two non-adjacent edges of the polygon's rings cross. */
export function isSimple(poly: Poly): boolean {
  const edges: [Pt, Pt, number, number][] = []
  poly.forEach((r, ri) => r.forEach((p, i) => edges.push([p, r[(i + 1) % r.length], ri, i])))
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b, ra, ia] = edges[i]
      const [c, d, rb, ib] = edges[j]
      if (ra === rb) {
        const n = poly[ra].length
        if (Math.abs(ia - ib) === 1 || Math.abs(ia - ib) === n - 1) continue
      }
      if (segmentsCross(a, b, c, d)) return false
    }
  return true
}

/**
 * Offset every ring toward the building's interior by `d` metres (mitred,
 * with a limit at sharp corners). Null if the result folds over itself.
 */
export function insetPoly(poly: Poly, d: number): Poly | null {
  const out: Poly = []
  for (const ring of poly) {
    const n = ring.length
    const r: Ring = []
    for (let i = 0; i < n; i++) {
      const p = ring[(i + n - 1) % n]
      const v = ring[i]
      const q = ring[(i + 1) % n]
      const e1 = [v[0] - p[0], v[1] - p[1]]
      const e2 = [q[0] - v[0], q[1] - v[1]]
      const l1 = Math.hypot(e1[0], e1[1]) || 1
      const l2 = Math.hypot(e2[0], e2[1]) || 1
      // Left normals point into the building for both the outer ring and holes.
      const n1 = [-e1[1] / l1, e1[0] / l1]
      const n2 = [-e2[1] / l2, e2[0] / l2]
      const denom = Math.max(0.05, 1 + n1[0] * n2[0] + n1[1] * n2[1])
      let mx = ((n1[0] + n2[0]) / denom) * d
      let my = ((n1[1] + n2[1]) / denom) * d
      const len = Math.hypot(mx, my)
      if (len > 3 * d) {
        mx *= (3 * d) / len
        my *= (3 * d) / len
      }
      r.push([v[0] + mx, v[1] + my])
    }
    out.push(r)
  }
  const a0 = signedArea(poly[0])
  const a1 = signedArea(out[0])
  if (a1 <= 0 || a1 < 0.12 * a0) return null
  for (let i = 1; i < out.length; i++) if (signedArea(out[i]) >= 0) return null
  return isSimple(out) ? out : null
}

/** Minimum-area rectangle around a ring: centre, unit long axis, half length and half width. */
export function orientedBox(ring: Ring): { c: Pt; dir: Pt; halfLen: number; halfWid: number } {
  let best: { area: number; c: Pt; dir: Pt; halfLen: number; halfWid: number } | undefined
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (l < 1e-6) continue
    const ux = (b[0] - a[0]) / l
    const uy = (b[1] - a[1]) / l
    let [s0, s1, t0, t1] = [Infinity, -Infinity, Infinity, -Infinity]
    for (const p of ring) {
      const s = p[0] * ux + p[1] * uy
      const t = -p[0] * uy + p[1] * ux
      s0 = Math.min(s0, s)
      s1 = Math.max(s1, s)
      t0 = Math.min(t0, t)
      t1 = Math.max(t1, t)
    }
    const area = (s1 - s0) * (t1 - t0)
    if (!best || area < best.area - 1e-9) {
      const sc = (s0 + s1) / 2
      const tc = (t0 + t1) / 2
      const c: Pt = [sc * ux - tc * uy, sc * uy + tc * ux]
      const long = s1 - s0 >= t1 - t0
      best = {
        area,
        c,
        dir: long ? [ux, uy] : [-uy, ux],
        halfLen: Math.max(s1 - s0, t1 - t0) / 2,
        halfWid: Math.min(s1 - s0, t1 - t0) / 2
      }
    }
  }
  return best ?? { c: ring[0], dir: [1, 0], halfLen: 0, halfWid: 0 }
}

/** Keep the part of a ring where `side(p) >= 0` (Sutherland-Hodgman against a line). */
function clipRing(ring: Ring, side: (p: Pt) => number): Ring {
  const out: Ring = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const sa = side(a)
    const sb = side(b)
    if (sa >= 0) out.push(a)
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb)
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
  }
  return cleanRing(out, 0.01)
}

/** Insert the points where a ring crosses lines `dist(p) = k` for each k in `levels`. */
function splitRing(ring: Ring, dist: (p: Pt) => number, levels: number[]): Ring {
  const out: Ring = []
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    out.push(a)
    const da = dist(a)
    const db = dist(b)
    const cuts = levels
      .filter((k) => (da - k) * (db - k) < 0)
      .map((k) => (k - da) / (db - da))
      .sort((x, y) => x - y)
    for (const t of cuts) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return cleanRing(out, 0.01)
}

function triangulate(poly: Poly): Pt[][] {
  const contour = poly[0].map(([x, y]) => new Vector2(x, y))
  const holes = poly.slice(1).map((r) => r.map(([x, y]) => new Vector2(x, y)))
  const all = [...poly[0], ...poly.slice(1).flat()]
  return ShapeUtils.triangulateShape(contour, holes).map((t) => t.map((i) => all[i]))
}

/* ------------------------------------------------------------- building */

export const MANSARD = { inset: 1.5, rise: 3.0, belowTop: 2.0 }
export const HIP = { inset: 2.2, rise: 2.2 }

/** Facade storey heights per style: [ground floor, upper floors]. */
export function storeys(style: number, seed: number): [number, number] {
  if (style === STYLE.old) return [3.3, 2.7 + seed * 0.3]
  if (style === STYLE.haussmann) return [4.3, 3.1]
  if (style === STYLE.modern) return [3.6, 3.0]
  return [0, 4]
}

interface Placed {
  /** Wall top height at each vertex of each ring (rings may gain vertices). */
  rings: Ring[]
  tops: number[][]
  /** Party flag of each edge of each placed ring. */
  party: boolean[][]
  eave: number
  top: number
}

function face(m: MeshData, owner: number, tri: [number, number, number][], a: number[][], b: number[], life: number[]) {
  const [p, q, r] = tri
  const ux = q[0] - p[0]
  const uy = q[1] - p[1]
  const uz = q[2] - p[2]
  const vx = r[0] - p[0]
  const vy = r[1] - p[1]
  const vz = r[2] - p[2]
  let n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  const l = Math.hypot(...n) || 1
  n = [n[0] / l, n[1] / l, n[2] / l]
  if (n[2] < 0) n = [-n[0], -n[1], -n[2]]
  tri.forEach((pt, i) => m.vertex(pt, n, a[i], b, life))
  m.owner.push(owner)
}

/**
 * Offset each edge of each ring toward the interior by its own distance
 * (0 keeps an edge in place: a party wall rising to the top of a mansard).
 * Null if the result folds, flips an edge or is degenerate.
 */
export function insetEdges(poly: Poly, dist: number[][]): Poly | null {
  const out: Poly = []
  for (let ri = 0; ri < poly.length; ri++) {
    const ring = poly[ri]
    const n = ring.length
    const r: Ring = []
    for (let i = 0; i < n; i++) {
      const p = ring[(i + n - 1) % n]
      const v = ring[i]
      const q = ring[(i + 1) % n]
      const d1 = dist[ri][(i + n - 1) % n]
      const d2 = dist[ri][i]
      const l1 = Math.hypot(v[0] - p[0], v[1] - p[1]) || 1
      const l2 = Math.hypot(q[0] - v[0], q[1] - v[1]) || 1
      const t1: Pt = [(v[0] - p[0]) / l1, (v[1] - p[1]) / l1]
      const t2: Pt = [(q[0] - v[0]) / l2, (q[1] - v[1]) / l2]
      const m1: Pt = [-t1[1], t1[0]]
      const m2: Pt = [-t2[1], t2[0]]
      const cr = t1[0] * t2[1] - t1[1] * t2[0]
      if (Math.abs(cr) < 0.05) {
        if (Math.abs(d1 - d2) > 1e-6 || t1[0] * t2[0] + t1[1] * t2[1] < 0) return null
        r.push([v[0] + m1[0] * d1, v[1] + m1[1] * d1])
        continue
      }
      // v + m1·d1 + t1·x lies on the line v + m2·d2 + t2·y.
      const rx = m2[0] * d2 - m1[0] * d1
      const ry = m2[1] * d2 - m1[1] * d1
      const x = (-rx * t2[1] + t2[0] * ry) / -cr
      const pt: Pt = [v[0] + m1[0] * d1 + t1[0] * x, v[1] + m1[1] * d1 + t1[1] * x]
      if (Math.hypot(pt[0] - v[0], pt[1] - v[1]) > 3.2 * Math.max(d1, d2) + 1e-6) return null
      r.push(pt)
    }
    out.push(r)
  }
  const a0 = signedArea(poly[0])
  const a1 = signedArea(out[0])
  if (a1 <= 0 || a1 < 0.12 * a0) return null
  for (let i = 1; i < out.length; i++) if (signedArea(out[i]) >= 0) return null
  for (let ri = 0; ri < poly.length; ri++) {
    const ring = poly[ri]
    const r = out[ri]
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length
      if ((r[j][0] - r[i][0]) * (ring[j][0] - ring[i][0]) + (r[j][1] - r[i][1]) * (ring[j][1] - ring[i][1]) <= 0) return null
    }
  }
  return isSimple(out) ? out : null
}

const ORDINARY = (style: number) => style === STYLE.old || style === STYLE.haussmann || style === STYLE.modern

/**
 * Roof triangles and wall tops for one footprint polygon. `party` flags the
 * edges against a neighbour: mansards rise straight up from them, as Paris
 * party walls do, and get no dormers there.
 */
function roofFor(poly: Poly, spec: BuildingSpec, owner: number, roofs: MeshData, party: boolean[][], probe: (a: Pt, b: Pt) => boolean): Placed {
  const life = spec.life
  const mat = spec.roofMaterial
  const sid = sidOf(spec.seed)
  const flat = (z: number): Placed => {
    for (const t of triangulate(poly)) face(roofs, owner, t.map(([x, y]) => [x, y, z]) as never, t.map(([x, y]) => [x, y, 0, 0]), [mat, FACE.flat, spec.style, spec.seed], life)
    return { rings: poly, tops: poly.map((r) => r.map(() => z)), party, eave: z, top: z }
  }
  const h = spec.height
  if (spec.roof === 'flat' || h < 4) return flat(h)

  if (spec.roof === 'mansard' || spec.roof === 'hip' || (spec.roof === 'gable' && poly.length > 1)) {
    const cfg = spec.roof === 'mansard' ? MANSARD : HIP
    const eave = Math.max(3.5, spec.roof === 'mansard' ? h - MANSARD.belowTop : h - HIP.rise / 2)
    let d = cfg.inset
    const anyParty = party.some((r) => r.some(Boolean))
    let inset = anyParty ? insetEdges(poly, party.map((r) => r.map((p) => (p ? 0 : cfg.inset)))) : null
    let rising = !!inset
    if (!inset) inset = insetPoly(poly, cfg.inset)
    if (!inset) {
      d = cfg.inset / 2
      inset = insetPoly(poly, d)
    }
    if (!inset) return flat(h)
    const rise = cfg.rise * (d / cfg.inset)
    const zt = eave + rise
    const slopeLen = Math.hypot(d, rise)
    const kind = spec.roof === 'mansard' ? FACE.brisis : FACE.slope
    const dormers = spec.roof === 'mansard' && d === cfg.inset && ORDINARY(spec.style)
    let wallIdx = 0
    poly.forEach((ring, ri) => {
      const inner = inset![ri]
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length
        const a = ring[i]
        const b = ring[j]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (L < 1e-3) continue
        if (rising && party[ri][i]) continue
        const ex = (b[0] - a[0]) / L
        const ey = (b[1] - a[1]) / L
        const along = (p: Pt) => (p[0] - a[0]) * ex + (p[1] - a[1]) * ey
        const A: [number, number, number] = [a[0], a[1], eave]
        const B: [number, number, number] = [b[0], b[1], eave]
        const C: [number, number, number] = [inner[j][0], inner[j][1], zt]
        const D: [number, number, number] = [inner[i][0], inner[i][1], zt]
        const uv = (p: Pt, v: number) => [along(p), v, L, slopeLen]
        const b4 = [mat, kind, spec.style, spec.seed]
        face(roofs, owner, [A, B, C], [uv(a, 0), uv(b, 0), uv(inner[j], slopeLen)], b4, life)
        face(roofs, owner, [A, C, D], [uv(a, 0), uv(inner[j], slopeLen), uv(inner[i], slopeLen)], b4, life)
        // Dormers on the street and courtyard sides, one over each window bay.
        if (dormers && !party[ri][i] && L > 2.2) {
          const w = spec.style === STYLE.haussmann ? 1.35 : spec.style === STYLE.old ? 1.05 : 1.25
          const height = spec.style === STYLE.haussmann ? 1.7 : 1.45
          const front = 0.3
          const sr = (front * (rise / d) + height + w * 0.32) / (rise / d)
          const lo = along(inner[i]) * (sr / d) + 0.12
          const hi = L - (L - along(inner[j])) * (sr / d) - 0.12
          const { bw, n } = bays(spec.style, spec.seed, L)
          const frame = { a, t: [ex, ey] as Pt, inward: [-ey, ex] as Pt, eave, rise, run: d }
          for (let k = 0; k < n; k++) {
            const c = (k + 0.5) * bw
            if (c - w / 2 - 0.06 < lo || c + w / 2 + 0.06 > hi) continue
            // Old roofs: a dormer every other bay or so.
            if (spec.style === STYLE.old && ihash(sid, wallIdx * 32 + k, 40) < 0.4) continue
            addDormer(roofs, owner, frame, c, w, front, height, [mat, FACE.dormer, spec.style, spec.seed], life, sid * 64 + (wallIdx % 64))
          }
        }
        wallIdx++
      }
    })
    for (const t of triangulate(inset)) face(roofs, owner, t.map(([x, y]) => [x, y, zt]) as never, t.map(([x, y]) => [x, y, 0, 0]), [mat, FACE.flat, spec.style, spec.seed], life)
    if (!rising) return { rings: poly, tops: poly.map((r) => r.map(() => eave)), party, eave, top: zt }
    // Party walls rise to the top of the roof: insert the points where the slopes meet them.
    const rings: Ring[] = []
    const tops: number[][] = []
    const flags: boolean[][] = []
    poly.forEach((ring, ri) => {
      const n = ring.length
      const r: Ring = []
      const t: number[] = []
      const f: boolean[] = []
      for (let i = 0; i < n; i++) {
        const pp = party[ri][(i + n - 1) % n]
        const pi = party[ri][i]
        const pj = party[ri][(i + 1) % n]
        r.push(ring[i])
        t.push(pp && pi ? zt : eave)
        f.push(pi)
        if (pi && !pp) {
          r.push(inset![ri][i])
          t.push(zt)
          f.push(true)
        }
        if (pi && !pj) {
          r.push(inset![ri][(i + 1) % n])
          t.push(zt)
          f.push(true)
        }
      }
      rings.push(r)
      tops.push(t)
      flags.push(f)
    })
    return { rings, tops, party: flags, eave, top: zt }
  }

  // Pitched roof: two slopes meeting on a ridge along the footprint's long
  // axis, flat at eave level where the footprint is wider than its typical
  // width (a transept, a wing). Old Paris houses: about 45°; churches: steeper.
  const ring = poly[0]
  const box = orientedBox(ring)
  const area = signedArea(ring)
  const w = Math.min(box.halfWid, Math.max(1.5, area / (4 * Math.max(box.halfLen, 1e-3))))
  const steep = spec.style === STYLE.monument || spec.style === STYLE.cathedral
  const rise = Math.min(w * Math.tan(((steep ? 55 : 45) * Math.PI) / 180), steep ? 16 : 6.5)
  const eave = Math.max(3.5, h - rise / 2)
  const nx = -box.dir[1]
  const ny = box.dir[0]
  const dist = (p: Pt) => (p[0] - box.c[0]) * nx + (p[1] - box.c[1]) * ny
  const along = (p: Pt) => (p[0] - box.c[0]) * box.dir[0] + (p[1] - box.c[1]) * box.dir[1]
  const zAt = (p: Pt) => eave + rise * Math.max(0, 1 - Math.abs(dist(p)) / w)
  const split = splitRing(ring, dist, [-w, 0, w])
  const slope = Math.hypot(w, rise) / w
  const bands: [number, number][] = [
    [-Infinity, -w],
    [-w, 0],
    [0, w],
    [w, Infinity]
  ]
  for (const [lo, hi] of bands) {
    let part = split
    if (lo > -Infinity) part = clipRing(part, (p) => dist(p) - lo)
    if (part.length >= 3 && hi < Infinity) part = clipRing(part, (p) => hi - dist(p))
    if (part.length < 3 || Math.abs(signedArea(part)) < 0.05) continue
    const tilted = Number.isFinite(lo) && Number.isFinite(hi)
    for (const t of triangulate([signedArea(part) > 0 ? part : [...part].reverse()])) {
      face(
        roofs,
        owner,
        t.map((p) => [p[0], p[1], zAt(p)]) as never,
        t.map((p) => [along(p), tilted ? (w - Math.abs(dist(p))) * slope : dist(p), 2 * box.halfLen, Math.hypot(w, rise)]),
        [mat, tilted ? FACE.slope : FACE.flat, spec.style, spec.seed],
        life
      )
    }
  }
  const flags = split.map((a, i) => probe(a, split[(i + 1) % split.length]))
  // Dormers (lucarnes) on street-side slopes of old houses wide enough to have an attic.
  if (spec.style === STYLE.old && rise > 2.3) {
    split.forEach((a, i) => {
      const b = split[(i + 1) % split.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      const da = dist(a)
      const db = dist(b)
      if (flags[i] || L < 2.6 || Math.abs(Math.abs(da) - w) > 0.05 || Math.abs(Math.abs(db) - w) > 0.05 || da * db < 0) return
      const t: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
      if (Math.abs(t[0] * box.dir[0] + t[1] * box.dir[1]) < 0.97) return
      const s = -Math.sign(da)
      const inward: Pt = [nx * s, ny * s]
      const w0 = 1.0
      const height = 1.3
      const front = 0.15
      if ((front * (rise / w) + height + w0 * 0.32) / (rise / w) > w - 0.4) return
      const { bw, n } = bays(spec.style, spec.seed, L)
      const frame = { a, t, inward, eave, rise, run: w }
      let placed = 0
      for (let k = 0; k < n; k++) {
        const c = (k + 0.5) * bw
        if (c - w0 / 2 < 0.5 || c + w0 / 2 > L - 0.5) continue
        if (placed > 0 && ihash(sid, i * 32 + k, 41) < 0.5) continue
        addDormer(roofs, owner, frame, c, w0, front, height, [mat, FACE.dormer, spec.style, spec.seed], life, sid * 64 + (i % 64))
        placed++
      }
    })
  }
  return { rings: [split], tops: [split.map(zAt)], party: [flags], eave, top: eave + rise }
}

export interface Neighbours {
  /** True if another building that coexists with `owner` covers the point. */
  covers(p: Pt, owner: number): boolean
  /** Height and years of each coexisting building covering the point. */
  around?(p: Pt, owner: number): { height: number; life: BuildingSpec['life'] }[]
}

/**
 * What a party wall knows of its neighbours, packed for the shader: the
 * height of the neighbour standing at the start and until when, then the
 * height of the latest one and from when (see packHeightYear).
 */
export function partyNeighbours(list: { height: number; life: BuildingSpec['life'] }[], life: BuildingSpec['life']): [number, number] {
  const start = Math.max(life[0], 1700)
  const first = list.find((nb) => nb.life[0] <= start && nb.life[1] > start)
  const later = list.filter((nb) => nb !== first).sort((x, y) => y.life[0] - x.life[0])[0]
  return [packHeightYear(first ? first.height - 1 : 0, first ? first.life[1] : 1700), packHeightYear(later ? later.height - 1 : 0, later ? later.life[0] : 2100)]
}

/**
 * Walls, roof, chimneys and relief of one building. Ordinary buildings
 * (old, Haussmann, modern) put their walls in `out.facades` and their relief
 * (cornices, balconies, shopfronts, awnings, signs) in `out.details` when
 * given, so each is drawn by a shader of its own; in `walls` otherwise.
 */
export function addBuilding(spec: BuildingSpec, owner: number, walls: MeshData, roofs: MeshData, neighbours?: Neighbours, out: { facades?: MeshData; details?: MeshData } = {}) {
  const [, floorH] = storeys(spec.style, spec.seed)
  const sid = sidOf(spec.seed)
  const ordinary = ORDINARY(spec.style)
  const details = out.details ?? walls
  const own = ordinary ? (out.facades ?? walls) : walls
  const probePoint = (a: Pt, b: Pt): Pt => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [(a[0] + b[0]) / 2 + ((b[1] - a[1]) / L) * 0.8, (a[1] + b[1]) / 2 - ((b[0] - a[0]) / L) * 0.8]
  }
  const probe = (a: Pt, b: Pt) => neighbours?.covers(probePoint(a, b), owner) ?? false
  const bv = [spec.style, spec.seed, 0, floorH]
  const facades: {
    a: Pt
    b: Pt
    L: number
    n: [number, number, number]
    za: number
    zb: number
    ri: number
    idx: number
    eave: number
    /** Corbelled: the upper wall's ends, and whether it returns to the wall line at either end. */
    out?: [Pt, Pt, boolean, boolean]
  }[] = []
  const reliefRings: { ring: Ring; eaveEdge: boolean[]; eave: number }[] = []
  // Some old houses still had corbelled upper floors overhanging the street (banned for new houses since 1607).
  const corbel = spec.style === STYLE.old && spec.life[1] <= 1870 && ihash(sid, 0, 52) < 0.16 ? 0.22 + 0.22 * ihash(sid, 0, 53) : 0
  let wallCount = 0
  for (const poly of spec.polys) {
    const party = poly.map((ring) => ring.map((a, i) => probe(a, ring[(i + 1) % ring.length])))
    const placed = roofFor(poly, spec, owner, roofs, party, probe)
    bv[2] = placed.eave
    const chimneyEdges: { mid: Pt; inward: Pt; along: Pt; L: number }[] = []
    placed.rings.forEach((ring, ri) => {
      const tops = placed.tops[ri]
      const eaveEdge: boolean[] = []
      const first = facades.length
      const edgeOf: number[] = []
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length
        const a = ring[i]
        const b = ring[j]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        eaveEdge.push(false)
        if (L < 0.05) continue
        const n: [number, number, number] = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0]
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const za = tops[i]
        const zb = tops[j]
        if (placed.party[ri][i]) {
          if (L > 3.5 && Math.abs(za - zb) < 0.05) chimneyEdges.push({ mid, inward: [-n[0], -n[1]], along: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], L })
          const [p1, p2] = neighbours?.around ? partyNeighbours(neighbours.around(probePoint(a, b), owner), spec.life) : [0, 0]
          wallQuad(own, owner, a, b, za, zb, L, n, 1, [...bv], spec.life, [PART.wall, sid * 64, p1, p2])
          continue
        }
        edgeOf.push(i)
        facades.push({ a, b, L, n, za, zb, ri, idx: wallCount++ % 64, eave: placed.eave })
        eaveEdge[i] = ri === 0 && L > 1 && Math.abs(za - placed.eave) < 0.05 && Math.abs(zb - placed.eave) < 0.05
      }
      if (corbel > 0 && ri === 0 && placed.eave > floorLayout(spec.style, placed.eave, floorH).ground + 1.5) {
        const out = ring.map((_, i) => edgeOf.includes(i))
        const { start, end } = stripOffsets(ring, out)
        const n = ring.length
        edgeOf.forEach((i, k) => {
          const f = facades[first + k]
          f.out = [
            [f.a[0] + start[i][0] * corbel, f.a[1] + start[i][1] * corbel],
            [f.b[0] + end[i][0] * corbel, f.b[1] + end[i][1] * corbel],
            !out[(i + n - 1) % n],
            !out[(i + 1) % n]
          ]
        })
        const c = corbelRing(ring, out, eaveEdge, corbel)
        reliefRings.push({ ring: c.ring, eaveEdge: c.flags, eave: placed.eave })
      } else reliefRings.push({ ring, eaveEdge, eave: placed.eave })
    })
    // Chimney stacks on the party walls, with their pots.
    if (spec.roof !== 'flat' && spec.style !== STYLE.monument && spec.style !== STYLE.cathedral) {
      chimneyEdges.forEach((e, k) => {
        if ((k + Math.floor(spec.seed * 7)) % 2) return
        const w = Math.min(2.6, e.L * 0.45)
        const onTop = placed.top - placed.eave > 0.5 && spec.roof === 'mansard'
        const c: Pt = [e.mid[0] + e.inward[0] * (onTop ? 0.3 : 0.55), e.mid[1] + e.inward[1] * (onTop ? 0.3 : 0.55)]
        const z1 = placed.top + 1.1
        addBox(roofs, owner, c, e.along, w, 0.7, placed.eave - 0.5, z1, spec)
        addPots(roofs, owner, c, e.along, w, z1, Math.max(2, Math.min(6, Math.round(w / 0.42))), [ROOF_MATERIAL.chimney, FACE.pots, spec.style, spec.seed], spec.life)
      })
    }
  }

  // The carriage door goes on the longest street facade of a large building.
  const street = facades.filter((f) => f.ri === 0)
  const longest = street.reduce<(typeof facades)[number] | undefined>((m, f) => (!m || f.L > m.L ? f : m), undefined)
  const wantsCochere =
    ordinary &&
    longest !== undefined &&
    ((spec.style === STYLE.haussmann && longest.L >= 8) || (spec.style === STYLE.old && longest.L >= 13 && spec.height >= 14 && ihash(sid, 0, 51) < 0.6))
  // Some houses demolished in the 1860s still showed their timber frames.
  const timber = spec.style === STYLE.old && spec.life[1] <= 1870 && ihash(sid, 0, 50) < 0.1
  for (const f of facades) {
    const fb = [spec.style, spec.seed, f.eave, floorH]
    if (!ordinary || f.L < 1.6) {
      wallQuad(own, owner, f.a, f.b, f.za, f.zb, f.L, f.n, 0, fb, spec.life, [PART.wall, sid * 64 + f.idx, 0, 0])
      continue
    }
    const courtyard = f.ri > 0
    const layout = groundLayout(spec.style, spec.seed, sid, f.idx, f.L, { courtyard, cochere: wantsCochere && f === longest })
    const w = layout.cochere + 1 + (courtyard ? FACADE.courtyard : 0) + (timber ? FACADE.timber : 0)
    const wc = [PART.wall, sid * 64 + f.idx, packCodes(layout.codes), w]
    if (f.out) {
      // The ground floor on the street line, the floors above pushed out, the overhang's underside,
      // a strip of roof over the gap, and returns to the neighbours' walls.
      const g = floorLayout(spec.style, f.eave, floorH).ground
      const [A, B, capA, capB] = f.out
      wallQuad(own, owner, f.a, f.b, g, g, f.L, f.n, 0, fb, spec.life, wc)
      wallQuad(own, owner, A, B, f.za, f.zb, f.L, f.n, 0, fb, spec.life, wc, g)
      const under = [PART.moulding, sid * 64 + f.idx, SIDE.under, 0]
      const wu = MOULDING.band * 1000 + g
      details.quad(
        [
          [f.a[0], f.a[1], g],
          [f.b[0], f.b[1], g],
          [B[0], B[1], g],
          [A[0], A[1], g]
        ],
        [0, 0, -1],
        [
          [0, g, f.L, wu],
          [f.L, g, f.L, wu],
          [f.L, g - corbel, f.L, wu],
          [0, g - corbel, f.L, wu]
        ],
        fb,
        spec.life,
        under,
        owner
      )
      face(roofs, owner, [[f.a[0], f.a[1], f.za + 0.03], [f.b[0], f.b[1], f.zb + 0.03], [B[0], B[1], f.zb + 0.03]], [[0, 0, f.L, 1], [f.L, 0, f.L, 1], [f.L, 1, f.L, 1]], [spec.roofMaterial, FACE.slope, spec.style, spec.seed], spec.life)
      face(roofs, owner, [[f.a[0], f.a[1], f.za + 0.03], [B[0], B[1], f.zb + 0.03], [A[0], A[1], f.za + 0.03]], [[0, 0, f.L, 1], [f.L, 1, f.L, 1], [0, 1, f.L, 1]], [spec.roofMaterial, FACE.slope, spec.style, spec.seed], spec.life)
      const t: [number, number, number] = [(f.b[0] - f.a[0]) / f.L, (f.b[1] - f.a[1]) / f.L, 0]
      if (capA) wallQuad(own, owner, f.a, A, f.za, f.za, corbel, [-t[0], -t[1], 0], 1, fb, spec.life, [PART.wall, sid * 64, 0, 0], g)
      if (capB) wallQuad(own, owner, B, f.b, f.zb, f.zb, corbel, t, 1, fb, spec.life, [PART.wall, sid * 64, 0, 0], g)
    } else wallQuad(own, owner, f.a, f.b, f.za, f.zb, f.L, f.n, 0, fb, spec.life, wc)
    if (!courtyard) addShopfronts(details, { owner, b: fb, life: spec.life, id: sid * 64 + f.idx }, f.a, f.b, spec.style, sid, f.idx, layout, floorLayout(spec.style, f.eave, floorH).ground, spec.life)
  }

  // Cornices, string courses and balconies along the street sides.
  if (!ordinary) return
  for (const { ring, eaveEdge, eave } of reliefRings) {
    if (!eaveEdge.some(Boolean)) continue
    const ctx = { owner, b: [spec.style, spec.seed, eave, floorH], life: spec.life, id: sid * 64 }
    const floors = floorLayout(spec.style, eave, floorH)
    if (spec.style === STYLE.haussmann) {
      addStrip(details, ctx, ring, eaveEdge, { depth: 0.55, z0: eave - 0.65, z1: eave, part: PART.moulding, w: MOULDING.cornice * 1000 + (eave - 0.65), slope: 0.12, caps: true })
      const g = floors.ground
      addStrip(details, ctx, ring, eaveEdge, { depth: 0.14, z0: g - 0.05, z1: g + 0.22, part: PART.moulding, w: MOULDING.band * 1000 + (g - 0.05), slope: 0.03 })
      for (const k of [1, 4]) {
        if (k >= floors.n) continue
        const top = g + k * floors.fh + sillOf(spec.style, floors.fh)
        const depth = k === 1 ? 0.85 : 0.7
        addStrip(details, ctx, ring, eaveEdge, { depth, z0: top - 0.2, z1: top, part: PART.slab, w: top, caps: true })
        addBalconyRail(details, ctx, ring, eaveEdge, depth, top, 1.0, 0)
      }
    } else if (spec.style === STYLE.old) {
      addStrip(details, ctx, ring, eaveEdge, { depth: 0.24, z0: eave - 0.4, z1: eave, part: PART.moulding, w: MOULDING.oldCornice * 1000 + (eave - 0.4), slope: 0.05, caps: true, cove: true })
    } else {
      addStrip(details, ctx, ring, eaveEdge, { depth: 0.12, z0: eave - 0.28, z1: eave, part: PART.moulding, w: MOULDING.coping * 1000 + (eave - 0.28), slope: 0.02, caps: true })
    }
  }
}

/** A wall from a to b, from z0 up to its tops at each end. */
function wallQuad(walls: MeshData, owner: number, a: Pt, b: Pt, za: number, zb: number, L: number, n: [number, number, number], party: number, bv: number[], life: BuildingSpec['life'], c: number[], z0 = 0) {
  walls.quad(
    [
      [a[0], a[1], z0],
      [b[0], b[1], z0],
      [b[0], b[1], zb],
      [a[0], a[1], za]
    ],
    n,
    [
      [0, z0, L, party],
      [L, z0, L, party],
      [L, zb, L, party],
      [0, za, L, party]
    ],
    bv,
    life,
    c,
    owner
  )
}

/** An upright box (chimney, spire drum) into the roof mesh. */
export function addBox(m: MeshData, owner: number, c: Pt, along: Pt, w: number, depth: number, z0: number, z1: number, spec: Pick<BuildingSpec, 'style' | 'seed' | 'life'>, material: number = ROOF_MATERIAL.chimney, kind: number = FACE.chimney) {
  const [ax, ay] = along
  const bx = -ay
  const by = ax
  const corner = (s: number, t: number): Pt => [c[0] + ax * s * (w / 2) + bx * t * (depth / 2), c[1] + ay * s * (w / 2) + by * t * (depth / 2)]
  const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
  const h = z1 - z0
  for (let i = 0; i < 4; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % 4]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n: [number, number, number] = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0]
    const quad: [number, number, number][] = [
      [a[0], a[1], z0],
      [b[0], b[1], z0],
      [b[0], b[1], z1],
      [a[0], a[1], z1]
    ]
    const uv = [
      [0, 0, L, h],
      [L, 0, L, h],
      [L, h, L, h],
      [0, h, L, h]
    ]
    const bv = [material, kind, spec.style, spec.seed]
    for (const [p, q, r] of [
      [0, 1, 2],
      [0, 2, 3]
    ]) {
      m.vertex(quad[p], n, uv[p], bv, spec.life)
      m.vertex(quad[q], n, uv[q], bv, spec.life)
      m.vertex(quad[r], n, uv[r], bv, spec.life)
      m.owner.push(owner)
    }
  }
  const top = [ring[0], ring[1], ring[2], ring[0], ring[2], ring[3]]
  for (let k = 0; k < 6; k += 3) {
    for (let i = 0; i < 3; i++) m.vertex([top[k + i][0], top[k + i][1], z1], [0, 0, 1], [0, h, w, h], [material, kind, spec.style, spec.seed], spec.life)
    m.owner.push(owner)
  }
}

/** An octagonal spire: a drum, then a pyramid to the tip. */
export function addSpire(m: MeshData, owner: number, c: Pt, radius: number, base: number, drumTop: number, tip: number, life: [number, number, number, number]) {
  const ring: Pt[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    ring.push([c[0] + Math.cos(a) * radius, c[1] + Math.sin(a) * radius])
  }
  const spec = { style: STYLE.monument, seed: 0.5, life }
  const b = [ROOF_MATERIAL.lead, FACE.slope, STYLE.monument, 0.5]
  for (let i = 0; i < 8; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % 8]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    const P0: [number, number, number] = [p[0], p[1], base]
    const Q0: [number, number, number] = [q[0], q[1], base]
    const P1: [number, number, number] = [p[0], p[1], drumTop]
    const Q1: [number, number, number] = [q[0], q[1], drumTop]
    const T: [number, number, number] = [c[0], c[1], tip]
    const n: [number, number, number] = [(q[1] - p[1]) / L, -(q[0] - p[0]) / L, 0]
    for (const [pt, uv] of [
      [P0, [0, 0]],
      [Q0, [L, 0]],
      [Q1, [L, drumTop - base]],
      [P0, [0, 0]],
      [Q1, [L, drumTop - base]],
      [P1, [0, drumTop - base]]
    ] as [[number, number, number], number[]][])
      m.vertex(pt, n, [uv[0], uv[1], L, drumTop - base], b, life)
    m.owner.push(owner, owner)
    face(m, owner, [P1, Q1, T], [[0, 0, L, tip - drumTop], [L, 0, L, tip - drumTop], [L / 2, tip - drumTop, L, tip - drumTop]], b, life)
  }
  void spec
}

/* ------------------------------------------------------------- grid index */

/** Buckets building indices by the cells their bounding boxes touch. */
export class GridIndex {
  private cells = new Map<string, number[]>()
  constructor(private size = 20) {}

  add(i: number, bbox: [number, number, number, number]) {
    const s = this.size
    for (let x = Math.floor(bbox[0] / s); x <= Math.floor(bbox[2] / s); x++)
      for (let y = Math.floor(bbox[1] / s); y <= Math.floor(bbox[3] / s); y++) {
        const k = `${x}:${y}`
        const list = this.cells.get(k)
        if (list) list.push(i)
        else this.cells.set(k, [i])
      }
  }

  near(p: Pt): number[] {
    return this.cells.get(`${Math.floor(p[0] / this.size)}:${Math.floor(p[1] / this.size)}`) ?? []
  }
}

export function polyBbox(polys: Poly[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const poly of polys)
    for (const [x, y] of poly[0]) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  return [x0, y0, x1, y1]
}

/** True if two buildings stand at the same time for at least one year. */
export function coexist(a: BuildingSpec['life'], b: BuildingSpec['life']): boolean {
  return a[0] < b[1] && b[0] < a[1]
}

/**
 * Build every building into meshes, with party walls found among neighbours:
 * walls of landmarks and monuments, facades of ordinary buildings, their
 * relief, and roofs.
 */
export function buildCity(specs: BuildingSpec[]): { walls: MeshData; facades: MeshData; details: MeshData; roofs: MeshData } {
  const walls = new MeshData()
  const facades = new MeshData()
  const roofs = new MeshData()
  const details = new MeshData()
  const grid = new GridIndex()
  specs.forEach((s, i) => grid.add(i, polyBbox(s.polys)))
  const neighbours: Neighbours = {
    covers(p, owner) {
      for (const j of grid.near(p)) {
        if (j === owner || !coexist(specs[j].life, specs[owner].life)) continue
        if (specs[j].polys.some((poly) => insidePoly(p, poly))) return true
      }
      return false
    },
    around(p, owner) {
      const out: { height: number; life: BuildingSpec['life'] }[] = []
      for (const j of grid.near(p)) {
        if (j === owner || !coexist(specs[j].life, specs[owner].life)) continue
        if (specs[j].polys.some((poly) => insidePoly(p, poly))) out.push({ height: specs[j].height, life: specs[j].life })
      }
      return out
    }
  }
  specs.forEach((s, i) => addBuilding(s, i, walls, roofs, neighbours, { facades, details }))
  return { walls, facades, details, roofs }
}

/* ------------------------------------------------------------- the river */

export interface SiteGeometry {
  ground: MeshData
  water: MeshData
}

/** A flat, triangulated surface at height z. */
export function addSurface(m: MeshData, poly: Poly, z: number, kind = 0, life: number[] = [-1e4, 1e4, 0, 0]) {
  for (const t of triangulate(poly)) {
    for (const [x, y] of t) m.vertex([x, y, z], [0, 0, 1], [x, y, kind, 0], [0, 0, 0, 0], life)
    m.owner.push(-1)
  }
}

/** A cast-iron railing around every ring of a polygon (style `railing`, drawn by the wall shader). */
export function addRailing(m: MeshData, poly: Poly, height: number, life: number[]) {
  for (const ring of poly) {
    let u = 0
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const L = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (L < 0.05) continue
      const n: [number, number, number] = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0]
      const bv = [STYLE.railing, 0.5, 0, 0]
      const quad: [number, number, number, number][] = [
        [a[0], a[1], 0, u],
        [b[0], b[1], 0, u + L],
        [b[0], b[1], height, u + L],
        [a[0], a[1], 0, u],
        [b[0], b[1], height, u + L],
        [a[0], a[1], height, u]
      ]
      for (const [x, y, z, uu] of quad) m.vertex([x, y, z], n, [uu, z, 0, 0], bv, life)
      m.owner.push(-1, -1)
      u += L
    }
  }
}

/** One tree, as the instanced tree meshes read it. */
export interface TreeSpec {
  x: number
  y: number
  height: number
  group: number
  planted: number
  girth: number
}

/**
 * Stone walls along a line, from z0 to z1. Where `low(p)` is true (under a
 * bridge deck) the wall stops below the deck so it does not block the road.
 */
export function addQuay(m: MeshData, line: Pt[], z0: number, z1: number, lowTop: number, low: (p: Pt) => boolean, style: number = STYLE.quay) {
  let u = 0
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i]
    const b = line[i + 1]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 0.01) continue
    // Water on the right: the wall faces it.
    const n: [number, number, number] = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0]
    const pieces = Math.max(1, Math.ceil(L / 2))
    for (let k = 0; k < pieces; k++) {
      const t0 = k / pieces
      const t1 = (k + 1) / pieces
      const p: Pt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0]
      const q: Pt = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]
      const top = low([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]) ? lowTop : z1
      const u0 = u + L * t0
      const u1 = u + L * t1
      const bv = [style, 0.5, 0, 0]
      const life = [-1e4, 1e4, 0, 0]
      m.vertex([p[0], p[1], z0], n, [u0, z0, 0, 0], bv, life)
      m.vertex([q[0], q[1], z0], n, [u1, z0, 0, 0], bv, life)
      m.vertex([q[0], q[1], top], n, [u1, top, 0, 0], bv, life)
      m.vertex([p[0], p[1], z0], n, [u0, z0, 0, 0], bv, life)
      m.vertex([q[0], q[1], top], n, [u1, top, 0, 0], bv, life)
      m.vertex([p[0], p[1], top], n, [u0, top, 0, 0], bv, life)
      m.owner.push(-1, -1)
    }
    u += L
  }
}

// Bridges, with their history: see bridges.ts.

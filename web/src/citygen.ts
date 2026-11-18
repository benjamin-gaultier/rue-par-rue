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

export type Pt = [number, number]
export type Ring = Pt[]
/** Outer ring first (counter-clockwise), then holes (clockwise). */
export type Poly = Ring[]

/** Facade styles understood by the shader. */
export const STYLE = { old: 0, haussmann: 1, modern: 2, monument: 3, bridge: 4, quay: 5, cathedral: 6, railing: 7 } as const
/** Roof materials understood by the shader. */
export const ROOF_MATERIAL = { tile: 0, zinc: 1, mineral: 2, planted: 3, lead: 4, stone: 5, chimney: 6 } as const
/** Roof face kinds: flat tops, mansard slopes (with dormers), plain slopes, chimneys. */
export const FACE = { flat: 0, brisis: 1, slope: 2, chimney: 3 } as const

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

/** Interleaved per-vertex arrays for one mesh; `owner` maps each triangle to a building. */
export class MeshData {
  position: number[] = []
  normal: number[] = []
  /** Walls: u along the wall, z, wall length, flags. Roofs: u, v on the face, edge length, slope length. */
  a: number[] = []
  /** Walls: style, seed, eave height, floor height. Roofs: material, face kind, style, seed. */
  b: number[] = []
  life: number[] = []
  owner: number[] = []

  get triangles(): number {
    return this.owner.length
  }

  vertex(p: [number, number, number], n: [number, number, number], a: number[], b: number[], life: number[]) {
    this.position.push(p[0], p[1], p[2])
    this.normal.push(n[0], n[1], n[2])
    this.a.push(a[0], a[1], a[2], a[3])
    this.b.push(b[0], b[1], b[2], b[3])
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

/** Roof triangles and wall tops for one footprint polygon. */
function roofFor(poly: Poly, spec: BuildingSpec, owner: number, roofs: MeshData): Placed {
  const life = spec.life
  const mat = spec.roofMaterial
  const flat = (z: number): Placed => {
    for (const t of triangulate(poly)) face(roofs, owner, t.map(([x, y]) => [x, y, z]) as never, t.map(([x, y]) => [x, y, 0, 0]), [mat, FACE.flat, spec.style, spec.seed], life)
    return { rings: poly, tops: poly.map((r) => r.map(() => z)), eave: z, top: z }
  }
  const h = spec.height
  if (spec.roof === 'flat' || h < 4) return flat(h)

  if (spec.roof === 'mansard' || spec.roof === 'hip' || (spec.roof === 'gable' && poly.length > 1)) {
    const cfg = spec.roof === 'mansard' ? MANSARD : HIP
    const eave = Math.max(3.5, spec.roof === 'mansard' ? h - MANSARD.belowTop : h - HIP.rise / 2)
    let inset = insetPoly(poly, cfg.inset)
    let d = cfg.inset
    if (!inset) {
      d = cfg.inset / 2
      inset = insetPoly(poly, d)
    }
    if (!inset) return flat(h)
    const rise = cfg.rise * (d / cfg.inset)
    const zt = eave + rise
    const slopeLen = Math.hypot(d, rise)
    const kind = spec.roof === 'mansard' ? FACE.brisis : FACE.slope
    poly.forEach((ring, ri) => {
      const inner = inset![ri]
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length
        const a = ring[i]
        const b = ring[j]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (L < 1e-3) continue
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
      }
    })
    for (const t of triangulate(inset)) face(roofs, owner, t.map(([x, y]) => [x, y, zt]) as never, t.map(([x, y]) => [x, y, 0, 0]), [mat, FACE.flat, spec.style, spec.seed], life)
    return { rings: poly, tops: poly.map((r) => r.map(() => eave)), eave, top: zt }
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
  return { rings: [split], tops: [split.map(zAt)], eave, top: eave + rise }
}

export interface Neighbours {
  /** True if another building that coexists with `owner` covers the point. */
  covers(p: Pt, owner: number): boolean
}

/** Walls, roof and chimneys of one building. */
export function addBuilding(spec: BuildingSpec, owner: number, walls: MeshData, roofs: MeshData, neighbours?: Neighbours) {
  const [, floorH] = storeys(spec.style, spec.seed)
  for (const poly of spec.polys) {
    const placed = roofFor(poly, spec, owner, roofs)
    const chimneyEdges: { mid: Pt; inward: Pt; along: Pt; L: number }[] = []
    placed.rings.forEach((ring, ri) => {
      const tops = placed.tops[ri]
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length
        const a = ring[i]
        const b = ring[j]
        const L = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (L < 0.05) continue
        const n: [number, number, number] = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L, 0]
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const party = neighbours?.covers([mid[0] + n[0] * 0.8, mid[1] + n[1] * 0.8], owner) ? 1 : 0
        if (party && L > 3.5) chimneyEdges.push({ mid, inward: [-n[0], -n[1]], along: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], L })
        const bv = [spec.style, spec.seed, placed.eave, floorH]
        const za = tops[i]
        const zb = tops[j]
        walls.vertex([a[0], a[1], 0], n, [0, 0, L, party], bv, spec.life)
        walls.vertex([b[0], b[1], 0], n, [L, 0, L, party], bv, spec.life)
        walls.vertex([b[0], b[1], zb], n, [L, zb, L, party], bv, spec.life)
        walls.vertex([a[0], a[1], 0], n, [0, 0, L, party], bv, spec.life)
        walls.vertex([b[0], b[1], zb], n, [L, zb, L, party], bv, spec.life)
        walls.vertex([a[0], a[1], za], n, [0, za, L, party], bv, spec.life)
        walls.owner.push(owner, owner)
      }
    })
    // Chimney stacks rise from the party walls of pitched and mansard roofs.
    if (spec.roof !== 'flat' && spec.style !== STYLE.monument && spec.style !== STYLE.cathedral) {
      chimneyEdges.forEach((e, k) => {
        if ((k + Math.floor(spec.seed * 7)) % 2) return
        const w = Math.min(2.6, e.L * 0.45)
        const c: Pt = [e.mid[0] + e.inward[0] * 0.55, e.mid[1] + e.inward[1] * 0.55]
        addBox(roofs, owner, c, e.along, w, 0.7, placed.eave - 0.5, placed.top + 1.1, spec)
      })
    }
  }
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

/** Build every building into two meshes, with party walls found among neighbours. */
export function buildCity(specs: BuildingSpec[]): { walls: MeshData; roofs: MeshData } {
  const walls = new MeshData()
  const roofs = new MeshData()
  const grid = new GridIndex()
  specs.forEach((s, i) => grid.add(i, polyBbox(s.polys)))
  const neighbours: Neighbours = {
    covers(p, owner) {
      for (const j of grid.near(p)) {
        if (j === owner || !coexist(specs[j].life, specs[owner].life)) continue
        if (specs[j].polys.some((poly) => insidePoly(p, poly))) return true
      }
      return false
    }
  }
  specs.forEach((s, i) => addBuilding(s, i, walls, roofs, neighbours))
  return { walls, roofs }
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

/**
 * A bridge: the deck as paving, and two stone side walls from the water to
 * the parapet, pierced by arches in the shader (style `bridge`).
 */
export function addBridge(walls: MeshData, ground: MeshData, deck: Poly, waterZ: number, landEnd = 4) {
  const ring = deck[0]
  addSurface(ground, deck, 0.06, 1)
  const box = orientedBox(ring)
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (L < 1) continue
    const dx = (b[0] - a[0]) / L
    const dy = (b[1] - a[1]) / L
    if (Math.abs(dx * box.dir[0] + dy * box.dir[1]) < 0.9) continue // the ends: open to the road
    const arches = Math.max(1, Math.round((L - 2 * landEnd) / 30))
    const n: [number, number, number] = [dy, -dx, 0]
    const bv = [STYLE.bridge, 0.5, arches, landEnd]
    const life = [-1e4, 1e4, 0, 0]
    const z1 = 1.0
    walls.vertex([a[0], a[1], waterZ], n, [0, waterZ, L, 2], bv, life)
    walls.vertex([b[0], b[1], waterZ], n, [L, waterZ, L, 2], bv, life)
    walls.vertex([b[0], b[1], z1], n, [L, z1, L, 2], bv, life)
    walls.vertex([a[0], a[1], waterZ], n, [0, waterZ, L, 2], bv, life)
    walls.vertex([b[0], b[1], z1], n, [L, z1, L, 2], bv, life)
    walls.vertex([a[0], a[1], z1], n, [0, z1, L, 2], bv, life)
    walls.owner.push(-1, -1)
  }
}

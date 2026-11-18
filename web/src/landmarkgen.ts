/**
 * Geometry of the Cité's landmarks: the Sainte-Chapelle, the towers of the
 * Conciergerie, the dome of the Tribunal de commerce, Henri IV on the Pont
 * Neuf, Notre-Dame's flying buttresses, market stalls.
 *
 * Pure geometry, no WebGL. Everything goes into three MeshData buffers so the
 * whole layer costs three draw calls:
 *   walls  read by the city's wall shader (a = u, z, L, flags; b = style, seed, eave, 4),
 *          landmark styles (20 and up) drawn by landmarkFacade() in landmarkshaders.ts;
 *   roofs  read by the city's roof shader (a = u, v, edge length, slope length; b = material, face kind, style, seed);
 *   props  read by propFragment in landmarkshaders.ts (a = u, v; b = r, g, b, kind): bronze, gilt, painted things.
 * Local metres: x east, y north, z up from the street.
 */

import { FACE, MeshData, ROOF_MATERIAL, signedArea, type Pt } from './citygen'

export type V3 = [number, number, number]
export type Life = [number, number, number, number]

export const OPEN = 1e4
export const ALWAYS: Life = [-OPEN, OPEN, 0, 0]

/** Years [from, until) as the shader reads them; null means open-ended. */
export function lifeOf(from?: number | null, until?: number | null): Life {
  return [from ?? -OPEN, until ?? OPEN, 0, 0]
}

/** Wall styles drawn by landmarkFacade(); the pipeline writes the same numbers (rpr/sources/landmarks.py STYLE). */
export const LM = {
  sainteChapelle: 20,
  chapelFront: 21,
  tower: 22,
  conciergerie: 23,
  palais: 24,
  tribunal: 25,
  prefecture: 26,
  hotelDieu: 27,
  dauphine: 28,
  morgue: 29,
  pavilion1873: 30,
  pavilion1924: 31,
  stone: 32,
  harlay: 33,
  openwork: 34
} as const

/** Kinds of prop surface (propFragment). */
export const PROP = { paint: 0, bronze: 1, clock: 2, gilt: 3, canvas: 4 } as const

export const BRONZE: V3 = [0.27, 0.3, 0.23]
export const MARBLE: V3 = [0.83, 0.8, 0.74]
export const GILT: V3 = [0.8, 0.63, 0.26]

/* ------------------------------------------------------------- frames */

/** Unit vector (x east, y north) of a compass bearing in degrees. */
export function headingOf(bearing: number): Pt {
  const r = (bearing * Math.PI) / 180
  return [Math.sin(r), Math.cos(r)]
}

/**
 * A frame along an axis: s forward, t to the left, both in metres.
 * (s, t) is right-handed like (x, y), so a ring that turns counter-clockwise
 * in (s, t) does so on the map too.
 */
export function frame(origin: Pt, bearing: number) {
  const a = headingOf(bearing)
  const n: Pt = [-a[1], a[0]]
  return {
    a,
    n,
    at: (s: number, t: number): Pt => [origin[0] + a[0] * s + n[0] * t, origin[1] + a[1] * s + n[1] * t],
    /** A point of the frame, with z, rotated about the frame's own z. */
    p3: (s: number, t: number, z: number): V3 => [origin[0] + a[0] * s + n[0] * t, origin[1] + a[1] * s + n[1] * t, z]
  }
}

export function regularRing(c: Pt, r: number, sides: number, startDeg = 0): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < sides; i++) {
    const ang = ((startDeg + (i * 360) / sides) * Math.PI) / 180
    out.push([c[0] + Math.sin(ang) * r, c[1] + Math.cos(ang) * r])
  }
  return signedArea(out) > 0 ? out : out.reverse()
}

/** The ring turned counter-clockwise (outside on the right of each edge). */
export function ccw(ring: Pt[]): Pt[] {
  return signedArea(ring) > 0 ? ring : [...ring].reverse()
}

/** Move each vertex of a convex ring away from its centroid by d metres. */
export function grow(ring: Pt[], d: number): Pt[] {
  const c = centroid(ring)
  return ring.map(([x, y]) => {
    const l = Math.hypot(x - c[0], y - c[1]) || 1
    return [x + ((x - c[0]) / l) * d, y + ((y - c[1]) / l) * d]
  })
}

export function centroid(ring: Pt[]): Pt {
  let x = 0
  let y = 0
  for (const p of ring) {
    x += p[0]
    y += p[1]
  }
  return [x / ring.length, y / ring.length]
}

/* ------------------------------------------------------------- primitives */

function normalOf(p: V3, q: V3, r: V3): V3 {
  const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
  const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]]
  const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const l = Math.hypot(...n) || 1
  return [n[0] / l, n[1] / l, n[2] / l]
}

/** One triangle; the normal faces the side from which p, q, r turn counter-clockwise. */
export function tri(m: MeshData, p: V3, q: V3, r: V3, ap: number[], aq: number[], ar: number[], b: number[], life: Life, n?: V3) {
  const nn = n ?? normalOf(p, q, r)
  m.vertex(p, nn, ap, b, life)
  m.vertex(q, nn, aq, b, life)
  m.vertex(r, nn, ar, b, life)
  m.owner.push(-1)
}

export interface WallLook {
  style: number
  seed: number
  /** Passed to the shader as the wall's eaves height (bands, battlements). */
  eave: number
  life: Life
}

/**
 * A vertical wall from a to b, z0 to z1, seen from its right (the outside of
 * a counter-clockwise ring). u runs from u0 along it; L is the length the
 * shader lays bays out on (the wall's own length by default).
 */
export function wall(m: MeshData, a: Pt, b: Pt, z0: number, z1: number, look: WallLook, u0 = 0, L?: number) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len < 1e-3 || z1 <= z0) return
  const n: V3 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len, 0]
  const W = L ?? len
  const bv = [look.style, look.seed, look.eave, 4]
  const A0: V3 = [a[0], a[1], z0]
  const B0: V3 = [b[0], b[1], z0]
  const B1: V3 = [b[0], b[1], z1]
  const A1: V3 = [a[0], a[1], z1]
  tri(m, A0, B0, B1, [u0, z0, W, 0], [u0 + len, z0, W, 0], [u0 + len, z1, W, 0], bv, look.life, n)
  tri(m, A0, B1, A1, [u0, z0, W, 0], [u0 + len, z1, W, 0], [u0, z1, W, 0], bv, look.life, n)
}

/** A wall whose top edge differs from its bottom edge (a tapering spire stage). */
export function taperedWall(m: MeshData, a0: Pt, b0: Pt, a1: Pt, b1: Pt, z0: number, z1: number, look: WallLook) {
  const L = Math.hypot(b0[0] - a0[0], b0[1] - a0[1])
  const L1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1])
  const d = (L - L1) / 2
  const bv = [look.style, look.seed, look.eave, 4]
  const A0: V3 = [a0[0], a0[1], z0]
  const B0: V3 = [b0[0], b0[1], z0]
  const B1: V3 = [b1[0], b1[1], z1]
  const A1: V3 = [a1[0], a1[1], z1]
  tri(m, A0, B0, B1, [0, z0, L, 0], [L, z0, L, 0], [L - d, z1, L, 0], bv, look.life)
  tri(m, A0, B1, A1, [0, z0, L, 0], [L - d, z1, L, 0], [d, z1, L, 0], bv, look.life)
}

/** Walls all round a counter-clockwise ring; u runs on continuously (round towers). */
export function prism(m: MeshData, ring: Pt[], z0: number, z1: number, look: WallLook, continuous = false) {
  let u = 0
  const perimeter = continuous ? ring.reduce((s, p, i) => s + Math.hypot(ring[(i + 1) % ring.length][0] - p[0], ring[(i + 1) % ring.length][1] - p[1]), 0) : 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    wall(m, a, b, z0, z1, look, continuous ? u : 0, continuous ? perimeter : undefined)
    u += Math.hypot(b[0] - a[0], b[1] - a[1])
  }
}

/** A vertical triangle on the line a-b, rising to `rise` above z (a gable, a gablet). */
export function gable(m: MeshData, a: Pt, b: Pt, z: number, rise: number, look: WallLook) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (len < 1e-3) return
  const n: V3 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len, 0]
  const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z + rise]
  tri(m, [a[0], a[1], z], [b[0], b[1], z], mid, [0, z, len, 0], [len, z, len, 0], [len / 2, z + rise, len, 0], [look.style, look.seed, look.eave, 4], look.life, n)
}

export interface RoofLook {
  material: number
  style: number
  seed: number
  life: Life
}

/** One triangle of roof from the edge p-q at height z up to an apex; u runs from u0 along the edge. */
export function roofFan(m: MeshData, p: Pt, q: Pt, z: number, apex: V3, look: RoofLook, u0 = 0): number {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1])
  const mid: Pt = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
  const slope = Math.hypot(Math.hypot(apex[0] - mid[0], apex[1] - mid[1]), apex[2] - z)
  const b = [look.material, FACE.slope, look.style, look.seed]
  tri(m, [p[0], p[1], z], [q[0], q[1], z], apex, [u0, 0, L, slope], [u0 + L, 0, L, slope], [u0 + L / 2, slope, L, slope], b, look.life)
  return L
}

/** Triangles from each edge of a ring at height z to an apex: a cone, a pyramid, a spire. */
export function pyramid(m: MeshData, ring: Pt[], z: number, apex: V3, look: RoofLook) {
  let u = 0
  for (let i = 0; i < ring.length; i++) u += roofFan(m, ring[i], ring[(i + 1) % ring.length], z, apex, look, u)
}

/** A sloping quad of roof between two edges (eave a-b at za, top c-d at zc), u along the eave. */
export function roofQuad(m: MeshData, a: Pt, b: Pt, za: number, d: Pt, c: Pt, zc: number, look: RoofLook) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const ex = (b[0] - a[0]) / (L || 1)
  const ey = (b[1] - a[1]) / (L || 1)
  const along = (p: Pt) => (p[0] - a[0]) * ex + (p[1] - a[1]) * ey
  const run = Math.abs((d[0] - a[0]) * -ey + (d[1] - a[1]) * ex)
  const slope = Math.hypot(run, zc - za)
  const bv = [look.material, FACE.slope, look.style, look.seed]
  const A: V3 = [a[0], a[1], za]
  const B: V3 = [b[0], b[1], za]
  const C: V3 = [c[0], c[1], zc]
  const D: V3 = [d[0], d[1], zc]
  tri(m, A, B, C, [along(a), 0, L, slope], [along(b), 0, L, slope], [along(c), slope, L, slope], bv, look.life)
  tri(m, A, C, D, [along(a), 0, L, slope], [along(c), slope, L, slope], [along(d), slope, L, slope], bv, look.life)
}

/** A flat horizontal convex polygon (fan), facing up. */
export function flatTop(m: MeshData, ring: Pt[], z: number, look: RoofLook) {
  const b = [look.material, FACE.flat, look.style, look.seed]
  for (let i = 1; i + 1 < ring.length; i++) {
    const p = ring[0]
    const q = ring[i]
    const r = ring[i + 1]
    tri(m, [p[0], p[1], z], [q[0], q[1], z], [r[0], r[1], z], [p[0], p[1], 0, 0], [q[0], q[1], 0, 0], [r[0], r[1], 0, 0], b, look.life, [0, 0, 1])
  }
}

/* ------------------------------------------------------------- props */

export interface PropLook {
  colour: V3
  kind: number
  life: Life
}

/** A box in props, centred at c (base at c[2]), turned to a compass bearing. */
export function propBox(m: MeshData, c: V3, size: V3, bearing: number, look: PropLook) {
  const f = frame([c[0], c[1]], bearing)
  const [l, w, h] = size
  const P = (s: number, t: number, z: number) => f.p3((s * l) / 2, (t * w) / 2, c[2] + z * h)
  const b = [...look.colour, look.kind]
  const faces: [V3, V3, V3, V3][] = [
    [P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)],
    [P(1, -1, 0), P(1, 1, 0), P(1, 1, 1), P(1, -1, 1)],
    [P(1, 1, 0), P(-1, 1, 0), P(-1, 1, 1), P(1, 1, 1)],
    [P(-1, 1, 0), P(-1, -1, 0), P(-1, -1, 1), P(-1, 1, 1)],
    [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]
  ]
  for (const [p, q, r, s] of faces) {
    tri(m, p, q, r, [0, 0, 0, 0], [1, 0, 0, 0], [1, 1, 0, 0], b, look.life)
    tri(m, p, r, s, [0, 0, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0], b, look.life)
  }
}

/**
 * A low-poly ellipsoid in props. `place` maps a point of the unit sphere,
 * already scaled by `radii`, into the world (rotate, then move).
 */
export function ellipsoid(m: MeshData, radii: V3, place: (p: V3) => V3, look: PropLook, seg = 8, rings = 5) {
  const pt = (i: number, j: number): V3 => {
    const th = (j / rings) * Math.PI
    const ph = (i / seg) * Math.PI * 2
    return place([Math.sin(th) * Math.cos(ph) * radii[0], Math.sin(th) * Math.sin(ph) * radii[1], Math.cos(th) * radii[2]])
  }
  const b = [...look.colour, look.kind]
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const p = pt(i, j)
      const q = pt(i, j + 1)
      const r = pt(i + 1, j + 1)
      const s = pt(i + 1, j)
      if (j > 0) tri(m, p, s, r, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], b, look.life, outward(p, s, r, place))
      if (j < rings - 1) tri(m, p, r, q, [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], b, look.life, outward(p, r, q, place))
    }
}

function outward(p: V3, q: V3, r: V3, place: (p: V3) => V3): V3 {
  const n = normalOf(p, q, r)
  const c = place([0, 0, 0])
  const m: V3 = [(p[0] + q[0] + r[0]) / 3 - c[0], (p[1] + q[1] + r[1]) / 3 - c[1], (p[2] + q[2] + r[2]) / 3 - c[2]]
  return n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0 ? [-n[0], -n[1], -n[2]] : n
}

/** A flat vertical quad facing `facing` (unit, horizontal), centred at c; uv from 0 to 1. */
export function propPanel(m: MeshData, c: V3, facing: Pt, width: number, height: number, look: PropLook) {
  const t: Pt = [facing[1], -facing[0]] // to the right, seen from the front
  const A: V3 = [c[0] - (t[0] * width) / 2, c[1] - (t[1] * width) / 2, c[2] - height / 2]
  const B: V3 = [c[0] + (t[0] * width) / 2, c[1] + (t[1] * width) / 2, c[2] - height / 2]
  const C: V3 = [B[0], B[1], c[2] + height / 2]
  const D: V3 = [A[0], A[1], c[2] + height / 2]
  const n: V3 = [facing[0], facing[1], 0]
  const b = [...look.colour, look.kind]
  tri(m, A, B, C, [0, 0, 0, 0], [1, 0, 0, 0], [1, 1, 0, 0], b, look.life, n)
  tri(m, A, C, D, [0, 0, 0, 0], [1, 1, 0, 0], [0, 1, 0, 0], b, look.life, n)
}

/** Rotate about the y axis (pitch: positive tips +x down), then about z (yaw), then move. */
export function placer(origin: V3, yawDeg: number, pitchDeg = 0, rollDeg = 0): (p: V3) => V3 {
  const yaw = (yawDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  const roll = (rollDeg * Math.PI) / 180
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  const cr = Math.cos(roll)
  const sr = Math.sin(roll)
  return ([x, y, z]) => {
    // roll about x
    const y1 = y * cr - z * sr
    const z1 = y * sr + z * cr
    // pitch about y
    const x2 = x * cp + z1 * sp
    const z2 = -x * sp + z1 * cp
    // yaw about z (counter-clockwise from +x)
    return [origin[0] + x2 * cy - y1 * sy, origin[1] + x2 * sy + y1 * cy, origin[2] + z2]
  }
}

/* ------------------------------------------------------------- the Sainte-Chapelle */

export interface ChapelSpec {
  centre: Pt
  /** Compass bearing of the axis, from the west front to the apse. */
  bearing: number
  /** Overall footprint, buttresses and porch included. */
  length: number
  width: number
  eave: number
  ridge: number
  /** Porch depth and height. */
  porch: [number, number]
  spires: { tip: number; from: number | null; until: number | null }[]
}

export const CHAPEL = { buttress: 2.4, bays: 4, apseSides: 7, turret: 1.5 }

/** Where the parts of the chapel stand, in its own frame (s along the axis, t across). */
export function chapelLayout(c: ChapelSpec) {
  const hw = c.width / 2 - CHAPEL.buttress
  const sFront = -c.length / 2
  const sWest = sFront + c.porch[0]
  const radius = hw
  // The apse buttresses (2.2 m deep) reach the east end of the footprint.
  const sApse = c.length / 2 - (CHAPEL.buttress - 0.2) - radius
  const bay = (sApse - sWest) / CHAPEL.bays
  // Lassus's spire stands a little east of the middle of the nave.
  const sSpire = sWest + bay * 2.1
  return { hw, sFront, sWest, radius, sApse, bay, sSpire }
}

/**
 * The Sainte-Chapelle: walls with their great windows (shader), buttresses
 * with pinnacles, gablets over the windows, the steep roof with its apse,
 * the west porch and rose, two turrets, a gilt crest, and the spires of
 * each period.
 */
export function addChapel(walls: MeshData, roofs: MeshData, props: MeshData, c: ChapelSpec) {
  const f = frame(c.centre, c.bearing)
  const L = chapelLayout(c)
  const { hw, sFront, sWest, radius, sApse, bay } = L
  const side: WallLook = { style: LM.sainteChapelle, seed: 0.3, eave: c.eave, life: ALWAYS }
  const front: WallLook = { style: LM.chapelFront, seed: c.porch[1] / 100, eave: c.eave, life: ALWAYS }
  const stone: WallLook = { style: LM.stone, seed: 0.4, eave: c.eave, life: ALWAYS }
  const lead: RoofLook = { material: ROOF_MATERIAL.lead, style: LM.sainteChapelle, seed: 0.3, life: ALWAYS }
  const stoneRoof: RoofLook = { material: ROOF_MATERIAL.stone, style: LM.stone, seed: 0.4, life: ALWAYS }
  const apseC = f.at(sApse, 0)
  const apsePts: Pt[] = []
  for (let j = 0; j <= CHAPEL.apseSides; j++) {
    const th = -Math.PI / 2 + (j * Math.PI) / CHAPEL.apseSides
    apsePts.push(f.at(sApse + Math.cos(th) * radius, Math.sin(th) * radius))
  }
  // Bays of the body, counter-clockwise: south side west to east, apse, north side east to west.
  const segments: [Pt, Pt][] = []
  for (let k = 0; k < CHAPEL.bays; k++) segments.push([f.at(sWest + k * bay, -hw), f.at(sWest + (k + 1) * bay, -hw)])
  for (let j = 0; j < CHAPEL.apseSides; j++) segments.push([apsePts[j], apsePts[j + 1]])
  for (let k = CHAPEL.bays - 1; k >= 0; k--) segments.push([f.at(sWest + (k + 1) * bay, hw), f.at(sWest + k * bay, hw)])
  for (const [a, b] of segments) {
    wall(walls, a, b, 0, c.eave, side)
    // A gablet over each window, rising in front of the roof.
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const ex = (b[0] - a[0]) / len
    const ey = (b[1] - a[1]) / len
    const inset = 0.25
    gable(walls, [a[0] + ex * inset, a[1] + ey * inset], [b[0] - ex * inset, b[1] - ey * inset], c.eave, Math.min(3.6, 0.7 * len), side)
  }
  // The west wall above the porch, with the rose, and the gable up to the ridge.
  const nw = f.at(sWest, hw)
  const sw = f.at(sWest, -hw)
  wall(walls, nw, sw, c.porch[1], c.eave, front)
  gable(walls, nw, sw, c.eave, c.ridge - c.eave, front)
  // The porch: two storeys in front of the west wall, flat-topped.
  const porch: Pt[] = [f.at(sFront, -hw), f.at(sWest, -hw), f.at(sWest, hw), f.at(sFront, hw)]
  wall(walls, porch[0], porch[1], 0, c.porch[1], front)
  wall(walls, porch[2], porch[3], 0, c.porch[1], front)
  wall(walls, porch[3], porch[0], 0, c.porch[1], front)
  flatTop(roofs, porch, c.porch[1], stoneRoof)
  // Roof: two steep slopes to the ridge, and a half-cone of facets over the apse.
  const ridgeW = f.at(sWest, 0)
  const ridgeE = f.at(sApse, 0)
  roofQuad(roofs, f.at(sWest, -hw), f.at(sApse, -hw), c.eave, ridgeW, ridgeE, c.ridge, lead)
  roofQuad(roofs, f.at(sApse, hw), f.at(sWest, hw), c.eave, ridgeE, ridgeW, c.ridge, lead)
  for (let j = 0; j < CHAPEL.apseSides; j++) roofFan(roofs, apsePts[j], apsePts[j + 1], c.eave, [apseC[0], apseC[1], c.ridge], lead)
  // Buttresses between the bays and round the apse, each with a pinnacle.
  const posts: { at: Pt; out: Pt }[] = []
  for (let k = 1; k <= CHAPEL.bays; k++) {
    posts.push({ at: f.at(sWest + k * bay, -hw), out: [-f.n[0], -f.n[1]] })
    posts.push({ at: f.at(sWest + k * bay, hw), out: f.n })
  }
  for (let j = 1; j < CHAPEL.apseSides; j++) {
    const p = apsePts[j]
    const l = Math.hypot(p[0] - apseC[0], p[1] - apseC[1])
    posts.push({ at: p, out: [(p[0] - apseC[0]) / l, (p[1] - apseC[1]) / l] })
  }
  for (const { at, out } of posts) {
    const along: Pt = [-out[1], out[0]]
    const d = CHAPEL.buttress - 0.2
    const w = 1.1
    const ring = ccw([
      [at[0] - along[0] * w * 0.5, at[1] - along[1] * w * 0.5],
      [at[0] + along[0] * w * 0.5, at[1] + along[1] * w * 0.5],
      [at[0] + along[0] * w * 0.5 + out[0] * d, at[1] + along[1] * w * 0.5 + out[1] * d],
      [at[0] - along[0] * w * 0.5 + out[0] * d, at[1] - along[1] * w * 0.5 + out[1] * d]
    ])
    prism(walls, ring, 0, c.eave - 0.8, stone)
    // A slender pinnacle on the outer half of the buttress.
    const pc: Pt = [at[0] + out[0] * d * 0.62, at[1] + out[1] * d * 0.62]
    const pin = ccw([0, 1, 2, 3].map((k): Pt => {
      const s = k === 0 || k === 3 ? -1 : 1
      const t = k < 2 ? -1 : 1
      return [pc[0] + along[0] * s * 0.38 + out[0] * t * 0.38, pc[1] + along[1] * s * 0.38 + out[1] * t * 0.38]
    }))
    prism(walls, pin, c.eave - 0.8, c.eave + 0.6, stone)
    pyramid(roofs, pin, c.eave + 0.6, [pc[0], pc[1], c.eave + 4.4], stoneRoof)
    flatTop(roofs, ring, c.eave - 0.8, stoneRoof)
  }
  // Two turrets at the west corners, with spirelets.
  for (const t of [hw + 0.3, -hw - 0.3]) {
    const tc = f.at(sWest - 0.4, t)
    const ring = regularRing(tc, CHAPEL.turret, 8, c.bearing + 22.5)
    prism(walls, ring, 0, c.eave + 4, { style: LM.tower, seed: 0.6, eave: c.eave + 4, life: ALWAYS }, true)
    pyramid(roofs, ring, c.eave + 4, [tc[0], tc[1], c.eave + 11], lead)
    ellipsoid(props, [0.35, 0.35, 0.35], placer([tc[0], tc[1], c.eave + 11.2], 0), { colour: GILT, kind: PROP.gilt, life: ALWAYS }, 6, 4)
  }
  // The gilt crest along the ridge.
  const ridgeLen = sApse - sWest
  const rc = f.at((sWest + sApse) / 2, 0)
  propBox(props, [rc[0], rc[1], c.ridge - 0.05], [ridgeLen, 0.12, 0.55], c.bearing, { colour: GILT, kind: PROP.gilt, life: ALWAYS })
  // The spires: the medieval one until the Revolution, Lassus's from 1855.
  for (const s of c.spires) addOpenSpire(walls, roofs, props, f.at(L.sSpire, 0), c.ridge, s.tip, lifeOf(s.from, s.until), c.bearing)
}

/**
 * An octagonal lead spire with openwork stages: a lantern stage with gablets
 * and corner pinnacles, a narrower stage, then the needle and a gilt finial.
 */
export function addOpenSpire(walls: MeshData, roofs: MeshData, props: MeshData, at: Pt, base: number, tip: number, life: Life, bearing = 0) {
  const h = tip - base
  const z1 = base + h * 0.21
  const z2 = base + h * 0.38
  const r1 = 2.2
  const r2 = 1.6
  const ring1 = regularRing(at, r1, 8, bearing + 22.5)
  const ring2 = regularRing(at, r2, 8, bearing + 22.5)
  const open1: WallLook = { style: LM.openwork, seed: (z1 - base) / 20, eave: z1, life }
  const open2: WallLook = { style: LM.openwork, seed: (z2 - z1) / 20, eave: z2, life }
  prism(walls, ring1, base - 4, z1, open1)
  prism(walls, ring2, z1, z2, open2)
  for (let i = 0; i < 8; i++) gable(walls, ring1[i], ring1[(i + 1) % 8], z1, 2.0, open1)
  const lead: RoofLook = { material: ROOF_MATERIAL.lead, style: LM.openwork, seed: 0.5, life }
  for (const p of ring1) {
    const pr = regularRing(p, 0.32, 4, bearing)
    pyramid(roofs, pr, z1 - 1, [p[0], p[1], z1 + 3.5], lead)
  }
  pyramid(roofs, regularRing(at, 1.5, 8, bearing + 22.5), z2, [at[0], at[1], tip - 0.9], lead)
  ellipsoid(props, [0.32, 0.32, 0.32], placer([at[0], at[1], tip - 0.7], 0), { colour: GILT, kind: PROP.gilt, life }, 6, 4)
  propBox(props, [at[0], at[1], tip - 0.5], [0.08, 0.08, 0.5], bearing, { colour: GILT, kind: PROP.gilt, life })
}

/* ------------------------------------------------------------- towers and a dome */

export interface RoundTower {
  at: Pt
  radius: number
  wall: number
  tip: number
  roof: 'cone' | 'battlements'
}

/** A round tower with a conical roof, or with battlements round a low cone. */
export function addRoundTower(walls: MeshData, roofs: MeshData, t: RoundTower, life: Life) {
  const sides = 20
  const ring = regularRing(t.at, t.radius, sides)
  const look: WallLook = { style: LM.tower, seed: 0.5, eave: t.wall, life }
  const lead: RoofLook = { material: ROOF_MATERIAL.lead, style: LM.tower, seed: 0.5, life }
  if (t.roof === 'battlements') {
    prism(walls, ring, 0, t.wall + 1.6, look, true)
    pyramid(roofs, regularRing(t.at, t.radius - 0.8, sides), t.wall, [t.at[0], t.at[1], t.tip], lead)
  } else {
    prism(walls, ring, 0, t.wall, look, true)
    pyramid(roofs, regularRing(t.at, t.radius + 0.35, sides), t.wall - 0.2, [t.at[0], t.at[1], t.tip], lead)
  }
}

export interface SquareTower {
  corners: Pt[]
  wall: number
  roofTip: number
  tip: number
  clock?: { facing: Pt; z: number }
}

/** The Tour de l'Horloge: a square tower, a steep pyramid roof with a small lantern, the clock. */
export function addSquareTower(walls: MeshData, roofs: MeshData, props: MeshData, t: SquareTower, life: Life) {
  const ring = ccw(t.corners)
  prism(walls, ring, 0, t.wall, { style: LM.tower, seed: 0.55, eave: t.wall, life })
  const c = centroid(ring)
  const lead: RoofLook = { material: ROOF_MATERIAL.lead, style: LM.tower, seed: 0.5, life }
  pyramid(roofs, grow(ring, 0.4), t.wall - 0.2, [c[0], c[1], t.roofTip], lead)
  const lantern = regularRing(c, 0.9, 8)
  prism(walls, lantern, t.roofTip - 2.6, t.roofTip + 0.8, { style: LM.openwork, seed: 0.15, eave: t.roofTip + 0.8, life })
  pyramid(roofs, lantern, t.roofTip + 0.8, [c[0], c[1], t.tip], lead)
  if (t.clock) {
    // The clock on the face that looks the right way, a little proud of the wall.
    let best = 0
    let bestDot = -2
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1])
      const d = ((b[1] - a[1]) / l) * t.clock.facing[0] + (-(b[0] - a[0]) / l) * t.clock.facing[1]
      if (d > bestDot) {
        bestDot = d
        best = i
      }
    }
    const a = ring[best]
    const b = ring[(best + 1) % ring.length]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n: Pt = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]
    const mid: Pt = [(a[0] + b[0]) / 2 + n[0] * 0.08, (a[1] + b[1]) / 2 + n[1] * 0.08]
    propPanel(props, [mid[0], mid[1], t.clock.z], n, Math.min(5.0, l * 0.62), 6.4, { colour: MARBLE, kind: PROP.clock, life })
  }
}

export interface DomeSpec {
  at: Pt
  radius: number
  /** Compass bearing from the centre to the first corner of the octagon. */
  rotation: number
  drum_base: number
  drum_top: number
  dome_top: number
  lantern: number
}

/** An octagonal drum with windows, a ribbed dome of elliptical profile, a lantern. */
export function addDome(walls: MeshData, roofs: MeshData, props: MeshData, d: DomeSpec, life: Life) {
  const drum = regularRing(d.at, d.radius, 8, d.rotation)
  prism(walls, drum, d.drum_base, d.drum_top, { style: LM.tribunal, seed: 0.99, eave: d.drum_top, life })
  const lead: RoofLook = { material: ROOF_MATERIAL.lead, style: LM.tribunal, seed: 0.5, life }
  const rLantern = Math.max(1.2, d.radius * 0.22)
  const H = d.dome_top - d.drum_top
  const fTop = Math.sqrt(1 - (rLantern / d.radius) ** 2)
  const rings = 6
  let prev = grow(drum, 0.25)
  let prevZ = d.drum_top
  for (let i = 1; i <= rings; i++) {
    const f = (i / rings) * fTop
    const r = (d.radius + 0.25) * Math.sqrt(1 - f * f)
    const z = d.drum_top + H * f
    const ring = regularRing(d.at, Math.max(r, rLantern), 8, d.rotation)
    for (let k = 0; k < 8; k++) roofQuad(roofs, prev[k], prev[(k + 1) % 8], prevZ, ring[k], ring[(k + 1) % 8], z, lead)
    prev = ring
    prevZ = z
  }
  const lantern = regularRing(d.at, rLantern, 8, d.rotation)
  const zl = prevZ
  prism(walls, lantern, zl - 0.3, zl + 2.8, { style: LM.tribunal, seed: 0.99, eave: zl + 2.8, life })
  pyramid(roofs, grow(lantern, 0.15), zl + 2.8, [d.at[0], d.at[1], d.lantern - 0.6], lead)
  ellipsoid(props, [0.3, 0.3, 0.3], placer([d.at[0], d.at[1], d.lantern - 0.35], 0), { colour: GILT, kind: PROP.gilt, life }, 6, 4)
}

/* ------------------------------------------------------------- Notre-Dame's flying buttresses */

export interface Flyer {
  foot: Pt
  head: Pt
  footZ: number
  headZ: number
  apse: boolean
}

/**
 * A flying buttress: a pier on the aisle's outer wall, rising above the
 * aisle roof to a pinnacle, and an arm from it to the nave wall, straight on
 * top and arched underneath.
 */
export function addFlyer(walls: MeshData, roofs: MeshData, fl: Flyer) {
  const dx = fl.head[0] - fl.foot[0]
  const dy = fl.head[1] - fl.foot[1]
  const span = Math.hypot(dx, dy)
  if (span < 1) return
  const ax: Pt = [dx / span, dy / span]
  const across: Pt = [-ax[1], ax[0]]
  const stone: WallLook = { style: LM.stone, seed: 0.45, eave: fl.footZ + 3, life: ALWAYS }
  const stoneRoof: RoofLook = { material: ROOF_MATERIAL.stone, style: LM.stone, seed: 0.45, life: ALWAYS }
  // The pier (culée): 1.5 m across, 2.6 m deep, centred just outside the wall line.
  const pw = fl.apse ? 1.2 : 1.5
  const pd = 2.6
  const P = (s: number, t: number): Pt => [fl.foot[0] + ax[0] * s + across[0] * t, fl.foot[1] + ax[1] * s + across[1] * t]
  const pier = ccw([P(-pd * 0.7, -pw / 2), P(pd * 0.3, -pw / 2), P(pd * 0.3, pw / 2), P(-pd * 0.7, pw / 2)])
  const pierTop = fl.footZ + 2.5
  prism(walls, pier, 0, pierTop, stone)
  const pc = centroid(pier)
  pyramid(roofs, grow(pier, -0.15), pierTop, [pc[0], pc[1], pierTop + 4.5], stoneRoof)
  // The arm: top edge straight from the pier to the head, a quarter-ellipse below.
  const s0 = pd * 0.3
  const run = span - s0
  const topA = fl.footZ + 0.6
  const topB = fl.headZ + 0.9
  const botB = fl.headZ - 1.2
  const botA = fl.footZ - 3.2
  const w = 0.75
  const n = 8
  const top = (i: number) => topA + ((topB - topA) * i) / n
  // Under the arm: rises steeply from the pier, flattening toward the wall.
  const bottom = (i: number) => {
    const f = i / n
    return botA + (botB - botA) * Math.sin((f * Math.PI) / 2)
  }
  const sAt = (i: number) => s0 + (run * i) / n
  for (const t of [-w / 2, w / 2]) {
    for (let i = 0; i < n; i++) {
      const a = P(sAt(i), t)
      const b = P(sAt(i + 1), t)
      const A0: V3 = [a[0], a[1], bottom(i)]
      const B0: V3 = [b[0], b[1], bottom(i + 1)]
      const B1: V3 = [b[0], b[1], top(i + 1)]
      const A1: V3 = [a[0], a[1], top(i)]
      const nn: V3 = t < 0 ? [-across[0], -across[1], 0] : [across[0], across[1], 0]
      const bv = [stone.style, stone.seed, stone.eave, 4]
      const ua = sAt(i)
      const ub = sAt(i + 1)
      tri(walls, A0, B0, B1, [ua, A0[2], span, 0], [ub, B0[2], span, 0], [ub, B1[2], span, 0], bv, ALWAYS, nn)
      tri(walls, A0, B1, A1, [ua, A0[2], span, 0], [ub, B1[2], span, 0], [ua, A1[2], span, 0], bv, ALWAYS, nn)
    }
  }
  // Top and underside surfaces.
  for (let i = 0; i < n; i++) {
    for (const [zf, up] of [
      [top, true],
      [bottom, false]
    ] as [(i: number) => number, boolean][]) {
      const a0 = P(sAt(i), -w / 2)
      const a1 = P(sAt(i), w / 2)
      const b0 = P(sAt(i + 1), -w / 2)
      const b1 = P(sAt(i + 1), w / 2)
      const bv = [stone.style, stone.seed, stone.eave, 4]
      const za = zf(i)
      const zb = zf(i + 1)
      const nz: V3 = up ? [0, 0, 1] : [0, 0, -1]
      tri(walls, [a0[0], a0[1], za], [b0[0], b0[1], zb], [b1[0], b1[1], zb], [0, za, w, 0], [0, zb, w, 0], [w, zb, w, 0], bv, ALWAYS, nz)
      tri(walls, [a0[0], a0[1], za], [b1[0], b1[1], zb], [a1[0], a1[1], za], [0, za, w, 0], [w, zb, w, 0], [w, za, w, 0], bv, ALWAYS, nz)
    }
  }
}

/* ------------------------------------------------------------- Henri IV on the Pont Neuf */

/**
 * The equestrian statue on its pedestal, low-poly: a walking horse, the king
 * in armour with his cloak and hat. `variant` 1614 adds the four bronze
 * captives at the corners of the first pedestal. Sizes are an estimate
 * (larger than life on a pedestal about 4 m high).
 */
export function addStatue(props: MeshData, at: Pt, heading: number, variant: number, life: Life) {
  const marble: PropLook = { colour: MARBLE, kind: PROP.paint, life }
  const bronze: PropLook = { colour: BRONZE, kind: PROP.bronze, life }
  propBox(props, [at[0], at[1], 0], [6.6, 3.4, 0.7], heading, marble)
  propBox(props, [at[0], at[1], 0.7], [5.4, 2.5, 3.0], heading, { ...marble, colour: [0.78, 0.75, 0.69] })
  propBox(props, [at[0], at[1], 3.7], [6.0, 3.0, 0.45], heading, marble)
  const f = frame(at, heading)
  const top = 4.15
  // Bas-reliefs on the long sides (Lemot's pedestal has two).
  if (variant >= 1818)
    for (const t of [1.27, -1.27]) {
      const c = f.at(0, t)
      propBox(props, [c[0], c[1], 1.4], [2.6, 0.06, 1.5], heading, bronze)
    }
  // Compass bearing to the yaw of placer(): yaw is counter-clockwise from east.
  const yaw = 90 - heading
  const k = 1.15
  const part = (s: number, t: number, z: number, radii: V3, pitch = 0, roll = 0) => {
    const p = f.p3(s * k, t * k, top + z * k)
    ellipsoid(props, [radii[0] * k, radii[1] * k, radii[2] * k], placer(p, yaw, pitch, roll), bronze, 8, 5)
  }
  // The horse, walking: the off foreleg raised.
  part(0, 0, 2.0, [1.25, 0.5, 0.6])
  part(0.85, 0, 2.1, [0.6, 0.46, 0.58])
  part(-0.85, 0, 2.05, [0.62, 0.5, 0.6])
  part(1.35, 0, 2.75, [0.32, 0.26, 0.72], 35)
  part(1.82, 0, 3.25, [0.46, 0.18, 0.2], 40)
  part(-1.45, 0, 1.7, [0.14, 0.12, 0.62], 20)
  const leg = (s: number, t: number, z: number, len: number, pitch: number) => part(s, t, z, [0.13, 0.12, len / 2], pitch)
  leg(0.85, 0.28, 0.75, 1.55, 0)
  leg(1.15, -0.28, 1.35, 1.1, -55)
  leg(-0.85, 0.28, 0.75, 1.55, 8)
  leg(-0.95, -0.28, 0.75, 1.55, -8)
  // The king: legs, body, cloak, head and hat, the arm holding the baton.
  part(0.12, 0.42, 2.45, [0.42, 0.14, 0.17], 15)
  part(0.12, -0.42, 2.45, [0.42, 0.14, 0.17], 15)
  part(0.32, 0.5, 1.95, [0.13, 0.13, 0.42])
  part(0.32, -0.5, 1.95, [0.13, 0.13, 0.42])
  part(-0.02, 0, 3.15, [0.28, 0.34, 0.55])
  part(-0.3, 0, 3.0, [0.22, 0.42, 0.62], -10)
  part(0.0, 0, 3.86, [0.17, 0.16, 0.2])
  part(0.0, 0, 4.06, [0.32, 0.32, 0.05])
  part(0.0, 0, 4.16, [0.15, 0.15, 0.1])
  part(0.32, -0.36, 3.2, [0.36, 0.09, 0.09], 30)
  // The first statue's pedestal had a bronze captive at each corner.
  if (variant < 1818)
    for (const [s, t] of [
      [2.75, 1.25],
      [2.75, -1.25],
      [-2.75, 1.25],
      [-2.75, -1.25]
    ]) {
      const p = f.p3(s, t, 0.7)
      ellipsoid(props, [0.45, 0.4, 0.55], placer([p[0], p[1], p[2] + 0.5], yaw), bronze, 6, 4)
      ellipsoid(props, [0.17, 0.17, 0.2], placer([p[0], p[1], p[2] + 1.2], yaw), bronze, 6, 4)
    }
}

/* ------------------------------------------------------------- market stalls */

/** A flower stall: a trestle table with flowers on it under a canvas parasol. */
export function addStall(props: MeshData, at: Pt, seed: number, life: Life) {
  const bearing = seed * 360
  const wood: PropLook = { colour: [0.36, 0.25, 0.16], kind: PROP.paint, life }
  propBox(props, [at[0], at[1], 0.7], [1.8, 0.9, 0.1], bearing, wood)
  propBox(props, [at[0], at[1], 0], [1.6, 0.7, 0.7], bearing, { ...wood, colour: [0.28, 0.2, 0.13] })
  const f = frame(at, bearing)
  const blooms: V3[] = [
    [0.75, 0.2, 0.25],
    [0.85, 0.75, 0.3],
    [0.85, 0.55, 0.65],
    [0.9, 0.88, 0.85],
    [0.55, 0.3, 0.6]
  ]
  for (let i = 0; i < 4; i++) {
    const c = f.at(-0.6 + i * 0.4, 0)
    const colour = blooms[Math.floor((seed * 97 + i * 3.7) % blooms.length)]
    propBox(props, [c[0], c[1], 0.8], [0.32, 0.6, 0.28], bearing, { colour, kind: PROP.paint, life })
  }
  propBox(props, [at[0], at[1], 0.8], [0.06, 0.06, 1.6], bearing, wood)
  const canvas: V3 = seed < 0.5 ? [0.88, 0.85, 0.76] : seed < 0.8 ? [0.35, 0.5, 0.36] : [0.7, 0.32, 0.25]
  const ring = regularRing(at, 1.35, 8, bearing)
  const b = [...canvas, PROP.canvas]
  const apex: V3 = [at[0], at[1], 2.85]
  for (let i = 0; i < 8; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % 8]
    tri(props, [p[0], p[1], 2.3], [q[0], q[1], 2.3], apex, [i / 8, 0, 0, 0], [(i + 1) / 8, 0, 0, 0], [(i + 0.5) / 8, 1, 0, 0], b, life)
  }
}

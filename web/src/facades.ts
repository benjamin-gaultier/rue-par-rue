/**
 * Relief and layout for ordinary buildings (styles old, Haussmann, modern):
 * the decisions shared by the geometry and the facade shader, and the parts
 * that are real geometry because they read best in 3D when you walk past:
 * cornices, string courses, continuous balconies with railings, shopfront
 * casings, awnings, projecting signs, mansard dormers and chimney pots.
 *
 * Everything here is merged into the wall and roof meshes (no extra draw
 * call). Each part carries `a_c.x` = PART, read by the wall shader.
 *
 * Shared with the shader: `ihash` (integer hash, identical in GLSL),
 * `bayWidth`, `floorLayout` and the ground floor layout, which is decided
 * here and packed into the wall's `a_c` so the shader and the geometry agree.
 */

import type { MeshData, Pt } from './citygen'
import { TRADES } from './signs'

type Life = [number, number, number, number]
type V3 = [number, number, number]

/** What a wall-mesh triangle is, in a_c.x (0: a wall). */
export const PART = { wall: 0, moulding: 1, slab: 2, rail: 3, awning: 4, casing: 5, sign: 6 } as const
/** Moulding kinds (a_a.w of a moulding: kind × 1000 + bottom height). */
export const MOULDING = { oldCornice: 0, cornice: 1, coping: 2, band: 3 } as const
/** Faces of a projecting part, in a_c.z. */
export const SIDE = { front: 0, under: 1, top: 2, end: 3 } as const
/** Ground floor bays, two bits each in a_c.z of a facade wall. */
export const BAY = { plain: 0, shop: 1, more: 2, door: 3 } as const
/** Projecting signs, in a_c.z of a sign. */
export const SIGN = { board: 0, grapes: 1, basin: 2, carrot: 3, flag: 4, cross: 5, horse: 6, litCarrot: 7, litCross: 8 } as const
/** Facade flags, in a_c.w of a facade wall (above the porte-cochère bay + 1, which takes the low 4 bits). */
export const FACADE = { courtyard: 16, timber: 32, entresol: 64 } as const

const OLD = 0
const HAUSSMANN = 1

/* ------------------------------------------------------------- shared with GLSL */

/** An integer hash of three integers, the same in the shader (see `ihash` in cityshaders.ts). */
export function ihashu(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0
  h = (h ^ (h >>> 15)) >>> 0
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h = (h ^ (h >>> 12)) >>> 0
  h = Math.imul(h, 0x297a2d39) >>> 0
  h = (h ^ (h >>> 15)) >>> 0
  return h
}

/** 0..1 from three integers (24 bits, exact in float32). */
export function ihash(a: number, b: number, c = 0): number {
  return (ihashu(a, b, c) >>> 8) / 16777216
}

/** The per-building integer the shader hashes (from the 0..1 seed). */
export function sidOf(seed: number): number {
  return Math.floor(seed * 997 + 0.5)
}

/** Window bay width of a facade style (the shader's bayWidth). */
export function bayWidth(style: number, seed: number): number {
  if (style < 0.5) return 2.2 + seed * 0.7
  if (style < 1.5) return 3.1
  if (style < 2.5) return 2.9
  if (style > 5.5) return 6.3
  return 4.8
}

/** Bays of a wall of length L: width and count (the shader divides the same way). */
export function bays(style: number, seed: number, L: number): { bw: number; n: number } {
  const n = Math.max(1, Math.floor(L / bayWidth(style, seed)))
  return { bw: L / n, n }
}

/** Ground floor height, number of upper floors below the eave and their height (the shader's floorLayout). */
export function floorLayout(style: number, eave: number, fh: number): { ground: number; n: number; fh: number } {
  const ground = style === OLD ? 3.3 : style === HAUSSMANN ? 4.3 : 3.6
  const n = Math.max(0, Math.floor((eave - ground - 0.4) / fh + 0.3))
  return { ground, n, fh: n > 0 ? (eave - ground - 0.4) / n : 1 }
}

/** Window sill height within a floor, as the shader draws it. */
export function sillOf(style: number, fh: number): number {
  return style === HAUSSMANN ? fh * 0.12 : fh * 0.24
}

export interface GroundLayout {
  bw: number
  bays: number
  /** One BAY code per bay (bays beyond 12 repeat the first 12). */
  codes: number[]
  /** Bay of the carriage door, or -1. */
  cochere: number
}

/**
 * Ground floor of a facade: which bays are shops (runs of `shop` then
 * `more`), house doors, plain windows, and where a porte-cochère is.
 */
export function groundLayout(style: number, seed: number, sid: number, wall: number, L: number, opts: { courtyard?: boolean; cochere?: boolean } = {}): GroundLayout {
  const { bw, n } = bays(style, seed, L)
  const count = Math.min(n, 12)
  const codes: number[] = new Array(count).fill(BAY.plain)
  const h = (k: number, salt: number) => ihash(sid, wall * 32 + k, salt)
  let cochere = -1
  if (opts.courtyard) {
    codes[Math.floor(h(0, 1) * count)] = BAY.door
    return { bw, bays: n, codes, cochere }
  }
  if (opts.cochere && count >= 3) {
    cochere = Math.floor(count / 2) - (count % 2 === 0 && h(0, 9) < 0.5 ? 1 : 0)
    codes[cochere] = BAY.door
  }
  const shops = (from: number, maxRun: number, pPlain: number) => {
    let run = 0
    for (let k = from; k < count; k++) {
      if (codes[k] === BAY.door) {
        run = 0
        continue
      }
      if (h(k, 4) < pPlain) {
        codes[k] = BAY.plain
        run = 0
      } else if (run > 0 && run < maxRun && h(k, 5) < 0.7) {
        codes[k] = BAY.more
        run++
      } else {
        codes[k] = BAY.shop
        run = 1
      }
    }
  }
  if (style === OLD) {
    if (L < 1.8) codes[0] = BAY.door
    else if (count === 1) codes[0] = h(0, 2) < 0.7 ? BAY.shop : BAY.door
    else {
      // The alley door to the stairs at one end, one shop over the rest (most houses).
      if (cochere < 0) codes[h(0, 3) < 0.5 ? 0 : count - 1] = BAY.door
      shops(0, 3, h(0, 6) < 0.15 ? 1 : 0.04)
    }
  } else if (style === HAUSSMANN) {
    if (cochere < 0 && count >= 2) codes[Math.floor(h(0, 3) * count)] = BAY.door
    shops(0, 2, 0.1)
  } else {
    if (count >= 2) codes[Math.floor(h(0, 3) * count)] = BAY.door
    shops(0, 3, h(0, 6) < 0.3 ? 1 : 0.1)
  }
  return { bw, bays: n, codes, cochere }
}

/** The ground floor codes packed two bits per bay (exact in a float). */
export function packCodes(codes: number[]): number {
  let v = 0
  codes.slice(0, 12).forEach((c, k) => (v += c * 4 ** k))
  return v
}

/** Runs of shop bays: [first bay, last bay]. */
export function shopRuns(codes: number[], n: number): [number, number][] {
  const runs: [number, number][] = []
  for (let k = 0; k < n; k++) {
    const c = codes[k % codes.length]
    if (c === BAY.shop || (c === BAY.more && !runs.length)) runs.push([k, k])
    else if (c === BAY.more) runs[runs.length - 1][1] = k
  }
  return runs
}

/** The trade of a shop (index into TRADES), as the shader picks it. */
export function tradeOf(sid: number, wall: number, start: number): number {
  return ihashu(sid, wall * 32 + start, 7) % TRADES.length
}

/** A height and a year in one float: tenths of a metre + 1000 × (year - 1700), years clamped to 1700–2100. */
export function packHeightYear(h: number, year: number): number {
  return Math.round(Math.max(0, Math.min(99.9, h)) * 10) + 1000 * Math.max(0, Math.min(400, Math.round(year) - 1700))
}

/* ------------------------------------------------------------- geometry helpers */

interface Ctx {
  owner: number
  b: number[]
  life: Life
  id: number
}

function quad(m: MeshData, ctx: Ctx, p: V3[], a: number[][], n: V3, c: number[], life: Life = ctx.life) {
  for (const i of [0, 1, 2, 0, 2, 3]) m.vertex(p[i], n, a[i], ctx.b, life, c)
  m.owner.push(ctx.owner, ctx.owner)
}

function tri(m: MeshData, ctx: Ctx, p: V3[], a: number[][], n: V3, c: number[], life: Life = ctx.life) {
  for (let i = 0; i < 3; i++) m.vertex(p[i], n, a[i], ctx.b, life, c)
  m.owner.push(ctx.owner)
}

function normal(a: Pt, b: Pt): [number, number] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]
}

/**
 * Outward offsets of a ring's vertices for a projecting strip along the
 * flagged edges: mitred where two flagged edges meet, square where a strip
 * stops (against a party wall).
 */
export function stripOffsets(ring: Pt[], flagged: boolean[]): { start: Pt[]; end: Pt[] } {
  const n = ring.length
  const start: Pt[] = []
  const end: Pt[] = []
  for (let i = 0; i < n; i++) {
    const prev = (i + n - 1) % n
    const n1 = normal(ring[prev], ring[i])
    const n2 = normal(ring[i], ring[(i + 1) % n])
    let m: Pt
    if (flagged[prev] && flagged[i]) {
      const d = Math.max(0.2, 1 + n1[0] * n2[0] + n1[1] * n2[1])
      m = [(n1[0] + n2[0]) / d, (n1[1] + n2[1]) / d]
      const l = Math.hypot(m[0], m[1])
      if (l > 2.5) m = [(m[0] * 2.5) / l, (m[1] * 2.5) / l]
    } else m = n2
    start.push(m) // offset direction where edge i starts
    end.push(flagged[i] && flagged[prev] ? m : n1) // where edge prev ends
  }
  // end[i] belongs to the edge that ends at vertex i: shift so end[i] is for edge i (ending at i+1).
  const endFor: Pt[] = ring.map((_, i) => end[(i + 1) % n])
  return { start, end: endFor }
}

export interface StripProfile {
  /** Projection from the wall, metres. */
  depth: number
  z0: number
  z1: number
  /** PART.moulding or PART.slab. */
  part: number
  /** a_a.w for every vertex (moulding kind × 1000 + z0, or the slab top). */
  w: number
  /** Rise of the top face toward the wall (sheds rain). */
  slope?: number
  /** Close the ends where a strip stops. */
  caps?: boolean
}

/** A projecting strip (cornice, string course, balcony slab) along the flagged edges of a ring. */
export function addStrip(m: MeshData, ctx: Ctx, ring: Pt[], flagged: boolean[], prof: StripProfile) {
  const { start, end } = stripOffsets(ring, flagged)
  const n = ring.length
  const { depth: d, z0, z1 } = prof
  const top = z1 + (prof.slope ?? 0)
  for (let i = 0; i < n; i++) {
    if (!flagged[i]) continue
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const nn = normal(a, b)
    const A: Pt = [a[0] + start[i][0] * d, a[1] + start[i][1] * d]
    const B: Pt = [b[0] + end[i][0] * d, b[1] + end[i][1] * d]
    const c = (side: number) => [prof.part, ctx.id, side, 0]
    const aa = (u: number, z: number) => [u, z, L, prof.w]
    // Front
    quad(m, ctx, [[A[0], A[1], z0], [B[0], B[1], z0], [B[0], B[1], z1], [A[0], A[1], z1]], [aa(0, z0), aa(L, z0), aa(L, z1), aa(0, z1)], [nn[0], nn[1], 0], c(SIDE.front))
    // Underside
    quad(m, ctx, [[a[0], a[1], z0], [b[0], b[1], z0], [B[0], B[1], z0], [A[0], A[1], z0]], [aa(0, z0), aa(L, z0), aa(L, z0 - d), aa(0, z0 - d)], [0, 0, -1], c(SIDE.under))
    // Top, rising a little toward the wall
    const tn = Math.hypot(d, top - z1) || 1
    quad(m, ctx, [[A[0], A[1], z1], [B[0], B[1], z1], [b[0], b[1], top], [a[0], a[1], top]], [aa(0, z1), aa(L, z1), aa(L, z1 + d), aa(0, z1 + d)], [(nn[0] * (top - z1)) / tn, (nn[1] * (top - z1)) / tn, d / tn], c(SIDE.top))
    if (prof.caps) {
      const prev = (i + n - 1) % n
      const next = (i + 1) % n
      if (!flagged[prev]) quad(m, ctx, [[a[0], a[1], z0], [A[0], A[1], z0], [A[0], A[1], z1], [a[0], a[1], top]], [aa(0, z0), aa(d, z0), aa(d, z1), aa(0, top)], [-(b[0] - a[0]) / L, -(b[1] - a[1]) / L, 0], c(SIDE.end))
      if (!flagged[next]) quad(m, ctx, [[B[0], B[1], z0], [b[0], b[1], z0], [b[0], b[1], top], [B[0], B[1], z1]], [aa(d, z0), aa(0, z0), aa(0, top), aa(d, z1)], [(b[0] - a[0]) / L, (b[1] - a[1]) / L, 0], c(SIDE.end))
    }
  }
}

/** Iron railings along the outer edge of a balcony strip, with returns to the wall where it stops. */
export function addBalconyRail(m: MeshData, ctx: Ctx, ring: Pt[], flagged: boolean[], depth: number, z0: number, height: number, style: number) {
  const { start, end } = stripOffsets(ring, flagged)
  const n = ring.length
  const d = depth - 0.05
  const z1 = z0 + height
  let u = 0
  for (let i = 0; i < n; i++) {
    if (!flagged[i]) continue
    const a = ring[i]
    const b = ring[(i + 1) % n]
    const L = Math.hypot(b[0] - a[0], b[1] - a[1])
    const nn = normal(a, b)
    const A: Pt = [a[0] + start[i][0] * d, a[1] + start[i][1] * d]
    const B: Pt = [b[0] + end[i][0] * d, b[1] + end[i][1] * d]
    const LL = Math.hypot(B[0] - A[0], B[1] - A[1])
    const c = [PART.rail, ctx.id, style, 0]
    quad(m, ctx, [[A[0], A[1], z0], [B[0], B[1], z0], [B[0], B[1], z1], [A[0], A[1], z1]], [[u, z0, LL, z0], [u + LL, z0, LL, z0], [u + LL, z1, LL, z0], [u, z1, LL, z0]], [nn[0], nn[1], 0], c)
    const prev = (i + n - 1) % n
    const next = (i + 1) % n
    const t: V3 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, 0]
    if (!flagged[prev]) quad(m, ctx, [[a[0], a[1], z0], [A[0], A[1], z0], [A[0], A[1], z1], [a[0], a[1], z1]], [[0, z0, d, z0], [d, z0, d, z0], [d, z1, d, z0], [0, z1, d, z0]], [-t[0], -t[1], 0], c)
    if (!flagged[next]) quad(m, ctx, [[B[0], B[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], [B[0], B[1], z1]], [[0, z0, d, z0], [d, z0, d, z0], [d, z1, d, z0], [0, z1, d, z0]], t, c)
    u += LL
  }
}

/** A box applied to a wall between u0 and u1 (a shopfront casing): front, top and two sides. */
export function addCasing(m: MeshData, ctx: Ctx, a: Pt, b: Pt, u0: number, u1: number, depth: number, z1: number, info: number, life: Life) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const t: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
  const nn = normal(a, b)
  const at = (u: number, off: number): Pt => [a[0] + t[0] * u + nn[0] * off, a[1] + t[1] * u + nn[1] * off]
  const W = u1 - u0
  const p0 = at(u0, 0)
  const p1 = at(u1, 0)
  const q0 = at(u0, depth)
  const q1 = at(u1, depth)
  const c = (side: number) => [PART.casing, ctx.id, side, info]
  const aa = (x: number, z: number) => [x, z, W, z1]
  quad(m, ctx, [[q0[0], q0[1], 0], [q1[0], q1[1], 0], [q1[0], q1[1], z1], [q0[0], q0[1], z1]], [aa(0, 0), aa(W, 0), aa(W, z1), aa(0, z1)], [nn[0], nn[1], 0], c(SIDE.front), life)
  quad(m, ctx, [[q0[0], q0[1], z1], [q1[0], q1[1], z1], [p1[0], p1[1], z1 + 0.04], [p0[0], p0[1], z1 + 0.04]], [aa(0, z1), aa(W, z1), aa(W, z1), aa(0, z1)], [0, 0, 1], c(SIDE.top), life)
  quad(m, ctx, [[p0[0], p0[1], 0], [q0[0], q0[1], 0], [q0[0], q0[1], z1], [p0[0], p0[1], z1]], [aa(0, 0), aa(depth, 0), aa(depth, z1), aa(0, z1)], [-t[0], -t[1], 0], c(SIDE.end), life)
  quad(m, ctx, [[q1[0], q1[1], 0], [p1[0], p1[1], 0], [p1[0], p1[1], z1], [q1[0], q1[1], z1]], [aa(depth, 0), aa(0, 0), aa(0, z1), aa(depth, z1)], [t[0], t[1], 0], c(SIDE.end), life)
}

/** A canvas awning over a shop: a sloping blind and a valance at its front. */
export function addAwning(m: MeshData, ctx: Ctx, a: Pt, b: Pt, u0: number, u1: number, zTop: number, out: number, drop: number, info: number, life: Life) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const t: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
  const nn = normal(a, b)
  const at = (u: number, off: number): Pt => [a[0] + t[0] * u + nn[0] * off, a[1] + t[1] * u + nn[1] * off]
  const W = u1 - u0
  const p0 = at(u0, 0.02)
  const p1 = at(u1, 0.02)
  const q0 = at(u0, out)
  const q1 = at(u1, out)
  const zf = zTop - drop
  const s = Math.hypot(out, drop)
  const nz = out / s
  const nh = drop / s
  const c = (side: number) => [PART.awning, ctx.id, side, info]
  quad(m, ctx, [[p0[0], p0[1], zTop], [p1[0], p1[1], zTop], [q1[0], q1[1], zf], [q0[0], q0[1], zf]], [[0, 0, W, s], [W, 0, W, s], [W, s, W, s], [0, s, W, s]], [nn[0] * nh, nn[1] * nh, nz], c(SIDE.top), life)
  quad(m, ctx, [[q0[0], q0[1], zf - 0.28], [q1[0], q1[1], zf - 0.28], [q1[0], q1[1], zf], [q0[0], q0[1], zf]], [[0, 0, W, 0.28], [W, 0, W, 0.28], [W, 0.28, W, 0.28], [0, 0.28, W, 0.28]], [nn[0], nn[1], 0], c(SIDE.front), life)
}

/** A projecting sign: a panel square to the wall at u, from z0 to z1, reaching `out` from the wall. */
export function addSign(m: MeshData, ctx: Ctx, a: Pt, b: Pt, u: number, z0: number, z1: number, out: number, kind: number, trade: number, life: Life) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1])
  const t: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]
  const nn = normal(a, b)
  const p: Pt = [a[0] + t[0] * u, a[1] + t[1] * u]
  const q: Pt = [p[0] + nn[0] * out, p[1] + nn[1] * out]
  const H = z1 - z0
  const c = [PART.sign, ctx.id, kind, trade]
  quad(m, ctx, [[p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1]], [[0, 0, out, H], [out, 0, out, H], [out, H, out, H], [0, H, out, H]], [t[0], t[1], 0], c, life)
}

/** What the ground floor of each shop gets: a casing, an awning, projecting signs. */
export function addShopfronts(m: MeshData, ctx: Ctx, a: Pt, b: Pt, style: number, sid: number, wall: number, layout: GroundLayout, ground: number, life: Life) {
  const { bw, bays: n, codes } = layout
  const isShop = (k: number) => k >= 0 && k < n && codes[k % codes.length] !== BAY.plain && codes[k % codes.length] !== BAY.door
  for (const [s, e] of shopRuns(codes, n)) {
    // Neighbouring shops share a front; elsewhere a pier of wall shows between them.
    const u0 = s * bw + (isShop(s - 1) ? 0.01 : 0.18)
    const u1 = (e + 1) * bw - (isShop(e + 1) ? 0.01 : 0.18)
    if (u1 - u0 < 1.2) continue
    const h = (salt: number) => ihash(sid, wall * 32 + s, salt)
    const trade = tradeOf(sid, wall, s)
    const info = trade + 32 * s
    // Casings: wooden fronts applied to old houses from the early 19th century, from the start on later ones.
    const casingTop = style === OLD ? ground - 0.15 : style === HAUSSMANN ? Math.min(ground - 0.4, 3.9) : ground - 0.3
    const casingFrom = style === OLD ? 1790 + Math.floor(h(20) * 50) : life[0]
    const casingLife: Life = [Math.max(life[0], casingFrom), life[1], life[2], life[3]]
    if (casingLife[0] < casingLife[1]) addCasing(m, ctx, a, b, u0, u1, 0.16, casingTop, info, casingLife)
    // Awnings (stores) from about 1850.
    if (h(21) < 0.62) {
      const from = Math.max(life[0], 1850 + Math.floor(h(22) * 25))
      const out = Math.min(1.9, 1.1 + h(23) * 0.8)
      if (from < life[1]) addAwning(m, ctx, a, b, u0 + 0.05, u1 - 0.05, casingTop - 0.62, out, out * 0.45, info, [from, life[1], life[2], life[3]])
    }
    // Projecting signs, square to the wall at the end of the shop.
    const su = h(24) < 0.5 ? u0 + 0.25 : u1 - 0.25
    const name = TRADES[trade].name
    const add = (kind: number, from: number, until: number, z0: number, z1: number, out: number) => {
      const f = Math.max(from, life[0])
      const t = Math.min(until, life[1])
      if (f < t) addSign(m, ctx, a, b, su, z0, z1, out, kind, trade, [f, t, life[2], life[3]])
    }
    const zs = ground + 0.15
    // Small hanging emblems, before 1860: an ordinance of 1761 had banned large signs.
    if (h(25) < 0.55) {
      const until = 1855 + Math.floor(h(26) * 30)
      const kind = name.startsWith('wine') ? SIGN.grapes : name === 'barber' ? SIGN.basin : name === 'tobacco' ? SIGN.carrot : SIGN.board
      add(kind, kind === SIGN.carrot ? 1815 : 0, until, zs, zs + 0.9, 0.85)
    }
    // Flag signs from about 1880, lit signs after 1960.
    const later = name === 'tobacco' ? SIGN.carrot : name === 'pharmacy' ? SIGN.cross : name === 'horse' ? SIGN.horse : name === 'hotel' || name === 'cafe' || h(27) < 0.25 ? SIGN.flag : -1
    if (later >= 0 && h(28) < 0.8) {
      const from = 1880 + Math.floor(h(29) * 25)
      const lit = later === SIGN.carrot ? SIGN.litCarrot : later === SIGN.cross ? SIGN.litCross : -1
      const switchAt = 1958 + Math.floor(h(30) * 20)
      const big = later === SIGN.flag
      add(later, from, lit >= 0 ? switchAt : 1e4, zs - (big ? 0.3 : 0), zs + (big ? 1.1 : 0.9), big ? 1.0 : 0.8)
      if (lit >= 0) add(lit, switchAt, 1e4, zs, zs + 0.9, 0.8)
    }
  }
}

/* ------------------------------------------------------------- roofs */

export interface DormerFrame {
  /** Outer edge of the roof face (on the wall), its direction and the inward normal. */
  a: Pt
  t: Pt
  inward: Pt
  /** Eave height, and the slope: rise over run. */
  eave: number
  rise: number
  run: number
}

/**
 * A dormer on a sloping roof face at u along it: a vertical front with its
 * window, a small pediment, two cheeks and a pitched top, all meeting the
 * roof plane. Needs about 2.6 m of rise above the eave.
 */
export function addDormer(m: MeshData, owner: number, f: DormerFrame, u: number, w: number, front: number, height: number, b: number[], life: Life, id: number) {
  const k = f.rise / f.run
  const P = (x: number, s: number, z: number): V3 => [f.a[0] + f.t[0] * (u + x) + f.inward[0] * s, f.a[1] + f.t[1] * (u + x) + f.inward[1] * s, z]
  const zs = (s: number) => f.eave + k * s
  const sOn = (z: number) => (z - f.eave) / k
  const zb = zs(front)
  const zt = zb + height
  const peak = zt + w * 0.32
  const se = sOn(zt)
  const sr = sOn(peak)
  const hw = w / 2
  const out: V3 = [-f.inward[0], -f.inward[1], 0]
  const ctx: Ctx = { owner, b, life, id }
  const c = (part: number) => [part, id, 0, 0]
  // a_a: across the front (from -w/2), up from its bottom, width, front height.
  const aa = (x: number, y: number) => [x, y, w, height]
  quad(m, ctx, [P(-hw, front, zb), P(hw, front, zb), P(hw, front, zt), P(-hw, front, zt)], [aa(-hw, 0), aa(hw, 0), aa(hw, height), aa(-hw, height)], out, c(0))
  tri(m, ctx, [P(-hw, front, zt), P(hw, front, zt), P(0, front, peak)], [aa(-hw, height), aa(hw, height), aa(0, peak - zb)], out, c(1))
  // Cheeks: vertical, square to the front, down to the roof plane.
  const tside: V3 = [f.t[0], f.t[1], 0]
  tri(m, ctx, [P(-hw, front, zb), P(-hw, front, zt), P(-hw, se, zt)], [aa(0, 0), aa(0, height), aa(se - front, height)], [-tside[0], -tside[1], 0], c(2))
  tri(m, ctx, [P(hw, front, zb), P(hw, se, zt), P(hw, front, zt)], [aa(0, 0), aa(se - front, height), aa(0, height)], tside, c(2))
  // The top: two slopes from the front back into the roof.
  const o = front - 0.08
  const slopeN = (side: number): V3 => {
    const l = Math.hypot(peak - zt, hw)
    return [tside[0] * side * ((peak - zt) / l), tside[1] * side * ((peak - zt) / l), hw / l]
  }
  quad(m, ctx, [P(-hw - 0.06, o, zt - 0.03), P(-hw - 0.06, se, zt - 0.03), P(0, sr, peak), P(0, o, peak)], [aa(0, 0), aa(se - o, 0), aa(sr - o, 1), aa(0, 1)], slopeN(-1), c(3))
  quad(m, ctx, [P(hw + 0.06, o, zt - 0.03), P(0, o, peak), P(0, sr, peak), P(hw + 0.06, se, zt - 0.03)], [aa(0, 0), aa(0, 1), aa(sr - o, 1), aa(se - o, 0)], slopeN(1), c(3))
}

/** Chimney pots on a stack top: a row of `count` terracotta pots, carved by the shader. */
export function addPots(m: MeshData, owner: number, c: Pt, along: Pt, w: number, z: number, count: number, b: number[], life: Life) {
  const [ax, ay] = along
  const bx = -ay
  const by = ax
  const depth = 0.32
  const half = w / 2 - 0.08
  const corner = (s: number, t: number): Pt => [c[0] + ax * s * half + bx * t * (depth / 2), c[1] + ay * s * half + by * t * (depth / 2)]
  const ring = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
  const h = 0.55
  const ctx: Ctx = { owner, b, life, id: 0 }
  for (let i = 0; i < 4; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % 4]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    const n: V3 = [(q[1] - p[1]) / L, -(q[0] - p[0]) / L, 0]
    const pots = i % 2 === 0 ? count : 1
    quad(m, ctx, [[p[0], p[1], z], [q[0], q[1], z], [q[0], q[1], z + h], [p[0], p[1], z + h]], [[0, 0, L, h], [L, 0, L, h], [L, h, L, h], [0, h, L, h]], n, [pots, 0, 0, 0])
  }
}


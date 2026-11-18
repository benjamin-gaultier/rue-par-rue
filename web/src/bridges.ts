/**
 * Bridges through time: the geometry of each structure that crossed the
 * Seine at a deck, drawn only in the years it stood.
 *
 * The site file (python -m rpr site) gives every crossing a deck polygon
 * (today's, from IGN BD TOPO) and a dated history: kind of structure, number
 * of arches, width where it differed, and the houses it carried. Each
 * generation becomes its own side walls, deck, piers and vaults with that
 * generation's years in `a_life`, so the year slider swaps them on the GPU.
 * The wall shader's bridge branch (bridgeshaders.ts) draws the arches,
 * ironwork, cables and parapets of each kind; the arch layout below and
 * there must agree.
 *
 * Today's decks stand in for the older bridges' plans: same line, same
 * length; the width changes only where the history gives one. Houses on the
 * bridges are generated as rows of narrow lots on each side of the roadway.
 *
 * Pure geometry, no WebGL.
 */

import { MeshData, orientedBox, STYLE, type Poly, type Pt } from './citygen'

/** One structure in a crossing's history (see BRIDGES in pipeline/rpr/sources/site.py). */
export interface BridgeGeneration {
  /** First year standing; null: before the slider starts. */
  from: number | null
  /** First year gone; null: still standing. */
  until: number | null
  kind: string
  arches: number
  /** Metres between the parapets, where it differed from today's deck. */
  width?: number
  /** Houses lined the roadway until this year. */
  houses_until?: number
  /** How many houses, both sides together (spaced evenly). */
  houses?: number
  /** Their height, when they were built alike. */
  house_height?: number
  note?: string
}

export interface BridgeProps {
  kind: 'bridge'
  name: string
  span?: number
  width?: number
  history?: BridgeGeneration[]
  sources?: string
}

/** Kinds of structure, as the shader reads them (b.y of bridge walls). */
export const BRIDGE_KIND: Record<string, number> = {
  'stone-old': 0,
  stone: 1,
  iron: 2,
  suspension: 3,
  timber: 4,
  'iron-centre': 5,
  truss: 6,
  steel: 7,
  'wide-centre': 8
}

/** What each part of a bridge is, as the shader reads it (a.w). */
export const PART = { wall: 2, deck: 3, pier: 4, vault: 5, under: 6 } as const

/** The water level the arch shapes are laid out against (the river sits near -6.6 m). */
export const BRIDGE_WATER = -6.6
/** Metres of deck on each bank (the site step cuts decks to the water plus 4 m). */
export const LAND_END = 4
const OPEN = 1e4

export function bridgeLife(g: Pick<BridgeGeneration, 'from' | 'until'>): [number, number, number, number] {
  return [g.from ?? -OPEN, g.until ?? OPEN, 0, 0]
}

/** True if the generation stands in `year`. */
export function standsIn(g: Pick<BridgeGeneration, 'from' | 'until'>, year: number): boolean {
  return year >= (g.from ?? -OPEN) && year < (g.until ?? OPEN)
}

const MASONRY = new Set([0, 1, 5, 8])

/** Pier width for a kind of bridge, from the average spacing of its arches. Mirrored in bridgeshaders.ts. */
export function pierWidth(kind: number, spacing: number): number {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  if (kind === 0) return clamp(spacing * 0.28, 2.5, 6.0)
  if (kind === 1) return clamp(spacing * 0.12, 1.6, 4.0)
  if (kind === 4) return clamp(spacing * 0.06, 0.8, 2.0)
  if (kind === 3) return 3.0
  if (kind === 5) return clamp(spacing * 0.1, 3.0, 5.0)
  if (kind === 8) return clamp(spacing * 0.06, 2.5, 4.0)
  return clamp(spacing * 0.1, 2.0, 4.0)
}

/** Share of the openings' total width taken by the middle arch, for bridges built around one wide arch. */
export function centreShare(kind: number): number {
  return kind === 5 ? 0.62 : kind === 8 ? 0.76 : 0
}

export interface Opening {
  /** Start and end along the side wall, metres. */
  u0: number
  u1: number
  /** An iron arch (the rest are masonry). */
  iron: boolean
}

/** The arches along a side wall of length L. Mirrored in bridgeshaders.ts (bridgeOpening). */
export function openings(kind: number, n: number, L: number, landEnd = LAND_END): Opening[] {
  const S = L - 2 * landEnd
  if (S <= 0 || n < 1) return []
  const pier = n > 1 ? pierWidth(kind, S / n) : 0
  const share = centreShare(kind)
  if (share > 0 && n === 3) {
    const centre = share * (S - 2 * pier)
    const side = (S - 2 * pier - centre) / 2
    return [
      { u0: landEnd, u1: landEnd + side, iron: false },
      { u0: landEnd + side + pier, u1: landEnd + side + pier + centre, iron: kind === 5 },
      { u0: L - landEnd - side, u1: L - landEnd, iron: false }
    ]
  }
  const bay = (S - (n - 1) * pier) / n
  const iron = kind === 2
  return Array.from({ length: n }, (_, i) => ({ u0: landEnd + i * (bay + pier), u1: landEnd + i * (bay + pier) + bay, iron }))
}

/** Crown (top of the opening, below the road) and rise of an arch of width `bay`. Mirrored in bridgeshaders.ts. */
export function archOf(kind: number, bay: number, iron: boolean): { crown: number; rise: number; spring: number } {
  const crown = iron ? -1.1 : kind === 0 ? -1.7 : kind === 4 ? -1.1 : kind === 8 ? -1.2 : -1.3
  const k = iron ? 0.3 : kind === 0 ? 1.0 : kind === 4 ? 0.35 : kind === 8 ? 0.3 : 0.5
  const rise = Math.max(0.5, Math.min(bay * 0.5 * k, crown - (BRIDGE_WATER + 0.5)))
  return { crown, rise, spring: crown - rise }
}

/** Bottom and top of a kind's side walls, for a river at `waterZ`. */
export function wallRange(kind: number, waterZ: number): [number, number] {
  if (kind === 3) return [-0.7, 8.0]
  if (kind === 6) return [-1.0, 3.4]
  return [waterZ, kind === 4 ? 1.1 : 1.0]
}

/** A deck's axis frame: centre, unit direction along the bridge, across, half length and half width. */
export function deckFrame(deck: Poly) {
  const box = orientedBox(deck[0])
  const across: Pt = [-box.dir[1], box.dir[0]]
  return { ...box, across }
}

type Frame = ReturnType<typeof deckFrame>

/** A point at `s` metres along the bridge from its middle and `t` metres across. */
function at(f: Frame, s: number, t: number): Pt {
  return [f.c[0] + f.dir[0] * s + f.across[0] * t, f.c[1] + f.dir[1] * s + f.across[1] * t]
}

/** A rectangle along the deck: s0..s1 along, t0..t1 across (counter-clockwise). */
export function deckRect(f: Frame, s0: number, s1: number, t0: number, t1: number): Poly {
  return [[at(f, s0, t0), at(f, s1, t0), at(f, s1, t1), at(f, s0, t1)]]
}

/** Width of a generation on a deck: its own, never wider than the deck. */
export function widthOf(g: BridgeGeneration, f: Frame): number {
  return Math.min(g.width ?? 2 * f.halfWid, 2 * f.halfWid)
}

function quad(m: MeshData, p: [number, number, number][], n: [number, number, number], a: number[][], b: number[], life: number[]) {
  for (const k of [0, 1, 2, 0, 2, 3]) m.vertex(p[k], n, a[k], b, life)
  m.owner.push(-1, -1)
}

/** An upright box (pier, pylon) in plan corners `ring` (counter-clockwise), from z0 to z1. */
function box(m: MeshData, ring: Pt[], z0: number, z1: number, b: number[], life: number[]) {
  let u = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    const L = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (L < 1e-3) continue
    const n: [number, number, number] = [(q[1] - p[1]) / L, -(q[0] - p[0]) / L, 0]
    quad(
      m,
      [
        [p[0], p[1], z0],
        [q[0], q[1], z0],
        [q[0], q[1], z1],
        [p[0], p[1], z1]
      ],
      n,
      [
        [u, z0, L, PART.pier],
        [u + L, z0, L, PART.pier],
        [u + L, z1, L, PART.pier],
        [u, z1, L, PART.pier]
      ],
      b,
      life
    )
    u += L
  }
  // A flat top (fan from the first corner).
  for (let i = 1; i + 1 < ring.length; i++) {
    for (const p of [ring[0], ring[i], ring[i + 1]]) m.vertex([p[0], p[1], z1], [0, 0, 1], [0, z1, 0, PART.pier], b, life)
    m.owner.push(-1)
  }
}

/**
 * Every generation of one crossing into the wall mesh: side walls, deck,
 * piers with cutwaters, vaults under masonry arches, pylons of suspension
 * bridges, the underside of open decks. Returns the number of generations drawn.
 */
export function addBridgeHistory(walls: MeshData, deck: Poly, waterZ: number, history: BridgeGeneration[] | undefined, landEnd = LAND_END): number {
  const f = deckFrame(deck)
  const L = 2 * f.halfLen
  if (L < 2 * landEnd + 2) return 0
  const gens = history?.length ? history : [{ from: null, until: null, kind: 'stone', arches: Math.max(1, Math.round((L - 2 * landEnd) / 30)) }]
  for (const g of gens) {
    const kind = BRIDGE_KIND[g.kind] ?? 1
    const n = Math.max(1, Math.round(g.arches))
    const life = bridgeLife(g)
    const w = widthOf(g, f)
    const h = w / 2
    const b = [STYLE.bridge, kind, n, landEnd]
    const [z0, z1] = wallRange(kind, waterZ)

    // Deck: a = (along, z, across, part), b = (style, kind, width, length).
    const deckZ = 0.06
    const bd = [STYLE.bridge, kind, w, L]
    quad(
      walls,
      [
        [...at(f, -f.halfLen, -h), deckZ],
        [...at(f, f.halfLen, -h), deckZ],
        [...at(f, f.halfLen, h), deckZ],
        [...at(f, -f.halfLen, h), deckZ]
      ] as [number, number, number][],
      [0, 0, 1],
      [
        [0, deckZ, -h, PART.deck],
        [L, deckZ, -h, PART.deck],
        [L, deckZ, h, PART.deck],
        [0, deckZ, h, PART.deck]
      ],
      bd,
      life
    )
    if (!MASONRY.has(kind)) {
      const zu = kind === 3 ? -0.7 : kind === 6 ? -1.0 : kind === 4 ? -1.1 : -0.9
      quad(
        walls,
        [
          [...at(f, -f.halfLen + landEnd, -h), zu],
          [...at(f, -f.halfLen + landEnd, h), zu],
          [...at(f, f.halfLen - landEnd, h), zu],
          [...at(f, f.halfLen - landEnd, -h), zu]
        ] as [number, number, number][],
        [0, 0, -1],
        [
          [landEnd, zu, -h, PART.under],
          [landEnd, zu, h, PART.under],
          [L - landEnd, zu, h, PART.under],
          [L - landEnd, zu, -h, PART.under]
        ],
        bd,
        life
      )
    }

    // Side walls, each facing out; u runs from the same end on both so arches line up.
    const houses = g.houses_until !== undefined && g.houses_until !== null
    const parapetLife = houses ? [Math.max(g.houses_until!, life[0]), life[1], 0, 0] : life
    for (const side of [1, -1]) {
      const n3: [number, number, number] = [f.across[0] * side, f.across[1] * side, 0]
      const a0 = at(f, -f.halfLen, h * side)
      const a1 = at(f, f.halfLen, h * side)
      const bands: [number, number, number[]][] = houses && z1 > 0 && z0 < 0 ? [[z0, 0, life], [0, z1, parapetLife]] : [[z0, z1, life]]
      for (const [lo, hi, lf] of bands) {
        quad(
          walls,
          [
            [a0[0], a0[1], lo],
            [a1[0], a1[1], lo],
            [a1[0], a1[1], hi],
            [a0[0], a0[1], hi]
          ],
          n3,
          [
            [0, lo, L, PART.wall],
            [L, lo, L, PART.wall],
            [L, hi, L, PART.wall],
            [0, hi, L, PART.wall]
          ],
          b,
          lf
        )
      }
    }

    const ops = openings(kind, n, L, landEnd)
    const s = (u: number) => u - f.halfLen // along-axis coordinate of a wall position

    // Piers with pointed cutwaters on both faces, between masonry or iron arches.
    if (kind !== 3 && kind !== 6 && kind !== 7 && kind !== 4) {
      for (let i = 0; i + 1 < ops.length; i++) {
        const u0 = ops[i].u1
        const u1 = ops[i + 1].u0
        const mid = (u0 + u1) / 2
        const half = (u1 - u0) / 2
        const out = kind === 0 ? Math.max(1.6, half * 1.1) : Math.max(1.0, half * 0.8)
        const top = kind === 0 ? -0.9 : archOf(kind, ops[i].u1 - ops[i].u0, ops[i].iron).spring + 0.6
        for (const side of [1, -1]) {
          const a = at(f, s(mid - half), h * side)
          const tip = at(f, s(mid), (h + out) * side)
          const c = at(f, s(mid + half), h * side)
          // Counter-clockwise in plan, so the box faces point out.
          box(walls, side > 0 ? [a, c, tip] : [a, tip, c], waterZ, Math.min(top, z1 - 0.2), b, life)
        }
      }
    }

    // Vaults: the underside of each masonry arch, wall to wall, and the pier faces below the springing.
    if (MASONRY.has(kind)) {
      for (const o of ops) {
        if (o.iron) continue
        const bay = o.u1 - o.u0
        const hw = bay / 2
        const mid = (o.u0 + o.u1) / 2
        const { rise, spring } = archOf(kind, bay, false)
        const profile: [number, number][] = [[-hw, waterZ]]
        const K = Math.max(6, Math.min(14, Math.round(bay / 2)))
        for (let k = 0; k <= K; k++) {
          const th = Math.PI - (k / K) * Math.PI
          profile.push([Math.cos(th) * hw, spring + Math.sin(th) * rise])
        }
        profile.push([hw, waterZ])
        let arc = 0
        for (let k = 0; k + 1 < profile.length; k++) {
          const [du0, zA] = profile[k]
          const [du1, zB] = profile[k + 1]
          const len = Math.hypot(du1 - du0, zB - zA)
          if (len < 1e-3) continue
          // Normal toward the inside of the opening (down and in under the arch).
          const nu = (zB - zA) / len
          const nz = -(du1 - du0) / len
          const n3: [number, number, number] = [f.dir[0] * nu, f.dir[1] * nu, nz]
          const p0 = at(f, s(mid + du0), -h)
          const p1 = at(f, s(mid + du1), -h)
          const p2 = at(f, s(mid + du1), h)
          const p3 = at(f, s(mid + du0), h)
          quad(
            walls,
            [
              [p0[0], p0[1], zA],
              [p1[0], p1[1], zB],
              [p2[0], p2[1], zB],
              [p3[0], p3[1], zA]
            ],
            n3,
            [
              [arc, zA, -h, PART.vault],
              [arc + len, zB, -h, PART.vault],
              [arc + len, zB, h, PART.vault],
              [arc, zA, h, PART.vault]
            ],
            b,
            life
          )
          arc += len
        }
      }
    }

    // Suspension bridges: masonry pylons at each end and on the middle piers, a pier under each middle pylon.
    if (kind === 3) {
      const S = L - 2 * landEnd
      for (let i = 0; i <= n; i++) {
        const u = landEnd + (i * S) / n
        const inner = i > 0 && i < n
        for (const side of [1, -1]) {
          const t0 = side * h
          const t1 = side * (h + 1.3)
          const ring = [at(f, s(u - 0.7), t0), at(f, s(u + 0.7), t0), at(f, s(u + 0.7), t1), at(f, s(u - 0.7), t1)]
          box(walls, side > 0 ? ring : ring.reverse(), inner ? waterZ : 0, 8.6, b, life)
        }
        if (inner) box(walls, deckRect(f, s(u - 1.6), s(u + 1.6), -h - 1.3, h + 1.3)[0], waterZ, -0.7, b, life)
      }
    }
  }
  return gens.length
}

/** A house standing on a bridge. */
export interface BridgeHouse {
  poly: Poly
  height: number
  /** 0..1, stable per house. */
  seed: number
  /** Years it stands: [from, until, 0, 0]. */
  life: [number, number, number, number]
}

function hash01(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10007) / 10007
}

/** Narrowest house front drawn: each gable front is split at its ridge, and the facade shader needs 1.6 m per half for a window. */
export const MIN_HOUSE_FRONT = 3.4

/**
 * The rows of narrow houses on both sides of a bridge's roadway, while the
 * generation carried them. Each lot runs from the parapet line 6.5 m in at
 * most, leaving at least 6 m of street; lots are spaced evenly, by the
 * number of houses when the history gives it, else about 4.2 m apart, and
 * never narrower than MIN_HOUSE_FRONT (today's decks are shorter than the
 * old bridges, so fewer houses may fit than stood).
 */
export function bridgeHouses(deck: Poly, g: BridgeGeneration, key: string, margin = 2): BridgeHouse[] {
  if (g.houses_until === undefined || g.houses_until === null) return []
  const f = deckFrame(deck)
  const w = widthOf(g, f)
  const depth = Math.min(6.5, (w - 6) / 2)
  if (depth < 3) return []
  const usable = 2 * f.halfLen - 2 * margin
  const perSide = Math.max(1, Math.min(g.houses ? Math.round(g.houses / 2) : Math.round(usable / 4.2), Math.floor(usable / MIN_HOUSE_FRONT)))
  const front = usable / perSide
  if (front < 2) return []
  const life: [number, number, number, number] = [g.from ?? -OPEN, g.houses_until, 0, 0]
  const out: BridgeHouse[] = []
  for (const side of [1, -1]) {
    for (let i = 0; i < perSide; i++) {
      const s0 = -f.halfLen + margin + i * front
      const s1 = s0 + front
      const t0 = side * (w / 2 - depth)
      const t1 = side * (w / 2)
      const poly = side > 0 ? deckRect(f, s0, s1, t0, t1) : deckRect(f, s0, s1, t1, t0)
      const seed = hash01(`${key}:${side}:${i}`)
      const height = g.house_height ?? Math.round((12 + seed * 5) * 10) / 10
      out.push({ poly, height, seed, life })
    }
  }
  return out
}

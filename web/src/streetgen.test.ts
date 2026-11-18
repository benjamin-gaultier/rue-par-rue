import { describe, expect, it } from 'vitest'
import type { Pt } from './citygen'
import {
  addCrossing,
  addPavement,
  addStrip,
  avoid,
  Buildings,
  decode,
  GUTTER_WIDTH,
  inBox,
  KERB_HEIGHT,
  kerbInset,
  lifeFrom,
  need,
  OPEN,
  PART,
  pavementLife,
  spansOf,
  StreetMesh,
  touchesBox,
  triangulate
} from './streetgen'
import { buildStreets, modelGeometry, VARIANT } from './streets'

const square = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
]

/** Values of attribute `d` (4 per vertex) at component k. */
const comp = (m: StreetMesh, k: number) => m.d.filter((_, i) => i % 4 === k)

describe('decoding', () => {
  it('reads delta-encoded integer coordinates', () => {
    const out = decode([10, 20, 5, -5, 0, 10], [2, 48], 10)
    expect(out).toEqual([
      [3, 50],
      [3.5, 49.5],
      [3.5, 50.5]
    ])
  })
})

describe('lives', () => {
  it('splits a life with a gap into spans', () => {
    expect(spansOf([1800, 1900, 0, 0])).toEqual([[1800, 1900]])
    expect(spansOf([1800, 1900, 1850, 1860])).toEqual([
      [1800, 1850],
      [1860, 1900]
    ])
  })

  it('makes one span or a gap, and keeps the longest span beyond that', () => {
    expect(lifeFrom([])).toBeNull()
    expect(lifeFrom([[1800, 1850]])).toEqual([1800, 1850, 0, 0])
    expect(
      lifeFrom([
        [1800, 1850],
        [1870, 1900]
      ])
    ).toEqual([1800, 1900, 1850, 1870])
    expect(
      lifeFrom([
        [1800, 1810],
        [1820, 1900],
        [1950, 1960]
      ])
    ).toEqual([1820, 1900, 0, 0])
  })

  it('avoids the years a building stands', () => {
    // A lamp on a street where a house stood until 1860.
    expect(avoid([1780, OPEN], [[-OPEN, 1860]])).toEqual([1860, OPEN, 0, 0])
    // A building put up in 1900 and gone in 1950 cuts a gap.
    expect(avoid([1860, OPEN], [[1900, 1950]])).toEqual([1860, OPEN, 1900, 1950])
    // Standing all along: never shown.
    expect(avoid([1860, OPEN], [[-OPEN, OPEN]])).toBeNull()
  })

  it('needs a wall to hang on', () => {
    expect(need([1847, OPEN], [])).toBeNull()
    expect(need([1729, 1860], [[-OPEN, 1860]])).toEqual([1729, 1860, 0, 0])
    expect(need([1860, OPEN], [[1880, OPEN]])).toEqual([1880, OPEN, 0, 0])
  })
})

describe('buildings', () => {
  const b = new Buildings()
  b.add([[square(0, 0, 10, 10)]], [-OPEN, 1860, 0, 0])
  b.add([[square(5, 0, 15, 10)]], [1900, OPEN, 0, 0])

  it('tells which years a point is covered', () => {
    expect(b.at([2, 2])).toEqual([[-OPEN, 1860]])
    expect(b.at([7, 2])).toEqual([
      [-OPEN, 1860],
      [1900, OPEN]
    ])
    expect(b.at([30, 2])).toEqual([])
  })

  it('hides a pavement only when a building covers a good part of it', () => {
    const tris = triangulate([square(9.8, 0, 30, 10)]) // 2 cm under the first house
    expect(pavementLife([1860, OPEN], tris, b)).toEqual([1860, OPEN, 0, 0])
    const under = triangulate([square(6, 0, 14, 10)]) // under the 1900 building
    expect(pavementLife([1860, OPEN], under, b)).toEqual([1860, 1900, 0, 0])
  })
})

describe('pavements', () => {
  it('mitres the kerb inset where two kerb edges meet', () => {
    const ring = square(0, 0, 10, 10)
    const inset = kerbInset(ring, '1111', 0.5)
    // Edge 0 runs along y = 0; its start, at the corner (0, 0), is offset diagonally inward.
    expect(inset[0].from[0]).toBeCloseTo(0.5)
    expect(inset[0].from[1]).toBeCloseTo(0.5)
    // Without a kerb on the previous edge, the offset is square to the edge.
    const square0 = kerbInset(ring, '1110', 0.5)
    expect(square0[0].from[0]).toBeCloseTo(0)
    expect(square0[0].from[1]).toBeCloseTo(0.5)
  })

  it('raises the top, faces every edge, and puts kerbs and gutters on kerb edges only', () => {
    const pav = new StreetMesh()
    const dec = new StreetMesh()
    addPavement(pav, dec, [square(0, 0, 10, 3)], ['1010'], PART.asphaltPavement, [1860, OPEN, 0, 0])
    const parts = comp(pav, 0)
    expect(parts.filter((p) => p === PART.asphaltPavement)).toHaveLength(6) // two triangles
    expect(parts.filter((p) => p === PART.kerbFace)).toHaveLength(12) // two kerb edges, two triangles each
    expect(parts.filter((p) => p === PART.sideFace)).toHaveLength(12)
    expect(parts.filter((p) => p === PART.kerbTop)).toHaveLength(12)
    expect(Math.max(...pav.position.filter((_, i) => i % 3 === 2))).toBeCloseTo(KERB_HEIGHT + 0.004)
    // Gutters lie outside the pavement, on the road.
    expect(dec.vertices).toBe(12)
    const ys = dec.position.filter((_, i) => i % 3 === 1)
    expect(Math.min(...ys)).toBeCloseTo(-GUTTER_WIDTH)
    expect(Math.max(...ys)).toBeCloseTo(3 + GUTTER_WIDTH)
  })
})

describe('decals', () => {
  it('gives each strip segment its own life and skips the hidden ones', () => {
    const m = new StreetMesh()
    const line: Pt[] = [
      [0, 0],
      [10, 0],
      [20, 0]
    ]
    addStrip(m, line, 0.5, 0.01, PART.centreGutter, (mid) => (mid[0] < 10 ? [1780, 1860, 0, 0] : null))
    expect(m.vertices).toBe(6)
    expect(Math.max(...comp(m, 1))).toBeCloseTo(10) // u runs along the line
  })

  it('measures crossings along and across the road', () => {
    const m = new StreetMesh()
    addCrossing(m, square(0, 0, 4, 12), 90, [1930, OPEN, 0, 0]) // the road runs north
    expect(Math.max(...comp(m, 1))).toBeCloseTo(12) // along the road
    expect(Math.max(...comp(m, 2))).toBeCloseTo(4) // across it
    expect(comp(m, 3)[0]).toBeCloseTo(12) // the crossing's width along the road
  })

  it('knows what lies near the box', () => {
    const box: [number, number, number, number] = [0, 0, 100, 100]
    expect(inBox([120, 50], box)).toBe(false)
    expect(inBox([120, 50], box, 30)).toBe(true)
    expect(touchesBox(square(-50, -50, -10, 10), box)).toBe(false)
    expect(touchesBox(square(-50, -50, 10, 10), box)).toBe(true)
  })
})

describe('street furniture', () => {
  it('tags every vertex of a model with its variant', () => {
    const g = modelGeometry([VARIANT.ropeLantern, VARIANT.bracketLantern])
    const parts = Array.from(g.getAttribute('a_part').array as Float32Array)
    const variants = new Set(parts.map((p) => Math.floor(p / 16)))
    expect(variants).toEqual(new Set([VARIANT.ropeLantern, VARIANT.bracketLantern]))
  })

  it('trims items against buildings and hangs plaques only on standing walls', () => {
    const b = new Buildings()
    b.add([[square(0, 0, 10, 10)]], [-OPEN, 1860, 0, 0])
    const data = {
      metadata: { origin: [0, 0] as [number, number], scale: 1 },
      pavements: { rows: [] },
      gutters: { rows: [] },
      main_roads: { rows: [] },
      crossings: { rows: [] },
      centre_lines: { rows: [] },
      items: {
        rows: [
          // A Morris column inside the old house, and one in the street.
          [8, 1868, OPEN, [5, 5, 15, 0], [], []],
          // A plaque on the house's east wall, facing east (0°), and one on thin air.
          [7, 1729, 1860, [10, 5, 10, 20], [0, 0], []]
        ] as [number, number, number, number[], number[], number[]][]
      }
    }
    const built = buildStreets(data, (p) => [p[0], p[1]], b, [0, 0, 100, 100])
    const all = built.furniture.flatMap((f) => f.type.map((t, i) => ({ t, life: f.life.slice(i * 4, i * 4 + 4), x: f.inst[i * 4] })))
    const columns = all.filter((a) => a.t === 8)
    expect(columns).toHaveLength(2) // the one in the house shows after 1860
    expect(columns.every((c) => c.life[0] >= 1860)).toBe(true)
    const plaques = all.filter((a) => a.t === 7)
    expect(plaques).toHaveLength(1)
    expect(plaques[0].life.slice(0, 2)).toEqual([1729, 1860])
  })
})

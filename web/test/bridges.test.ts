import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  addBridgeHistory,
  archOf,
  BRIDGE_KIND,
  BRIDGE_WATER,
  bridgeHouses,
  bridgeLife,
  deckFrame,
  LAND_END,
  MIN_HOUSE_FRONT,
  openings,
  PART,
  standsIn,
  type BridgeGeneration
} from '../src/bridges'
import { insidePoly, MeshData, STYLE, type Poly } from '../src/citygen'
import { crossingsOf, housesOf, insideWalkBounds, onStandingBridge } from '../src/island'
import { packMesh } from '../src/meshpack'
import { partitionTrees } from '../src/city3d'

/** A deck 100 m long (x) and 20 m wide, centred on the origin. */
const DECK: Poly = [
  [
    [-50, -10],
    [50, -10],
    [50, 10],
    [-50, 10]
  ]
]

const gen = (over: Partial<BridgeGeneration>): BridgeGeneration => ({ from: null, until: null, kind: 'stone', arches: 3, ...over })

/** Life of every vertex of a mesh, as [from, until] pairs. */
const lives = (m: MeshData) => {
  const out = new Set<string>()
  for (let i = 0; i < m.life.length; i += 4) out.add(`${m.life[i]}:${m.life[i + 1]}`)
  return out
}

describe('arch layout', () => {
  it('spaces equal arches between piers inside the span', () => {
    const ops = openings(BRIDGE_KIND.stone, 3, 100)
    expect(ops).toHaveLength(3)
    expect(ops[0].u0).toBeCloseTo(LAND_END)
    expect(ops[2].u1).toBeCloseTo(100 - LAND_END)
    const widths = ops.map((o) => o.u1 - o.u0)
    expect(widths[0]).toBeCloseTo(widths[2])
    expect(ops[1].u0).toBeGreaterThan(ops[0].u1) // a pier between
  })

  it('gives old bridges thicker piers than 19th-century ones', () => {
    const pier = (kind: number) => {
      const o = openings(kind, 5, 120)
      return o[1].u0 - o[0].u1
    }
    expect(pier(BRIDGE_KIND['stone-old'])).toBeGreaterThan(pier(BRIDGE_KIND.stone) * 1.5)
  })

  it('builds a wide iron centre between two stone arches', () => {
    const ops = openings(BRIDGE_KIND['iron-centre'], 3, 105)
    expect(ops.map((o) => o.iron)).toEqual([false, true, false])
    expect(ops[1].u1 - ops[1].u0).toBeGreaterThan(2.5 * (ops[0].u1 - ops[0].u0))
  })

  it('keeps every arch above the water, flattening wide ones', () => {
    for (const kind of Object.values(BRIDGE_KIND))
      for (const bay of [6, 15, 31, 80]) {
        const a = archOf(kind, bay, kind === BRIDGE_KIND.iron)
        expect(a.spring).toBeGreaterThanOrEqual(BRIDGE_WATER + 0.49)
        expect(a.crown).toBeLessThan(0)
      }
    expect(archOf(BRIDGE_KIND['stone-old'], 8, false).rise).toBeCloseTo(4) // a round arch
    expect(archOf(BRIDGE_KIND.stone, 31, false).rise).toBeLessThan(15.5 * 0.5 + 1e-9)
  })
})

describe('bridges through time', () => {
  it('stands only in its years', () => {
    expect(bridgeLife({ from: null, until: 1858 })).toEqual([-1e4, 1858, 0, 0])
    expect(standsIn({ from: 1828, until: 1854 }, 1828)).toBe(true)
    expect(standsIn({ from: 1828, until: 1854 }, 1854)).toBe(false)
    expect(standsIn({ from: 1970, until: null }, 2026)).toBe(true)
  })

  it('draws each generation with its own years', () => {
    const walls = new MeshData()
    const n = addBridgeHistory(walls, DECK, -6.9, [gen({ until: 1853, kind: 'stone-old', arches: 6 }), gen({ from: 1853, until: 1919, arches: 5 }), gen({ from: 1919, kind: 'iron-centre' })])
    expect(n).toBe(3)
    expect(lives(walls)).toEqual(new Set(['-10000:1853', '1853:1919', '1919:10000']))
    expect(walls.owner.every((o) => o === -1)).toBe(true)
    for (let i = 0; i < walls.b.length; i += 4) expect(walls.b[i]).toBe(STYLE.bridge)
  })

  it('narrows a footbridge to its own width', () => {
    const walls = new MeshData()
    addBridgeHistory(walls, DECK, -6.9, [gen({ kind: 'suspension', arches: 2, width: 3.5 })])
    let maxAcross = 0
    for (let i = 0; i < walls.a.length; i += 4) if (walls.a[i + 3] === PART.deck) maxAcross = Math.max(maxAcross, Math.abs(walls.a[i + 2]))
    expect(maxAcross).toBeCloseTo(1.75)
    // Three pylon pairs and a pier: pier parts reach 8.6 m.
    const zs = walls.position.filter((_, i) => i % 3 === 2)
    expect(Math.max(...zs)).toBeCloseTo(8.6)
  })

  it('leaves out the parapet while houses stand on the bridge', () => {
    const walls = new MeshData()
    addBridgeHistory(walls, DECK, -6.9, [gen({ until: 1858, kind: 'stone-old', arches: 7, houses_until: 1788 })])
    expect(lives(walls).has('1788:1858')).toBe(true)
  })

  it('puts vaults under masonry arches only', () => {
    const count = (kind: string) => {
      const m = new MeshData()
      addBridgeHistory(m, DECK, -6.9, [gen({ kind, arches: 3 })])
      return m.a.filter((v, i) => i % 4 === 3 && v === PART.vault).length
    }
    expect(count('stone')).toBeGreaterThan(0)
    expect(count('iron')).toBe(0)
    expect(count('steel')).toBe(0)
  })
})

describe('houses on bridges', () => {
  it('lines both sides of the roadway until the houses were cleared', () => {
    const g = gen({ until: 1853, kind: 'stone-old', arches: 6, houses_until: 1787, houses: 24 })
    const houses = bridgeHouses(DECK, g, 'test')
    expect(houses).toHaveLength(24)
    expect(houses.every((h) => h.life[1] === 1787)).toBe(true)
    const f = deckFrame(DECK)
    for (const h of houses) for (const p of h.poly[0]) expect(insidePoly([p[0] * 0.999, p[1] * 0.999], DECK)).toBe(true)
    // The street between the rows stays open.
    expect(houses.some((h) => insidePoly([0, 0], h.poly))).toBe(false)
    expect(f.halfLen).toBeCloseTo(50)
  })

  it('fits fewer houses than stood when the deck is too short for them', () => {
    const houses = bridgeHouses(DECK, gen({ until: 1853, houses_until: 1787, houses: 68 }), 'test')
    expect(houses.length).toBe(2 * Math.floor(96 / MIN_HOUSE_FRONT))
  })

  it('has none without houses or on a footbridge', () => {
    expect(bridgeHouses(DECK, gen({}), 'x')).toEqual([])
    expect(bridgeHouses(DECK, gen({ houses_until: 1800, width: 8 }), 'x')).toEqual([])
  })
})

describe('walking on bridges', () => {
  const site = {
    features: [
      {
        geometry: { type: 'Polygon', coordinates: DECK },
        properties: { kind: 'bridge', name: 'Pont d’Arcole', history: [gen({ from: 1828, until: 1854, kind: 'suspension', width: 3.5 }), gen({ from: 1856, kind: 'iron', arches: 1 })] }
      },
      { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'spire' } }
    ]
  }
  const crossings = crossingsOf(site.features, (c) => [c[0], c[1]])

  it('crosses only on a bridge standing that year', () => {
    expect(crossings).toHaveLength(1)
    expect(onStandingBridge(crossings, [0, 0], 1820)).toBe(false)
    expect(onStandingBridge(crossings, [0, 0], 1840)).toBe(true)
    expect(onStandingBridge(crossings, [0, 5], 1840)).toBe(false) // beside the 3.5 m footbridge
    expect(onStandingBridge(crossings, [0, 5], 1860)).toBe(true)
    expect(onStandingBridge(crossings, [0, 0], 1855)).toBe(false) // rebuilding
    expect(onStandingBridge(crossings, [0, 50], 1860)).toBeUndefined() // not on a deck
  })

  it('stops at the edge of the detailed ground', () => {
    expect(insideWalkBounds([0, 0, 1000, 1000], [500, 500])).toBe(true)
    expect(insideWalkBounds([0, 0, 1000, 1000], [30, 500])).toBe(false)
  })

  it('gives houses popup text of their own', () => {
    const withHouses = crossingsOf(
      [{ geometry: { type: 'Polygon', coordinates: DECK }, properties: { kind: 'bridge', name: 'Pont Saint-Michel', history: [gen({ until: 1857, kind: 'stone-old', houses_until: 1808, houses: 32 })] } }],
      (c) => [c[0], c[1]]
    )
    const houses = housesOf(withHouses)
    expect(houses).toHaveLength(2 * Math.min(16, Math.floor(96 / MIN_HOUSE_FRONT)))
    expect(houses[0].props.name).toBe('House on the Pont Saint-Michel')
    expect(houses[0].props.note).toContain('1808')
    expect(new Set(houses.map((h) => h.props.id)).size).toBe(houses.length)
  })
})

describe('packed meshes', () => {
  it('shares the corners of a quad and keeps triangle order', () => {
    const m = new MeshData()
    const life = [-1e4, 1860, 0, 0]
    const q: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ]
    ;[0, 1, 2, 0, 2, 3].forEach((k, i) => m.vertex(q[k], [0, -1, 0], [i, 0, 1, 0], [1, 0.5, 2, 3], life))
    m.owner.push(7, 7)
    const p = packMesh(m)
    // Every vertex differs here (a.x counts them), so nothing merges...
    expect(p.vertices).toBe(6)
    const m2 = new MeshData()
    for (const k of [0, 1, 2, 0, 2, 3]) m2.vertex(q[k], [0, -1, 0], [q[k][0], q[k][2], 1, 0], [1, 0.5, 2, 3], life)
    const p2 = packMesh(m2)
    // ...while a real wall quad keeps four corners.
    expect(p2.vertices).toBe(4)
    expect(Array.from(p2.index)).toEqual([0, 1, 2, 0, 2, 3])
    expect(Array.from(p2.life.slice(0, 4))).toEqual([-10000, 1860, 0, 0])
    expect(Array.from(p2.normal.slice(0, 3))).toEqual([0, -127, 0])
    expect(Array.from(p2.position.slice(6, 9))).toEqual([1, 0, 1])
  })
})

describe('tree level of detail', () => {
  it('splits trees by distance from the camera', () => {
    const trees = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 500, y: 0 }
    ]
    expect(partitionTrees(trees, 0, 0, [240])).toEqual([[0, 1], [2]])
    expect(partitionTrees(trees, 450, 0, [240])).toEqual([[2], [0, 1]])
    expect(partitionTrees(trees, 0, 0, [50, 200])).toEqual([[0], [1], [2]])
  })
})

const siteFile = new URL('../public/data/3d/site-cite.geojson', import.meta.url)

describe.skipIf(!existsSync(siteFile))('generated bridges', () => {
  const site = JSON.parse(readFileSync(siteFile, 'utf8'))
  const bridges = site.features.filter((f: { properties: { kind: string } }) => f.properties.kind === 'bridge')
  const named = (name: string) => bridges.filter((f: { properties: { name: string } }) => f.properties.name === name)

  it('covers every bridge touching the island, each with a sound history', () => {
    for (const name of ['Pont Neuf', 'Pont au Change', 'Pont Notre-Dame', 'Petit-Pont', 'Pont au Double', 'Pont Saint-Michel', 'Pont d’Arcole', 'Pont Saint-Louis', 'Pont de l’Archevêché', 'Pont Louis-Philippe'])
      expect(named(name).length, name).toBeGreaterThan(0)
    expect(named('Pont Neuf')).toHaveLength(2) // both arms
    expect(named('Pont Louis-Philippe')).toHaveLength(2) // the line of 1834 and today's
    for (const f of bridges) {
      const h: BridgeGeneration[] = f.properties.history
      expect(h.length).toBeGreaterThan(0)
      for (let i = 1; i < h.length; i++) expect(h[i].from!).toBeGreaterThanOrEqual(h[i - 1].until!)
      for (const g of h) expect(g.kind in BRIDGE_KIND).toBe(true)
    }
  })

  it('shows houses only on the Pont Notre-Dame, the Pont au Change and the Pont Saint-Michel', () => {
    const carrying = bridges.filter((f: { properties: { history: BridgeGeneration[] } }) => f.properties.history.some((g) => g.houses_until)).map((f: { properties: { name: string } }) => f.properties.name)
    expect(carrying.sort()).toEqual(['Pont Notre-Dame', 'Pont Saint-Michel', 'Pont au Change'])
  })
})

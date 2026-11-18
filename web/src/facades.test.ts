import { describe, expect, it } from 'vitest'
import { buildCity, FACE, insetEdges, MeshData, normalisePoly, partyNeighbours, ROOF_MATERIAL, STYLE, type BuildingSpec, type Poly, type Pt, type Ring } from './citygen'
import {
  addDormer,
  addShopfronts,
  addStrip,
  BAY,
  floorLayout,
  groundLayout,
  ihash,
  ihashu,
  packCodes,
  packHeightYear,
  PART,
  SIGN,
  shopRuns,
  sidOf,
  stripOffsets,
  tradeOf
} from './facades'
import { ADS, atlasLayout, ATLAS, signGlsl, TRADE, tradeWord, TRADES } from './signs'

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
]
const OPEN: BuildingSpec['life'] = [-1e4, 1e4, 0, 0]

function spec(polys: Poly[], over: Partial<BuildingSpec> = {}): BuildingSpec {
  return { polys, height: 20, roof: 'mansard', roofMaterial: ROOF_MATERIAL.zinc, style: STYLE.haussmann, seed: 0.4, life: OPEN, ...over }
}

/** The hash written with BigInt, as the GLSL computes it on 32-bit unsigned integers. */
function reference(a: number, b: number, c: number): number {
  const M = (1n << 32n) - 1n
  const mul = (x: bigint, k: bigint) => (x * k) & M
  let h = mul(BigInt(a), 0x27d4eb2dn) ^ mul(BigInt(b), 0x165667b1n) ^ mul(BigInt(c), 0x9e3779b1n)
  h ^= h >> 15n
  h = mul(h, 0x2c1b3c6dn)
  h ^= h >> 12n
  h = mul(h, 0x297a2d39n)
  h ^= h >> 15n
  return Number(h)
}

/** Vertices of a mesh with a given a_c.x part. */
function partVertices(m: MeshData, part: number): number[][] {
  const out: number[][] = []
  for (let v = 0; v < m.position.length / 3; v++) if (m.c[v * 4] === part) out.push([m.position[v * 3], m.position[v * 3 + 1], m.position[v * 3 + 2], m.life[v * 4], m.life[v * 4 + 1]])
  return out
}

describe('hashes shared with the shader', () => {
  it('matches 32-bit unsigned arithmetic', () => {
    for (const [a, b, c] of [
      [0, 0, 0],
      [1, 2, 3],
      [996, 63 * 32 + 11, 7],
      [512, 1, 99],
      [77, 4000, 61]
    ])
      expect(ihashu(a, b, c)).toBe(reference(a, b, c))
  })

  it('gives numbers in 0..1 that differ with each input', () => {
    const values = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const h = ihash(i, 3, 5)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThan(1)
      values.add(h)
    }
    expect(values.size).toBe(200)
    expect(sidOf(0.4)).toBe(399)
  })
})

describe('facade layout', () => {
  it('fits storeys under the eave as the shader does', () => {
    expect(floorLayout(STYLE.haussmann, 18, 3.1)).toEqual({ ground: 4.3, n: 4, fh: (18 - 4.3 - 0.4) / 4 })
    expect(floorLayout(STYLE.old, 3.5, 2.8).n).toBe(0)
  })

  it('packs two bits per bay and finds the runs of shops', () => {
    const codes = [BAY.door, BAY.shop, BAY.more, BAY.shop, BAY.plain]
    expect(packCodes(codes)).toBe(3 + 1 * 4 + 2 * 16 + 1 * 64)
    expect(shopRuns(codes, 5)).toEqual([
      [1, 2],
      [3, 3]
    ])
  })

  it('puts a carriage door in the middle of a Haussmann front, doors and shops elsewhere', () => {
    const g = groundLayout(STYLE.haussmann, 0.4, 399, 0, 24, { cochere: true })
    expect(g.codes).toHaveLength(7)
    expect(g.cochere).toBe(3)
    expect(g.codes[3]).toBe(BAY.door)
    expect(g.codes.filter((c) => c === BAY.shop).length).toBeGreaterThan(0)
    // Every run of `more` starts with a shop.
    g.codes.forEach((c, k) => {
      if (c === BAY.more) expect([BAY.shop, BAY.more]).toContain(g.codes[k - 1])
    })
    expect(groundLayout(STYLE.haussmann, 0.4, 399, 0, 24, { cochere: true })).toEqual(g)
  })

  it('gives courtyards a door and no shops, and old houses an alley door', () => {
    const c = groundLayout(STYLE.old, 0.3, 120, 2, 9, { courtyard: true })
    expect(c.codes.filter((x) => x === BAY.door)).toHaveLength(1)
    expect(c.codes.some((x) => x === BAY.shop || x === BAY.more)).toBe(false)
    for (let sid = 0; sid < 40; sid++) {
      const o = groundLayout(STYLE.old, 0.3, sid, 0, 8)
      expect([o.codes[0], o.codes[o.codes.length - 1]]).toContain(BAY.door)
    }
  })

  it('packs a height and a year into one exact float', () => {
    const v = packHeightYear(17.34, 1860)
    expect(v % 1000).toBe(173)
    expect(1700 + Math.floor(v / 1000)).toBe(1860)
    expect(Math.floor(packHeightYear(12, 1e4) / 1000)).toBe(400)
    expect(Math.fround(v)).toBe(v)
  })
})

describe('relief', () => {
  it('mitres strips at corners and squares them where they stop', () => {
    const ring = normalisePoly([rect(0, 0, 10, 6)])![0]
    const all = stripOffsets(ring, [true, true, true, true])
    // The corner (10, 0) between the south and east sides moves out diagonally.
    expect(all.end[0][0]).toBeCloseTo(1)
    expect(all.end[0][1]).toBeCloseTo(-1)
    const one = stripOffsets(ring, [true, false, false, false])
    expect(one.start[0]).toEqual([0, -1])
    expect(one.end[0][0]).toBeCloseTo(0)
    expect(one.end[0][1]).toBeCloseTo(-1)
  })

  it('builds a cornice of three faces per side, with end caps where it stops', () => {
    const m = new MeshData()
    const ring = normalisePoly([rect(0, 0, 10, 6)])![0]
    addStrip(m, { owner: 0, b: [1, 0.4, 18, 3], life: OPEN, id: 5 }, ring, [true, true, false, false], { depth: 0.5, z0: 17.4, z1: 18, part: PART.moulding, w: 1018, caps: true })
    expect(m.triangles).toBe(2 * 3 * 2 + 2 * 2)
    const xs = m.position.filter((_, i) => i % 3 === 0)
    expect(Math.max(...xs)).toBeCloseTo(10.5)
  })

  it('sets dormers on the roof plane', () => {
    const m = new MeshData()
    const frame = { a: [0, 0] as Pt, t: [1, 0] as Pt, inward: [0, 1] as Pt, eave: 18, rise: 3, run: 1.5 }
    addDormer(m, 0, frame, 3, 1.3, 0.3, 1.7, [ROOF_MATERIAL.zinc, FACE.dormer, STYLE.haussmann, 0.4], OPEN, 0)
    expect(m.triangles).toBe(9)
    for (let v = 0; v < m.position.length / 3; v++) {
      const y = m.position[v * 3 + 1]
      const z = m.position[v * 3 + 2]
      // Nothing pokes out under the roof slope z = eave + 2·s (s inward from the wall).
      expect(z).toBeGreaterThanOrEqual(18 + 2 * y - 0.031)
      expect(z).toBeLessThan(21)
    }
  })

  it('keeps each era apart: casings, awnings from 1850, emblems before about 1885', () => {
    const m = new MeshData()
    const b = [STYLE.old, 0.4, 12, 2.8]
    let awnings = 0
    for (let sid = 0; sid < 60; sid++) {
      const layout = groundLayout(STYLE.old, 0.4, sid, 0, 9)
      addShopfronts(m, { owner: 0, b, life: OPEN, id: sid * 64 }, [0, 0], [9, 0], STYLE.old, sid, 0, layout, 3.3, OPEN)
    }
    for (const v of partVertices(m, PART.awning)) {
      expect(v[3]).toBeGreaterThanOrEqual(1850)
      awnings++
    }
    expect(awnings).toBeGreaterThan(0)
    for (const v of partVertices(m, PART.casing)) expect(v[3]).toBeGreaterThanOrEqual(1790)
    for (let v = 0; v < m.position.length / 3; v++) {
      if (m.c[v * 4] !== PART.sign) continue
      const kind = m.c[v * 4 + 2]
      const [from, until] = [m.life[v * 4], m.life[v * 4 + 1]]
      if (kind === SIGN.grapes || kind === SIGN.basin || kind === SIGN.board) expect(until).toBeLessThanOrEqual(1885)
      if (kind === SIGN.litCross || kind === SIGN.litCarrot) expect(from).toBeGreaterThanOrEqual(1958)
      if (kind === SIGN.carrot) expect(from).toBeGreaterThanOrEqual(1815)
    }
  })

  it('picks a trade per shop as the shader does', () => {
    expect(tradeOf(399, 2, 1)).toBe(ihashu(399, 2 * 32 + 1, 7) % TRADES.length)
  })
})

describe('old houses', () => {
  it('corbels the upper floors of some houses over the street, ground floor on the line', () => {
    let found = 0
    for (let i = 0; i < 400 && !found; i++) {
      const seed = i / 400
      if (ihash(sidOf(seed), 0, 52) >= 0.16) continue
      const house = spec([normalisePoly([rect(0, 0, 6, 12)])!], { style: STYLE.old, roof: 'gable', roofMaterial: ROOF_MATERIAL.tile, height: 15, seed, life: [-1e4, 1860, 0, 0] })
      const city = buildCity([house])
      const ys = city.facades.position.filter((_, k) => k % 3 === 1)
      const zs = city.facades.position.filter((_, k) => k % 3 === 2)
      // Below the first floor nothing leaves the footprint; above, the walls stand out.
      ys.forEach((y, k) => {
        if (zs[k] < 3.2) expect(y).toBeGreaterThanOrEqual(-1e-6)
      })
      found = Math.min(...ys)
    }
    expect(found).toBeLessThan(-0.2)
  })
})

describe('mansards between neighbours', () => {
  it('raises the party wall to the top of the roof instead of sloping toward it', () => {
    const inner = insetEdges(normalisePoly([rect(0, 0, 20, 12)])!, [[1.5, 0, 1.5, 1.5]])!
    // The east side stays in place: the slope stops against it.
    expect(Math.max(...inner[0].map((p) => p[0]))).toBeCloseTo(20)
    expect(Math.min(...inner[0].map((p) => p[0]))).toBeCloseTo(1.5)
    expect(insetEdges(normalisePoly([rect(0, 0, 3, 2)])!, [[1.5, 1.5, 1.5, 1.5]])).toBeNull()
  })

  it('builds two neighbours with a shared high party wall, dormers on the street and pots on the stacks', () => {
    const a = spec([normalisePoly([rect(0, 0, 20, 12)])!])
    const b = spec([normalisePoly([rect(20.2, 0, 40, 12)])!], { seed: 0.7 })
    const city = buildCity([a, b])
    // Party walls rise to the top of the mansard (18 + 3 m).
    let partyTop = 0
    for (let v = 0; v < city.facades.position.length / 3; v++) if (city.facades.a[v * 4 + 3] === 1) partyTop = Math.max(partyTop, city.facades.position[v * 3 + 2])
    expect(partyTop).toBeCloseTo(21)
    const kinds = new Set(city.roofs.b.filter((_, i) => i % 4 === 1))
    expect(kinds.has(FACE.dormer)).toBe(true)
    expect(kinds.has(FACE.pots)).toBe(true)
    // No dormer stands within a metre of the party wall line.
    for (let v = 0; v < city.roofs.position.length / 3; v++)
      if (city.roofs.b[v * 4 + 1] === FACE.dormer) expect(Math.abs(city.roofs.position[v * 3] - 20.1)).toBeGreaterThan(0.3)
    // Balconies and cornices go to the relief mesh.
    expect(partVertices(city.details, PART.slab).length).toBeGreaterThan(0)
    expect(partVertices(city.details, PART.rail).length).toBeGreaterThan(0)
  })

  it('tells a party wall the heights of its neighbours through time', () => {
    const [p1, p2] = partyNeighbours(
      [
        { height: 15, life: [-1e4, 1860, 0, 0] },
        { height: 22, life: [1875, 1e4, 0, 0] }
      ],
      OPEN
    )
    expect(p1 % 1000).toBe(140)
    expect(1700 + Math.floor(p1 / 1000)).toBe(1860)
    expect(p2 % 1000).toBe(210)
    expect(1700 + Math.floor(p2 / 1000)).toBe(1875)
  })
})

describe('sign atlas', () => {
  it('fits every word, with the last row of cells kept for the widths', () => {
    const layout = atlasLayout()
    expect(layout.cells.length).toBeLessThanOrEqual(ATLAS.cols * (ATLAS.rows - 1))
    expect(layout.cells.length).toBeGreaterThan(TRADES.length + ADS.length)
  })

  it('writes words of their time', () => {
    expect(tradeWord(TRADE.bakery, 1800, false)).toBe('BOULANGER')
    expect(tradeWord(TRADE.bakery, 1850, false)).toBe('BOULANGERIE')
    expect(tradeWord(TRADE.tobacco, 1800, false)).toBe('ÉPICIER')
    expect(tradeWord(TRADE.tobacco, 1836, false)).toBe('TABAC')
    expect(tradeWord(TRADE.horse, 1850, false)).toBe('BOUCHER')
    expect(tradeWord(TRADE.horse, 1900, false)).toBe('BOUCHERIE CHEVALINE')
    expect(tradeWord(TRADE.barber, 1790, false)).toBe('PERRUQUIER')
    expect(tradeWord(TRADE.mercer, 2020, true)).toBe('SOUVENIRS')
  })

  it('generates the shader lookup from the same table', () => {
    const glsl = signGlsl()
    expect(glsl).toContain(`const int SIGN_TRADES = ${TRADES.length};`)
    const layout = atlasLayout()
    // Bakery before 1830: the BOULANGER cell is the fallback of its branch.
    const bakery = glsl.split('\n').find((l) => l.includes(`if (trade == ${TRADE.bakery})`))!
    expect(bakery.trim().endsWith(`return ${layout.index('BOULANGER', 'serif')}; }`)).toBe(true)
    expect(bakery).toContain(`if (year >= 1830.0) return ${layout.index('BOULANGERIE', 'serif')};`)
  })
})

import { describe, expect, it } from 'vitest'
import {
  addBuilding,
  buildCity,
  coexist,
  FACE,
  insetPoly,
  MeshData,
  normalisePoly,
  orientedBox,
  ROOF_MATERIAL,
  signedArea,
  STYLE,
  type BuildingSpec,
  type Poly,
  type Ring
} from './citygen'
import { aliveIn, lifeOf, roofOf, seedOf, styleOf, westFront, type CityProps } from './city3d'

const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
]

function spec(polys: Poly[], over: Partial<BuildingSpec> = {}): BuildingSpec {
  return { polys, height: 15, roof: 'flat', roofMaterial: ROOF_MATERIAL.zinc, style: STYLE.old, seed: 0.4, life: [-1e4, 1e4, 0, 0], ...over }
}

/** Highest z of a mesh. */
const top = (m: MeshData) => Math.max(...m.position.filter((_, i) => i % 3 === 2))
/** The first vertex of each triangle of a mesh. */
const corners = (m: MeshData) => m.index.filter((_, i) => i % 3 === 0)
/** Vertices of the plain walls of a mesh (a_c.x = 0), without the relief. */
const plain = (m: MeshData) => {
  const out = new MeshData()
  for (let v = 0; v < m.position.length / 3; v++)
    if (m.c[v * 4] === 0) out.vertex([m.position[v * 3], m.position[v * 3 + 1], m.position[v * 3 + 2]], [0, 0, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])
  return out
}
const plainTriangles = (m: MeshData) => corners(m).filter((v) => m.c[v * 4] === 0).length

describe('polygons', () => {
  it('orients outer rings counter-clockwise and holes clockwise, without the closing point', () => {
    const outer: Ring = [...rect(0, 0, 10, 10)].reverse()
    outer.push(outer[0])
    const poly = normalisePoly([outer, rect(3, 3, 6, 6)])!
    expect(poly[0]).toHaveLength(4)
    expect(signedArea(poly[0])).toBeGreaterThan(0)
    expect(signedArea(poly[1])).toBeLessThan(0)
  })

  it('insets a square and refuses an inset that folds it', () => {
    const sq = normalisePoly([rect(0, 0, 10, 10)])!
    expect(signedArea(insetPoly(sq, 1)![0])).toBeCloseTo(64)
    expect(insetPoly(sq, 6)).toBeNull()
  })

  it('grows a courtyard when insetting a ring', () => {
    const ring = normalisePoly([rect(0, 0, 20, 20), rect(8, 8, 12, 12)])!
    const inset = insetPoly(ring, 1)!
    expect(Math.abs(signedArea(inset[1]))).toBeCloseTo(36)
  })

  it('finds the long axis of a rotated rectangle', () => {
    const a = (30 * Math.PI) / 180
    const r = rect(-10, -3, 10, 3).map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as [number, number])
    const box = orientedBox(r)
    expect(box.halfLen).toBeCloseTo(10)
    expect(box.halfWid).toBeCloseTo(3)
    expect(Math.abs(box.dir[0] * Math.cos(a) + box.dir[1] * Math.sin(a))).toBeCloseTo(1)
  })
})

describe('buildings', () => {
  it('puts a pitched roof on a house: ridge along the long side, gables on the short sides', () => {
    const walls = new MeshData()
    const roofs = new MeshData()
    addBuilding(spec([normalisePoly([rect(0, 0, 12, 6)])!], { roof: 'gable', height: 14 }), 0, walls, roofs)
    // Half-width 3 m at 45°: a 3 m rise, eaves 1.5 m below the median height.
    expect(top(roofs)).toBeCloseTo(15.5)
    expect(top(plain(walls))).toBeCloseTo(15.5) // the gable walls reach the ridge
    // Two crossing points are added to the rectangle: six walls of two triangles.
    expect(plainTriangles(walls)).toBe(12)
  })

  it('puts a mansard with dormer faces on a Paris building', () => {
    const walls = new MeshData()
    const roofs = new MeshData()
    addBuilding(spec([normalisePoly([rect(0, 0, 20, 12)])!], { roof: 'mansard', height: 20, style: STYLE.haussmann }), 0, walls, roofs)
    expect(top(plain(walls))).toBeCloseTo(18)
    expect(top(roofs)).toBeCloseTo(21)
    const kinds = new Set(roofs.b.filter((_, i) => i % 4 === 1))
    expect(kinds).toEqual(new Set([FACE.brisis, FACE.flat, FACE.dormer]))
  })

  it('falls back to a flat roof when the footprint is too thin for a mansard', () => {
    const walls = new MeshData()
    const roofs = new MeshData()
    addBuilding(spec([normalisePoly([rect(0, 0, 20, 1.2)])!], { roof: 'mansard', height: 12 }), 0, walls, roofs)
    expect(top(roofs)).toBeCloseTo(12)
  })

  it('marks the walls between neighbours that stand at the same time as party walls', () => {
    const a = spec([normalisePoly([rect(0, 0, 10, 10)])!])
    const b = spec([normalisePoly([rect(10.3, 0, 20, 10)])!])
    const party = (m: MeshData) => corners(m).filter((v) => m.a[v * 4 + 3] === 1).length / 2
    expect(party(buildCity([a, b]).facades)).toBe(2)
    const later = { ...b, life: [1900, 1e4, 0, 0] as [number, number, number, number] }
    const gone = { ...a, life: [-1e4, 1860, 0, 0] as [number, number, number, number] }
    expect(party(buildCity([gone, later]).facades)).toBe(0)
  })

  it('knows which lives overlap', () => {
    expect(coexist([-1e4, 1860, 0, 0], [1851, 1e4, 0, 0])).toBe(true)
    expect(coexist([-1e4, 1860, 0, 0], [1860, 1e4, 0, 0])).toBe(false)
  })
})

describe('city layer rules', () => {
  const base: CityProps = { id: 'apur:1', kind: 'standing', height: 18, period: 'before 1800', source: '' }

  it('dates buildings as the plain model does, and handles a gap', () => {
    expect(lifeOf(base)).toEqual([-1e4, 1e4, 0, 0])
    expect(lifeOf({ ...base, kind: 'reconstructed', until: 1860 })[1]).toBe(1860)
    expect(lifeOf({ ...base, kind: 'later', from: 1870 })[0]).toBe(1870)
    const spire: [number, number, number, number] = [1860, 1e4, 2019, 2024]
    expect([1836, 1900, 2020, 2026].map((y) => aliveIn(spire, y))).toEqual([false, true, false, true])
  })

  it('picks styles and roofs', () => {
    expect(styleOf(base)).toBe(STYLE.old)
    expect(styleOf({ ...base, kind: 'later', from: 1870 })).toBe(STYLE.haussmann)
    expect(styleOf({ ...base, kind: 'later', from: 1930 })).toBe(STYLE.modern)
    expect(styleOf({ ...base, landmark: true })).toBe(STYLE.monument)
    expect(roofOf({ ...base, roof: 'mansard', roof_material: 'zinc' })).toEqual({ shape: 'mansard', material: ROOF_MATERIAL.zinc })
    expect(roofOf({ ...base, roof: 'mansard', landmark: true })).toEqual({ shape: 'gable', material: ROOF_MATERIAL.lead })
    expect(roofOf({ ...base, roof: 'flat', landmark: true }).material).toBe(ROOF_MATERIAL.stone)
  })

  it('gives each building a stable seed', () => {
    expect(seedOf('vasserot:42')).toBe(seedOf('vasserot:42'))
    expect(seedOf('vasserot:42')).not.toBe(seedOf('vasserot:43'))
    expect(seedOf('x')).toBeGreaterThanOrEqual(0)
    expect(seedOf('x')).toBeLessThan(1)
  })

  it('finds a west front across the westernmost points', () => {
    // A church 60 m long and 20 m wide, its axis due east.
    const f = westFront([normalisePoly([rect(0, -10, 60, 10)])!], 90)
    expect(f.centre[0]).toBeCloseTo(0)
    expect(f.centre[1]).toBeCloseTo(0)
    expect(f.half).toBeCloseTo(10)
    expect(f.axis[0]).toBeCloseTo(1)
  })
})

describe('gardens and trees', () => {
  it('rings a garden with a railing that the wall shader draws', async () => {
    const { addRailing } = await import('./citygen')
    const m = new MeshData()
    addRailing(m, normalisePoly([rect(0, 0, 10, 4)])!, 1, [1844, 1e4, 0, 0])
    expect(m.triangles).toBe(8)
    expect(new Set(m.b.filter((_, i) => i % 4 === 0))).toEqual(new Set([STYLE.railing]))
    expect(m.life.slice(0, 4)).toEqual([1844, 1e4, 0, 0])
  })

  it('reads trees from the compact rows of the greenery file', async () => {
    const { treesOf } = await import('./city3d')
    const trees = treesOf(
      {
        gardens: { features: [] },
        trees: { fields: ['lon', 'lat', 'height_m', 'group', 'planted', 'girth_cm', 'in_garden'], rows: [[2.35, 48.85, 18, 0, 1857, 210, 0]] }
      },
      ([lon, lat]) => [lon * 10, lat * 10]
    )
    expect(trees).toEqual([{ x: 23.5, y: 488.5, height: 18, group: 0, planted: 1857, girth: 210 }])
  })
})

describe('institutions', () => {
  it('gives the palace slate mansards, then a roofless shell after the sack of 1831', async () => {
    const { institutionLook, INSTITUTION_STYLE } = await import('./institutions')
    const base = { id: 'institution:archeveche:0', kind: 'reconstructed' as const, height: 18, period: '', source: '' }
    expect(institutionLook(base)).toBeUndefined()
    expect(institutionLook({ ...base, institution: 'archeveche', institution_style: 12 })).toEqual({ style: 12, roof: 'mansard', roofMaterial: ROOF_MATERIAL.lead })
    expect(institutionLook({ ...base, institution: 'archeveche', ruin: true })?.style).toBe(INSTITUTION_STYLE.palaceRuin)
    expect(institutionLook({ ...base, institution: 'archeveche', ruin: true })?.roof).toBe('flat')
  })

  it('dates a building that starts and ends', () => {
    expect(lifeOf({ kind: 'reconstructed', from: 1831, until: 1837 })).toEqual([1831, 1837, 0, 0])
  })
})

describe('wall families', () => {
  it('splits walls by style into families, keeping owners and order', async () => {
    const { splitByFamily, wallFamily, WALL_FAMILY } = await import('./citygen')
    expect([0, 1, 3, 4, 6, 12, 25].map(wallFamily)).toEqual([0, 0, 0, WALL_FAMILY.bridges, 0, WALL_FAMILY.institutions, WALL_FAMILY.landmarks])
    const m = new MeshData()
    const life = [-1e4, 1e4, 0, 0]
    const q: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]
    m.quad(q, [0, -1, 0], q.map((c) => [c[0], c[2], 1, 0]), [STYLE.old, 0.5, 2, 3], life, [0, 0, 0, 0], 4)
    m.quad(q, [0, -1, 0], q.map((c) => [c[0], c[2], 1, 0]), [22, 0.5, 2, 3], life, [0, 0, 0, 0], 9)
    const [plain, bridges, institutions, landmarks] = splitByFamily(m)
    expect(plain.owner).toEqual([4, 4])
    expect(landmarks.owner).toEqual([9, 9])
    expect(bridges.triangles + institutions.triangles).toBe(0)
    expect(landmarks.position.slice(0, 3)).toEqual([0, 0, 0])
  })

  it('cuts out the shader blocks of the other families', async () => {
    const { shaderVariant } = await import('./cityshaders')
    const src = 'a\n#ifdef WALL_BRIDGES\nbridge\n#endif\nb\n#ifdef WALL_LANDMARKS\nlandmark\n#endif\nc\n'
    expect(shaderVariant(src, ['WALL_LANDMARKS'])).toBe('a\nb\nlandmark\nc\n')
    expect(shaderVariant(src, [])).toBe('a\nb\nc\n')
  })
})

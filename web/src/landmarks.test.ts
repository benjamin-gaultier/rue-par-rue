import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MeshData, ROOF_MATERIAL, STYLE, type BuildingSpec, type Poly, type Pt } from './citygen'
import * as G from './landmarkgen'
import { applyLandmarks, buildParts, parcelOf, replacedUntil, samplePoints, type LandmarkFile } from './landmarks'
import { landmarkFacades } from './landmarkshaders'

const square = (x0: number, y0: number, x1: number, y1: number): Poly => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1]
  ]
]

function spec(polys: Poly[], over: Partial<BuildingSpec> = {}): BuildingSpec {
  return { polys, height: 20, roof: 'mansard', roofMaterial: ROOF_MATERIAL.zinc, style: STYLE.haussmann, seed: 0.3, life: [1900, 1e4, 0, 0], ...over }
}

/** Every vertex attribute has one entry per vertex, and every triangle an owner. */
function consistent(m: MeshData) {
  const n = m.position.length / 3
  expect(m.normal.length / 3).toBe(n)
  expect(m.a.length / 4).toBe(n)
  expect(m.b.length / 4).toBe(n)
  expect(m.life.length / 4).toBe(n)
  // Triangles index their corners (quads share theirs): three per owner.
  expect(m.index.length).toBe(m.owner.length * 3)
  expect(m.index.every((i) => i >= 0 && i < n)).toBe(true)
  expect(m.position.every(Number.isFinite)).toBe(true)
}

describe('landmark data', () => {
  const file = JSON.parse(readFileSync(new URL('../public/data/3d/landmarks-cite.json', import.meta.url), 'utf8')) as LandmarkFile

  it('uses the wall styles the shader knows', () => {
    const styles = file.metadata?.styles ?? {}
    expect(styles['sainte-chapelle']).toBe(G.LM.sainteChapelle)
    expect(styles['sainte-chapelle-front']).toBe(G.LM.chapelFront)
    expect(styles.tower).toBe(G.LM.tower)
    expect(styles.conciergerie).toBe(G.LM.conciergerie)
    expect(styles.palais).toBe(G.LM.palais)
    expect(styles.tribunal).toBe(G.LM.tribunal)
    expect(styles.prefecture).toBe(G.LM.prefecture)
    expect(styles['hotel-dieu']).toBe(G.LM.hotelDieu)
    expect(styles.dauphine).toBe(G.LM.dauphine)
    expect(styles.morgue).toBe(G.LM.morgue)
    expect(styles['pavilion-1873']).toBe(G.LM.pavilion1873)
    expect(styles['pavilion-1924']).toBe(G.LM.pavilion1924)
    expect(styles.stone).toBe(G.LM.stone)
    expect(styles.harlay).toBe(G.LM.harlay)
    expect(styles.openwork).toBe(G.LM.openwork)
  })

  it('dates every dated part and keeps the order of history', () => {
    const named = (kind: string) => file.parts.filter((p) => p.kind === kind)
    const statues = named('statue') as { from: number | null; until: number | null }[]
    expect(statues.map((s) => [s.from, s.until])).toEqual([
      [null, 1792],
      [1818, null]
    ])
    const chapel = named('chapel')[0] as { spires: { from: number | null; until: number | null }[] }
    expect(chapel.spires.map((s) => [s.from, s.until])).toEqual([
      [null, 1791],
      [1855, null]
    ])
    const morgues = named('building') as { from: number; until: number }[]
    expect(morgues.map((m) => [m.from, m.until])).toEqual([
      [1804, 1864],
      [1864, 1914]
    ])
    expect(named('tower').map((t) => t.name)).toEqual(['Tour César', 'Tour d’Argent', 'Tour Bonbec', 'Tour Bonbec'])
  })

  it('builds every part into consistent meshes', () => {
    const origin: Pt = [2.3488, 48.8535]
    const project = ([lon, lat]: number[]): Pt => [(lon - origin[0]) * 73300, (lat - origin[1]) * 111200]
    const meshes = { walls: new MeshData(), roofs: new MeshData(), props: new MeshData() }
    const blockers = buildParts(file.parts, project, () => [square(0, 0, 10, 4)], meshes)
    for (const m of Object.values(meshes)) {
      expect(m.triangles).toBeGreaterThan(100)
      consistent(m)
    }
    // The two statues, the two morgues and the 1873 pavilions block the way.
    expect(blockers.length).toBe(5)
  })
})

describe('applying landmarks to the city', () => {
  it('finds the parcel of a reconstructed lot', () => {
    expect(parcelOf('vasserot:PA3418')).toBe('PA3418')
    expect(parcelOf('vasserot:PA3536:12')).toBe('PA3536')
  })

  it('samples a footprint inside it', () => {
    const pts = samplePoints([square(0, 0, 10, 10)])
    expect(pts[0][0]).toBeCloseTo(5)
    expect(pts[0][1]).toBeCloseTo(5)
    expect(pts.length).toBe(5)
    expect(pts.every(([x, y]) => x > 0 && x < 10 && y > 0 && y < 10)).toBe(true)
  })

  it('dates an old building by the newer one covering most of it', () => {
    const wing = { polys: [square(0, 0, 20, 20)], bbox: [0, 0, 20, 20] as [number, number, number, number], from: 1868 }
    const other = { polys: [square(30, 0, 40, 20)], bbox: [30, 0, 40, 20] as [number, number, number, number], from: 1900 }
    expect(replacedUntil([square(2, 2, 8, 8)], [wing, other])).toBe(1868)
    expect(replacedUntil([square(31, 2, 39, 8)], [wing, other])).toBe(1900)
    // Mostly in the courtyard between them: not replaced.
    expect(replacedUntil([square(19, 2, 31, 8)], [wing, other])).toBeUndefined()
  })

  it('restyles, redates and hides landmark buildings', () => {
    const specs = [
      spec([square(0, 0, 20, 20)]),
      spec([square(2, 2, 8, 8)], { life: [-1e4, 1860, 0, 0], roof: 'gable' }),
      spec([square(100, 0, 110, 10)], { life: [-1e4, 1860, 0, 0] }),
      spec([square(50, 50, 60, 60)], { life: [-1e4, 1e4, 0, 0] }),
      spec([square(200, 0, 210, 10)], { life: [-1e4, 1860, 0, 0] })
    ]
    const props = [
      { id: 'apur:wing', kind: 'later' as const },
      { id: 'vasserot:PA3536:4', kind: 'reconstructed' as const },
      { id: 'vasserot:PA3418:1', kind: 'reconstructed' as const },
      { id: 'apur:chapel', kind: 'standing' as const },
      { id: 'vasserot:PA9999', kind: 'reconstructed' as const }
    ]
    const file: LandmarkFile = {
      buildings: [
        { id: 'apur:wing', style: G.LM.harlay, from: 1868, replaces: true },
        { id: 'apur:chapel', style: G.LM.sainteChapelle, draw: 'custom' },
        { id: 'apur:missing', style: 99 }
      ],
      vasserot: [{ parcels: ['PA3418'], until: 1874 }],
      parts: []
    }
    const { changed, hidden } = applyLandmarks(specs, props, file)
    expect(specs[0].style).toBe(G.LM.harlay)
    expect(specs[0].life[0]).toBe(1868)
    expect(specs[1].life[1]).toBe(1868) // the old Palais stands until the wing is built
    expect(specs[2].life[1]).toBe(1874) // the place Dauphine's east side
    expect(specs[4].life[1]).toBe(1860) // untouched
    expect(specs[3].polys).toEqual([])
    expect(hidden.map((h) => h.index)).toEqual([3])
    expect([...changed.keys()].sort()).toEqual([0, 1, 2])
    expect(changed.get(1)).toEqual([-1e4, 1860, 0, 0])
  })
})

describe('landmark geometry', () => {
  it('reads open-ended dates', () => {
    expect(G.lifeOf(null, 1792)).toEqual([-G.OPEN, 1792, 0, 0])
    expect(G.lifeOf(1818)).toEqual([1818, G.OPEN, 0, 0])
  })

  it('turns rings counter-clockwise and frames right-handed', () => {
    const ring = G.regularRing([0, 0], 2, 8, 22.5)
    let area = 0
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = ring[i]
      const [x1, y1] = ring[(i + 1) % ring.length]
      area += x0 * y1 - x1 * y0
    }
    expect(area).toBeGreaterThan(0)
    const f = G.frame([0, 0], 90)
    expect(f.at(10, 0)[0]).toBeCloseTo(10) // forward is east
    expect(f.at(0, 5)[1]).toBeCloseTo(5) // left of east is north
  })

  it('faces walls outward', () => {
    const m = new MeshData()
    G.wall(m, [0, 0], [10, 0], 0, 5, { style: G.LM.stone, seed: 0.5, eave: 5, life: G.ALWAYS })
    expect(m.triangles).toBe(2)
    expect(m.normal.slice(0, 3)).toEqual([0, -1, 0]) // the south face of a ring going east
    expect(m.a.slice(0, 4)).toEqual([0, 0, 10, 0])
    expect(m.b.slice(0, 4)).toEqual([G.LM.stone, 0.5, 5, 4])
  })

  it('lays out the Sainte-Chapelle: four bays and the apse', () => {
    const c: G.ChapelSpec = { centre: [0, 0], bearing: 90, length: 41.6, width: 17.6, eave: 28, ridge: 42.5, porch: [4.5, 16], spires: [{ tip: 75.75, from: 1855, until: null }] }
    const L = G.chapelLayout(c)
    expect(L.hw).toBeCloseTo(17.6 / 2 - G.CHAPEL.buttress)
    expect(L.sWest).toBeCloseTo(-16.3)
    expect(L.bay).toBeGreaterThan(5)
    expect(L.bay).toBeLessThan(8)
    const walls = new MeshData()
    const roofs = new MeshData()
    const props = new MeshData()
    G.addChapel(walls, roofs, props, c)
    for (const m of [walls, roofs, props]) consistent(m)
    const zs = (m: MeshData) => m.position.filter((_, i) => i % 3 === 2)
    expect(Math.max(...zs(roofs))).toBeCloseTo(75.75 - 0.9, 1) // the needle, under its gilt finial
    expect(Math.max(...zs(props))).toBeLessThanOrEqual(75.75 + 0.01)
    const xs = walls.position.filter((_, i) => i % 3 === 0)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-41.6 / 2 - 1)
    expect(Math.max(...xs)).toBeLessThanOrEqual(41.6 / 2 + 0.01)
    // The spire stands only from 1855.
    const lives = new Set<number>()
    for (let i = 0; i < roofs.life.length; i += 4) lives.add(roofs.life[i])
    expect(lives.has(1855)).toBe(true)
  })

  it('builds towers, a dome, flyers, a statue and stalls', () => {
    const walls = new MeshData()
    const roofs = new MeshData()
    const props = new MeshData()
    G.addRoundTower(walls, roofs, { at: [0, 0], radius: 5.5, wall: 23, tip: 34.5, roof: 'cone' }, G.ALWAYS)
    G.addRoundTower(walls, roofs, { at: [20, 0], radius: 6, wall: 26, tip: 32.5, roof: 'battlements' }, G.lifeOf(1858))
    G.addSquareTower(walls, roofs, props, { corners: [[40, 0], [50, 0], [50, 10], [40, 10]], wall: 30, roofTip: 43.5, tip: 47, clock: { facing: [1, 0], z: 14 } }, G.ALWAYS)
    G.addDome(walls, roofs, props, { at: [80, 0], radius: 8, rotation: 0, drum_base: 22, drum_top: 31, dome_top: 42.5, lantern: 46.7 }, G.lifeOf(1865))
    G.addFlyer(walls, roofs, { foot: [0, 40], head: [0, 28], footZ: 27, headZ: 32, apse: false })
    G.addStatue(props, [0, 80], 120, 1614, G.lifeOf(null, 1792))
    G.addStall(props, [10, 80], 0.3, G.lifeOf(1809, 1873))
    for (const m of [walls, roofs, props]) consistent(m)
    const zs = (m: MeshData) => m.position.filter((_, i) => i % 3 === 2)
    expect(Math.max(...zs(roofs))).toBeCloseTo(47, 0)
    // The clock faces east, on the tower's east face (x = 50).
    const clock = []
    for (let i = 0; i < props.b.length; i += 4) if (props.b[i + 3] === G.PROP.clock) clock.push(props.position[(i / 4) * 3])
    expect(clock.length).toBe(6)
    expect(clock.every((x) => Math.abs(x - 50.08) < 1e-6)).toBe(true)
  })
})

describe('landmark shaders', () => {
  // Given z and the band's bounds, which its callers had just tested, lmBalustrade sent
  // Direct3D's shader compiler (Chrome and Edge on Windows) into endless recursion: the GPU
  // process crashed and the detailed island could not be drawn.
  it('gives the balustrade heights within its band', () => {
    const calls = [...landmarkFacades.matchAll(/lmBalustrade\((.*?), aa\)/g)].map((m) => m[1].split(',').map((a) => a.trim()))
    expect(calls.length).toBe(3)
    for (const [, , dz, h] of calls) {
      expect(dz).toMatch(/^z - \(.+\)$/)
      expect(Number(h)).toBeGreaterThan(0)
    }
  })
})

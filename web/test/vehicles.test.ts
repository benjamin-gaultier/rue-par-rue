import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { MODELS, ModelBuilder, PART, bow, buildModels } from '../src/vehiclemodels'
import {
  BuildingIndex,
  FLAG,
  footprint,
  keepOutOfBuildings,
  makePath,
  parseVehicles,
  pointAt,
  standingSpans,
  subtractSpan,
  travel,
  tripGap,
  wanted,
  type Vehicle,
  type VehicleData
} from '../src/vehicles'
import { ROOF_MATERIAL, STYLE, type BuildingSpec, type Pt } from '../src/citygen'
import { Vector4 } from 'three'

const square = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
]

function building(x0: number, y0: number, x1: number, y1: number, life: BuildingSpec['life']): BuildingSpec {
  return { polys: [[square(x0, y0, x1, y1)]], height: 15, roof: 'flat', roofMaterial: ROOF_MATERIAL.zinc, style: STYLE.old, seed: 0.5, life }
}

function vehicle(over: Partial<Vehicle> = {}): Vehicle {
  return { type: 'cart', length: 5.4, width: 1.9, x: 0, y: 0, z: 0, heading: 0, from: 1800, until: 1900, seed: 0.3, flags: 0, ...over }
}

describe('models', () => {
  const built = buildModels()

  it('builds every type the pipeline places, each a few hundred triangles', () => {
    const data = JSON.parse(readFileSync(new URL('../public/data/3d/vehicles-cite.json', import.meta.url), 'utf8')) as VehicleData
    for (const t of data.types) expect(MODELS[t.id], t.id).toBeDefined()
    for (const [id, b] of Object.entries(built)) {
      expect(b.triangles, id).toBeGreaterThan(20)
      expect(b.triangles, id).toBeLessThan(700)
      expect(b.vertices, id).toBeLessThan(65536)
    }
  })

  it('keeps each model within its footprint', () => {
    const data = JSON.parse(readFileSync(new URL('../public/data/3d/vehicles-cite.json', import.meta.url), 'utf8')) as VehicleData
    for (const t of data.types) {
      const p = built[t.id].position
      let maxX = 0
      let maxY = 0
      for (let i = 0; i < p.length; i += 3) {
        maxX = Math.max(maxX, Math.abs(p[i]))
        maxY = Math.max(maxY, Math.abs(p[i + 1]))
      }
      expect(maxX, t.id).toBeLessThan(t.length / 2 + 0.6)
      expect(maxY, t.id).toBeLessThan(t.width / 2 + 0.6)
    }
  })

  it('gives boxes outward normals and flat shading', () => {
    const b = new ModelBuilder()
    b.box(0, 2, 0, 1, 0, 1, [1, 1, 1])
    expect(b.triangles).toBe(12)
    expect(b.vertices).toBe(24)
    // Each face's normal points away from the box centre.
    for (let i = 0; i < b.vertices; i++) {
      const p = b.position.slice(i * 3, i * 3 + 3)
      const n = b.normal.slice(i * 3, i * 3 + 3)
      const d = (p[0] - 1) * n[0] + (p[1] - 0.5) * n[1] + (p[2] - 0.5) * n[2]
      expect(d).toBeGreaterThan(0)
    }
  })

  it('gives wheel treads outward normals and disc coordinates on the faces', () => {
    const b = new ModelBuilder()
    b.wheel(0, 0, 1, 1, 0.1, [1, 1, 1], [0, 0, 0], true, 8)
    let treads = 0
    for (let i = 0; i < b.vertices; i++) {
      const [x, , z] = b.position.slice(i * 3, i * 3 + 3)
      const [nx, ny, nz] = b.normal.slice(i * 3, i * 3 + 3)
      if (Math.abs(ny) < 0.5) {
        treads++
        expect(x * nx + (z - 1) * nz).toBeGreaterThan(0)
      } else expect(b.part[i * 4]).toBe(PART.spoked)
    }
    expect(treads).toBe(32)
  })

  it('points bows and sterns outward', () => {
    for (const [x0, x1] of [
      [10, 13],
      [-10, -13]
    ]) {
      const b = new ModelBuilder()
      b.hexa(bow(x0, x1, 4, 0, 1, 1, 0.5), [1, 1, 1])
      const cx = (x0 + x1) / 2
      for (let i = 0; i < b.vertices; i++) {
        const p = b.position.slice(i * 3, i * 3 + 3)
        const n = b.normal.slice(i * 3, i * 3 + 3)
        expect((p[0] - cx) * n[0] + p[1] * n[1] + (p[2] - 0.5) * n[2]).toBeGreaterThan(-1e-9)
      }
    }
  })

  it('shows the omnibus upper deck from 1853 only, and a mast on barges until 1930', () => {
    const lifeOf = (b: ModelBuilder) => new Set(b.life.map((v, i) => (i % 2 ? '' : `${v}:${b.life[i + 1]}`)).filter(Boolean))
    expect(lifeOf(built.omnibus).has('1853:10000')).toBe(true)
    expect(lifeOf(built.barge).has('-10000:1930')).toBe(true)
  })

  it('has horses, legs and drivers on horse-drawn types only', () => {
    const kinds = (id: string) => new Set(built[id].part.filter((_, i) => i % 4 === 0))
    for (const id of ['cart', 'tiltcart', 'fiacre', 'omnibus']) expect(kinds(id).has(PART.leg), id).toBe(true)
    for (const id of ['car_modern', 'bus_modern', 'barge', 'handcart']) expect(kinds(id).has(PART.leg), id).toBe(false)
    expect(MODELS.cart.tip).toBeDefined()
  })
})

describe('paths and travel', () => {
  const path = makePath([
    [0, 0],
    [100, 0],
    [100, 50]
  ])

  it('measures a path and finds points along it', () => {
    expect(path.length).toBe(150)
    const p = pointAt(path, 120, 1, 0)
    expect(p.x).toBeCloseTo(100)
    expect(p.y).toBeCloseTo(20)
    expect(p.heading).toBeCloseTo(Math.PI / 2)
  })

  it('walks a path backwards and keeps to the right', () => {
    const p = pointAt(path, 10, -1, 0)
    expect([p.x, p.y]).toEqual([100, 40])
    expect(p.heading).toBeCloseTo(-Math.PI / 2)
    // Eastbound on the first leg: the right is south.
    const q = pointAt(path, 50, 1, 2)
    expect(q.y).toBeCloseTo(-2)
    // Westbound: the right is north.
    const r = pointAt(path, 120, -1, 2)
    expect(r.y).toBeCloseTo(2)
  })

  it('moves at its speed and disappears between trips', () => {
    const m = { path, speed: 10, phase: 0, dir: 1 as const, lane: 0 }
    expect(travel(m, 0)!.x).toBeCloseTo(0)
    expect(travel(m, 5)!.x).toBeCloseTo(50)
    const gap = tripGap(path)
    expect(travel(m, (150 + gap / 2) / 10)).toBeUndefined()
    // A full cycle later it is back at the start.
    expect(travel(m, (150 + gap) / 10)!.x).toBeCloseTo(0)
  })
})

describe('years', () => {
  it('subtracts spans', () => {
    expect(subtractSpan([[1800, 1900]], [1850, 1860])).toEqual([
      [1800, 1850],
      [1860, 1900]
    ])
    expect(subtractSpan([[1800, 1900]], [1700, 2000])).toEqual([])
    expect(subtractSpan([[1800, 1900]], [1900, 2000])).toEqual([[1800, 1900]])
  })

  it('reads building lives with a gap', () => {
    expect(standingSpans([1860, 1e4, 2019, 2024])).toEqual([
      [1860, 2019],
      [2024, 1e4]
    ])
    expect(standingSpans([-1e4, 1860, 0, 0])).toEqual([[-1e4, 1860]])
  })

  it('keeps a parked vehicle out of a building standing in its years', () => {
    const index = new BuildingIndex([building(-2, -2, 2, 2, [-1e4, 1860, 0, 0])])
    const kept = keepOutOfBuildings([vehicle()], index)
    expect(kept.map((v) => [v.from, v.until])).toEqual([[1860, 1900]])
    // A vehicle well away from it keeps all its years.
    expect(keepOutOfBuildings([vehicle({ x: 30 })], index)[0].from).toBe(1800)
  })

  it('cuts a moving vehicle when a building stands on its route', () => {
    const path = makePath([
      [-50, 0],
      [50, 0]
    ])
    const v = vehicle({ flags: FLAG.moving, move: { path, speed: 2, phase: 0, dir: 1, lane: 0 }, from: 1830, until: 1880 })
    const index = new BuildingIndex([building(-5, -3, 5, 3, [-1e4, 1850, 0, 0])])
    expect(keepOutOfBuildings([v], index).map((x) => [x.from, x.until])).toEqual([[1850, 1880]])
  })

  it('samples the footprint at its corners', () => {
    const pts = footprint({ x: 10, y: 0, heading: Math.PI / 2, length: 4, width: 2 })
    expect(pts).toHaveLength(5)
    const ys = pts.map((p) => p[1])
    expect(Math.max(...ys)).toBeCloseTo(1.7)
  })

  it('uploads only vehicles near the year and inside the detailed ground', () => {
    const box = new Vector4(-100, -100, 100, 100)
    expect(wanted(vehicle(), 1850, box)).toBe(true)
    expect(wanted(vehicle(), 1950, box)).toBe(false)
    expect(wanted(vehicle({ x: 300 }), 1850, box)).toBe(false)
  })
})

describe('data file', () => {
  const data = JSON.parse(readFileSync(new URL('../public/data/3d/vehicles-cite.json', import.meta.url), 'utf8')) as VehicleData

  it('dates every type and keeps each vehicle within its type years', () => {
    const p = data.parked.fields
    for (const r of data.parked.rows) {
      const t = data.types[r[p.indexOf('type')]]
      expect(r[p.indexOf('from')]).toBeGreaterThanOrEqual(t.from)
      expect(r[p.indexOf('until')]).toBeLessThanOrEqual(t.until)
      expect(r[p.indexOf('until')]).toBeGreaterThan(r[p.indexOf('from')])
    }
    for (const t of data.types) expect(t.note, t.id).toBeTruthy()
  })

  it('puts boats on the water level and the rest on the street', () => {
    const v = parseVehicles(data, ([lon, lat]) => [lon * 1000, lat * 1000], -6.6)
    expect(v.length).toBeGreaterThan(1000)
    for (const x of v) expect(x.z).toBe(MODELS[x.type].boat ? -6.6 : 0)
    expect(v.some((x) => x.move)).toBe(true)
  })

  it('shows no motor vehicle before 1898 and no horse omnibus after 1913', () => {
    const p = data.parked.fields
    const motor = new Set(['car_early', 'taxi', 'motorbus', 'van_early', 'car_mid', 'bus_mid', 'van_mid', 'car_modern', 'bus_modern', 'van_modern'])
    for (const r of [...data.parked.rows]) {
      const id = data.types[r[p.indexOf('type')]].id
      if (motor.has(id)) expect(r[p.indexOf('from')]).toBeGreaterThanOrEqual(1898)
      if (id === 'omnibus') expect(r[p.indexOf('until')]).toBeLessThanOrEqual(1913)
    }
  })
})

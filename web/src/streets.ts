/**
 * Streets through time: pavements and kerbs, gutters, crossings, road
 * markings and street furniture for the detailed 3D city, a CityModule
 * (registered in citymodules.ts).
 *
 * Data: python -m rpr streets --area cite (rpr/sources/streets.py), which
 * gives two street networks (the Vasserot streets of about 1836, today's
 * plan de voirie from 1860) and dated furniture. Here every piece is trimmed
 * so that nothing shows inside a building standing that year and no plaque or
 * wall lamp hangs on a missing wall, then drawn in a few meshes:
 *
 * - pavements: raised tops, kerb faces and granite kerb tops (one draw call);
 * - decals on the roadway: gutters, crossings, main roads, centre lines, tree grates (one);
 * - furniture: instanced meshes by kind and era (about seven drawn in any year),
 *   each model switching variant with the year
 *   (oil lantern to gas, stone plaque to enamel, Rambuteau column to Morris).
 *
 * The roadway itself (setts, macadam, asphalt) is drawn by the ground shader
 * with roadSurface() from streetshaders.ts.
 */

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { CityContext, CityModule } from './city3d'
import { normalisePoly, type Poly, type Pt } from './citygen'
import {
  addArea,
  addCentreGutter,
  addCentreLine,
  addCrossing,
  addGrate,
  addPavement,
  avoid,
  Buildings,
  decode,
  inBox,
  ITEM,
  need,
  OPEN,
  PART,
  pavementLife,
  StreetMesh,
  touchesBox,
  triangulate,
  type Life,
  type StreetsData
} from './streetgen'
import * as SS from './streetshaders'

export const STREETS_URL = 'data/3d/streets-cite.json'
const GREENERY_URL = 'data/3d/greenery-cite.json'
/** Pavements bigger than this are squares (the parvis), paved with stone slabs. */
const SQUARE_M2 = 1500
/** Build what lies within this distance of the detailed ground box. */
const MARGIN = 100
/** Items gone by then belong to the old street network (python -m rpr streets: OLD_UNTIL). */
const OLD_NETWORK_UNTIL = 1860

/** Model variants (see variantOf in streetshaders.ts). */
export const VARIANT = {
  ropeLantern: 0,
  bracketLantern: 1,
  potence: 2,
  candelabra: 3,
  pole: 4,
  wallLantern: 5,
  wallModern: 6,
  kerbStone: 7,
  bollard: 8,
  plaqueStone: 9,
  plaqueEnamel: 10,
  rambuteau: 11,
  morris: 12,
  vespasienne: 13,
  wallace: 14,
  kiosk: 15,
  bench: 16
} as const

/** Materials of the furniture shader. */
const MAT = { iron: 0, glass: 1, stone: 2, benchWood: 3, steel: 4, dark: 5, rope: 6, bollard: 7, stonePlaque: 8, enamel: 9, posters: 10, lampHead: 11, black: 12 } as const

/* ------------------------------------------------------------- models */

/** A furniture model built from primitives, z up, facing +x, each part tagged variant * 16 + material. */
class Model {
  private parts: THREE.BufferGeometry[] = []
  constructor(private variant: number) {}

  private push(g: THREE.BufferGeometry, mat: number) {
    g.deleteAttribute('uv')
    const n = g.getAttribute('position').count
    g.setAttribute('a_part', new THREE.Float32BufferAttribute(new Array(n).fill(this.variant * 16 + mat), 1))
    this.parts.push(g)
    return this
  }

  /** A cylinder or cone frustum along z from z0 to z1. */
  cyl(rTop: number, rBottom: number, z0: number, z1: number, mat: number, seg = 6, x = 0, y = 0, turn = 0, open = false) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, z1 - z0, seg, 1, open)
    g.rotateX(Math.PI / 2)
    if (turn) g.rotateZ(turn)
    g.translate(x, y, (z0 + z1) / 2)
    return this.push(g, mat)
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: number) {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0)
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    return this.push(g, mat)
  }

  /** A dome (upper half sphere), squashed by `flat` in z. */
  dome(r: number, x: number, y: number, z: number, mat: number, flat = 1, seg = 6) {
    const g = new THREE.SphereGeometry(r, seg, 3, 0, Math.PI * 2, 0, Math.PI / 2)
    g.rotateX(Math.PI / 2)
    g.scale(1, 1, flat)
    g.translate(x, y, z)
    return this.push(g, mat)
  }

  /** A cylinder wall open on one side (a urinal screen). */
  screen(r: number, z0: number, z1: number, mat: number, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, z1 - z0, seg, 1, true, Math.PI * 0.35, Math.PI * 1.65)
    g.rotateX(Math.PI / 2)
    g.translate(0, 0, (z0 + z1) / 2)
    return this.push(g, mat)
  }

  /** Parts of the variant, ready to merge with others. */
  geometries() {
    return this.parts
  }
}

/** The hanging bell of an oil réverbère, its top at z. */
function bell(m: Model, x: number, z: number) {
  m.box(x - 0.01, x + 0.01, -0.01, 0.01, z, z + 0.7, MAT.black)
  m.cyl(0.02, 0.29, z - 0.2, z, MAT.black, 6, x)
  m.cyl(0.27, 0.18, z - 0.65, z - 0.2, MAT.glass, 6, x)
  m.cyl(0.18, 0.1, z - 0.75, z - 0.65, MAT.black, 6, x)
}

/** A square gas lantern (glass widening upward under a cap), its foot at z. */
function gasLantern(m: Model, x: number, z: number, size = 1) {
  const q = Math.PI / 4
  m.cyl(0.26 * size, 0.15 * size, z, z + 0.52 * size, MAT.glass, 4, x, 0, q)
  m.cyl(0.02, 0.3 * size, z + 0.52 * size, z + 0.7 * size, MAT.iron, 4, x, 0, q)
  m.cyl(0.12 * size, 0.06, z - 0.12, z, MAT.iron, 4, x, 0, q)
}

const MODELS: Record<number, () => Model> = {
  [VARIANT.ropeLantern]: () => {
    const m = new Model(VARIANT.ropeLantern)
    m.box(-1, 1, -0.012, 0.012, 5.98, 6.02, MAT.rope)
    bell(m, 0, 5.3)
    return m
  },
  [VARIANT.bracketLantern]: () => {
    const m = new Model(VARIANT.bracketLantern)
    m.box(-0.05, 0, -0.08, 0.08, 4.0, 4.6, MAT.black)
    m.box(-0.95, 0, -0.025, 0.025, 4.48, 4.53, MAT.iron)
    m.box(-0.5, 0, -0.02, 0.02, 4.15, 4.19, MAT.iron)
    gasLantern(m, -0.9, 3.85, 0.85)
    return m
  },
  [VARIANT.potence]: () => {
    const m = new Model(VARIANT.potence)
    m.cyl(0.07, 0.1, 0, 5.4, MAT.black, 6)
    m.box(0, 1.35, -0.03, 0.03, 5.2, 5.27, MAT.black)
    m.box(0, 0.7, -0.025, 0.025, 4.85, 4.9, MAT.black)
    bell(m, 1.25, 4.5)
    return m
  },
  [VARIANT.candelabra]: () => {
    const m = new Model(VARIANT.candelabra)
    m.cyl(0.18, 0.24, 0, 0.65, MAT.iron, 6)
    m.cyl(0.06, 0.09, 0.65, 3.0, MAT.iron, 5)
    m.box(-0.32, 0.32, -0.02, 0.02, 2.62, 2.66, MAT.iron)
    m.cyl(0.05, 0.1, 3.0, 3.25, MAT.iron, 4)
    gasLantern(m, 0, 3.25)
    return m
  },
  [VARIANT.pole]: () => {
    const m = new Model(VARIANT.pole)
    m.cyl(0.06, 0.09, 0, 8.0, MAT.steel)
    m.box(0, 1.2, -0.03, 0.03, 7.9, 7.98, MAT.steel)
    m.box(0.9, 1.6, -0.17, 0.17, 7.82, 7.94, MAT.steel)
    m.box(0.95, 1.55, -0.13, 0.13, 7.8, 7.82, MAT.lampHead)
    return m
  },
  [VARIANT.wallLantern]: () => {
    const m = new Model(VARIANT.wallLantern)
    m.box(0, 0.04, -0.08, 0.08, 4.3, 4.95, MAT.black)
    m.box(0, 0.85, -0.025, 0.025, 4.88, 4.93, MAT.iron)
    m.box(0, 0.45, -0.02, 0.02, 4.55, 4.59, MAT.iron)
    gasLantern(m, 0.8, 4.2, 0.85)
    return m
  },
  [VARIANT.wallModern]: () => {
    const m = new Model(VARIANT.wallModern)
    m.box(0, 1.1, -0.03, 0.03, 4.75, 4.82, MAT.steel)
    m.box(0.75, 1.35, -0.14, 0.14, 4.66, 4.78, MAT.steel)
    m.box(0.8, 1.3, -0.1, 0.1, 4.64, 4.66, MAT.lampHead)
    return m
  },
  [VARIANT.kerbStone]: () => new Model(VARIANT.kerbStone).cyl(0.15, 0.22, 0, 0.55, MAT.stone, 5).cyl(0.04, 0.15, 0.55, 0.68, MAT.stone, 5),
  // Thousands of these: a few triangles each.
  [VARIANT.bollard]: () => new Model(VARIANT.bollard).cyl(0.045, 0.07, 0, 0.92, MAT.bollard, 5),
  [VARIANT.plaqueStone]: () => new Model(VARIANT.plaqueStone).box(0, 0.05, -0.42, 0.42, 3.3, 3.74, MAT.stonePlaque),
  [VARIANT.plaqueEnamel]: () => new Model(VARIANT.plaqueEnamel).box(0, 0.02, -0.29, 0.29, 3.41, 3.64, MAT.enamel),
  [VARIANT.rambuteau]: () => {
    const m = new Model(VARIANT.rambuteau)
    m.cyl(0.48, 0.48, 0, 0.5, MAT.iron, 10)
    m.cyl(0.42, 0.42, 0.5, 2.4, MAT.posters, 10)
    m.cyl(0.5, 0.45, 2.4, 2.6, MAT.iron, 10)
    m.cyl(0.05, 0.45, 2.6, 3.1, MAT.iron, 10)
    m.box(0.36, 0.47, -0.22, 0.22, 0.05, 1.9, MAT.dark)
    gasLantern(m, 0, 3.1, 0.6)
    return m
  },
  [VARIANT.morris]: () =>
    new Model(VARIANT.morris)
      .cyl(0.66, 0.7, 0, 0.45, MAT.iron, 12)
      .cyl(0.6, 0.6, 0.45, 2.7, MAT.posters, 12)
      .cyl(0.72, 0.62, 2.7, 2.88, MAT.iron, 12)
      .dome(0.62, 0, 0, 2.88, MAT.iron, 0.6, 12)
      .cyl(0.02, 0.07, 3.25, 3.55, MAT.iron, 6),
  [VARIANT.vespasienne]: () =>
    new Model(VARIANT.vespasienne)
      .screen(0.95, 0.3, 2.0, MAT.iron)
      .cyl(0.07, 0.07, 0, 2.5, MAT.iron, 6)
      .cyl(0.15, 1.15, 2.25, 2.65, MAT.iron, 12)
      .cyl(0.12, 0.08, 2.65, 2.95, MAT.glass, 4),
  [VARIANT.wallace]: () => {
    const m = new Model(VARIANT.wallace)
    m.cyl(0.42, 0.5, 0, 0.35, MAT.iron)
    m.cyl(0.34, 0.38, 0.35, 0.95, MAT.iron)
    for (const [x, y] of [
      [0.18, 0.18],
      [-0.18, 0.18],
      [-0.18, -0.18],
      [0.18, -0.18]
    ])
      m.cyl(0.06, 0.08, 0.95, 2.0, MAT.iron, 6, x, y)
    m.cyl(0.44, 0.4, 1.98, 2.06, MAT.iron, 8)
    m.dome(0.42, 0, 0, 2.06, MAT.iron, 0.75, 8)
    m.cyl(0.02, 0.07, 2.36, 2.7, MAT.iron, 5)
    return m
  },
  [VARIANT.kiosk]: () =>
    new Model(VARIANT.kiosk)
      .cyl(1.05, 1.05, 0, 2.15, MAT.iron, 8)
      .cyl(1.08, 1.08, 1.75, 2.15, MAT.posters, 8)
      .cyl(0.12, 1.35, 2.2, 2.75, MAT.iron, 8)
      .cyl(0.06, 0.08, 2.75, 3.1, MAT.iron, 6)
      .box(0.9, 1.08, -0.55, 0.55, 0.9, 1.65, MAT.dark),
  [VARIANT.bench]: () =>
    new Model(VARIANT.bench)
      .box(-0.2, 0.25, -0.9, 0.9, 0.42, 0.47, MAT.benchWood)
      .box(-0.27, -0.21, -0.9, 0.9, 0.55, 0.95, MAT.benchWood)
      .box(-0.27, 0.25, 0.71, 0.78, 0, 0.45, MAT.iron)
      .box(-0.27, 0.25, -0.78, -0.71, 0, 0.45, MAT.iron)
      .box(-0.27, -0.21, 0.71, 0.78, 0.45, 0.95, MAT.iron)
      .box(-0.27, -0.21, -0.78, -0.71, 0.45, 0.95, MAT.iron)
}

/** The furniture meshes: which item types each draws, and the variants it needs. */
const GROUPS: { name: string; types: number[]; variants: number[] }[] = [
  { name: 'lanterns', types: [ITEM.lantern], variants: [VARIANT.ropeLantern, VARIANT.bracketLantern] },
  { name: 'potences', types: [ITEM.potence], variants: [VARIANT.potence] },
  { name: 'candelabra', types: [ITEM.candelabra], variants: [VARIANT.candelabra] },
  { name: 'poles', types: [ITEM.pole], variants: [VARIANT.pole] },
  { name: 'wall lamps', types: [ITEM.wallLamp], variants: [VARIANT.wallLantern, VARIANT.wallModern] },
  { name: 'bollards', types: [ITEM.bollard], variants: [VARIANT.bollard] },
  { name: 'corners', types: [ITEM.kerbStone, ITEM.plaque], variants: [VARIANT.kerbStone, VARIANT.plaqueStone, VARIANT.plaqueEnamel] },
  { name: 'benches', types: [ITEM.bench], variants: [VARIANT.bench] },
  { name: 'monuments', types: [ITEM.column, ITEM.vespasienne, ITEM.wallace, ITEM.kiosk], variants: [VARIANT.rambuteau, VARIANT.morris, VARIANT.vespasienne, VARIANT.wallace, VARIANT.kiosk] }
]

/** Merged geometry of the given variants. */
export function modelGeometry(variants: number[]): THREE.BufferGeometry {
  const parts = variants.flatMap((v) => MODELS[v]().geometries())
  const g = mergeGeometries(parts)
  if (!g) throw new Error('streets: could not merge furniture models')
  return g
}

/* ------------------------------------------------------------- data */

interface ModelFeature {
  geometry: { type: string; coordinates: unknown }
  properties: { kind?: string; from?: number; until?: number; focus?: boolean }
}

/** Years a model building stands (as lifeOf in city3d.ts). */
function buildingLife(p: ModelFeature['properties']): Life {
  if (p.kind === 'standing') return [-OPEN, OPEN, 0, 0]
  if (p.kind === 'reconstructed') return [-OPEN, p.until ?? 1860, 0, 0]
  return [p.from ?? 1851, OPEN, 0, 0]
}

/** Every building of the model near the box: the detailed ones as built (modules may have changed them), the rest from the model file. */
function buildingsOf(ctx: CityContext, box: [number, number, number, number]): Buildings {
  const b = new Buildings()
  ctx.buildings.specs.forEach((s) => b.add(s.polys, s.life))
  for (const f of ctx.model.features as unknown as ModelFeature[]) {
    if (f.properties.focus) continue
    const g = f.geometry
    if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') continue
    const list = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
    const first = ctx.project(list[0][0][0])
    if (!inBox(first, box, MARGIN + 150)) continue
    const polys = list.map((rings) => normalisePoly(rings.map((r) => r.map(ctx.project)))).filter((p): p is Poly => p !== null)
    b.add(polys, buildingLife(f.properties))
  }
  return b
}

interface Greenery {
  trees: { fields: string[]; rows: number[][] }
}

export interface BuiltStreets {
  pavements: StreetMesh
  decals: StreetMesh
  /** Per furniture group and era: instance attributes, and the years any of them shows. */
  furniture: { group: number; era: number; inst: number[]; life: number[]; type: number[]; span: [number, number] }[]
  counts: Record<string, number>
}

/** Turn the streets file into mesh arrays, trimmed against the buildings. */
export function buildStreets(data: StreetsData, project: (lonlat: number[]) => Pt, buildings: Buildings, box: [number, number, number, number], greenery?: Greenery): BuiltStreets {
  const { origin, scale } = data.metadata
  const pts = (values: number[]) => decode(values, origin, scale).map(project)
  const pavements = new StreetMesh()
  const decals = new StreetMesh()
  const counts: Record<string, number> = {}
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)

  for (const [kind, from, until, rings, kerbs] of data.pavements.rows) {
    const pr = rings.map(pts)
    if (!pr.length || !touchesBox(pr[0], box, MARGIN)) continue
    const tris = triangulate(pr)
    if (!tris.length) continue
    const life = pavementLife([from, until], tris, buildings)
    if (!life) continue
    let area = 0
    for (const t of tris) area += Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2
    const part = kind === 0 ? PART.oldSlabs : area > SQUARE_M2 ? PART.square : PART.asphaltPavement
    addPavement(pavements, decals, pr, kerbs, part, life, tris)
    count('pavements')
  }
  for (const [from, until, line] of data.gutters.rows) {
    const p = pts(line)
    if (!touchesBox(p, box, MARGIN)) continue
    addCentreGutter(decals, p, (mid) => avoid([from, until], buildings.at(mid)))
    count('gutters')
  }
  for (const [from, rings] of data.main_roads.rows) {
    const pr = rings.map(pts)
    if (!touchesBox(pr[0], box, MARGIN)) continue
    addArea(decals, pr, PART.mainRoad, [from, OPEN, 0, 0])
  }
  for (const [from, angle, ring] of data.crossings.rows) {
    const p = pts(ring)
    if (!touchesBox(p, box, MARGIN)) continue
    const c: Pt = [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]
    const life = avoid([from, OPEN], buildings.at(c))
    if (life) addCrossing(decals, p, angle, life)
    count('crossings')
  }
  for (const [from, line] of data.centre_lines.rows) {
    const p = pts(line)
    if (touchesBox(p, box, MARGIN)) addCentreLine(decals, p, [from, OPEN, 0, 0])
  }
  if (greenery) {
    const f = greenery.trees.fields
    const [lon, lat, planted, inGarden] = ['lon', 'lat', 'planted', 'in_garden'].map((k) => f.indexOf(k))
    for (const r of greenery.trees.rows) {
      if (inGarden >= 0 && r[inGarden]) continue
      const c = project([r[lon], r[lat]])
      if (!inBox(c, box, MARGIN)) continue
      const life = avoid([r[planted], OPEN], buildings.at(c))
      if (life) addGrate(decals, c, 0.85, life)
    }
  }

  // Furniture: one instance per item, in the group that draws its type, split
  // into the old network and the rest so that a whole mesh can be skipped.
  const furniture = GROUPS.flatMap((_, gi) => [0, 1].map((era) => ({ group: gi, era, inst: [] as number[], life: [] as number[], type: [] as number[], span: [OPEN, -OPEN] as [number, number] })))
  const groupOf = new Map<number, number>()
  GROUPS.forEach((g, i) => g.types.forEach((t) => groupOf.set(t, i)))
  for (const [type, from, until, xy, angles, params] of data.items.rows) {
    const gi = groupOf.get(type)
    if (gi === undefined) continue
    const out = furniture[gi * 2 + (until <= OLD_NETWORK_UNTIL ? 0 : 1)]
    decode(xy, origin, scale).forEach((ll, i) => {
      const p = project(ll)
      if (!inBox(p, box, MARGIN)) return
      let a = ((angles[i] ?? 0) * Math.PI) / 180
      const param = params[i] ?? 0
      let life: Life | null
      if (type === ITEM.plaque || type === ITEM.wallLamp) {
        // On a wall: shown only while the building behind it stands.
        life = need([from, until], buildings.at([p[0] - Math.cos(a) * 0.5, p[1] - Math.sin(a) * 0.5]))
      } else {
        life = avoid([from, until], buildings.at(p))
      }
      if (!life) return
      if (type === ITEM.lantern) a += Math.PI / 2 // the rope runs across the street
      out.inst.push(p[0], p[1], a, param)
      out.life.push(...life)
      out.type.push(type)
      out.span[0] = Math.min(out.span[0], life[0])
      out.span[1] = Math.max(out.span[1], life[1])
      count(`item ${type}`)
    })
  }
  return { pavements, decals, furniture, counts }
}

/* ------------------------------------------------------------- meshes */

function streetGeometry(m: StreetMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.position, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normal, 3))
  g.setAttribute('a_d', new THREE.Float32BufferAttribute(m.d, 4))
  g.setAttribute('a_life', new THREE.Float32BufferAttribute(m.life, 4))
  g.computeBoundingSphere()
  return g
}

function instanced(base: THREE.BufferGeometry, f: BuiltStreets['furniture'][number]): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry()
  g.index = base.index
  for (const name of ['position', 'normal', 'a_part']) g.setAttribute(name, base.getAttribute(name))
  g.setAttribute('a_inst', new THREE.InstancedBufferAttribute(new Float32Array(f.inst), 4))
  g.setAttribute('a_ilife', new THREE.InstancedBufferAttribute(new Float32Array(f.life), 4))
  g.setAttribute('a_type', new THREE.InstancedBufferAttribute(new Float32Array(f.type), 1))
  g.instanceCount = f.type.length
  return g
}

const streets: CityModule = {
  name: 'streets',
  async build(ctx: CityContext) {
    const [data, greenery] = await Promise.all([
      fetch(`${ctx.base}${STREETS_URL}`).then((r) => {
        if (!r.ok) throw new Error(`streets: ${r.status}`)
        return r.json() as Promise<StreetsData>
      }),
      fetch(`${ctx.base}${GREENERY_URL}`)
        .then((r) => (r.ok ? (r.json() as Promise<Greenery>) : undefined))
        .catch(() => undefined)
    ])
    const b = ctx.uniforms.u_box.value
    const box: [number, number, number, number] = [b.x, b.y, b.z, b.w]
    const built = buildStreets(data, ctx.project, buildingsOf(ctx, box), box, greenery)
    const u = ctx.uniforms

    const pavement = new THREE.Mesh(
      streetGeometry(built.pavements),
      new THREE.ShaderMaterial({ vertexShader: SS.pavementVertex, fragmentShader: SS.pavementFragment, uniforms: u, side: THREE.DoubleSide, transparent: true })
    )
    pavement.renderOrder = 1.4
    const decals = new THREE.Mesh(
      streetGeometry(built.decals),
      new THREE.ShaderMaterial({
        vertexShader: SS.decalVertex,
        fragmentShader: SS.decalFragment,
        uniforms: u,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4
      })
    )
    decals.renderOrder = 1.2
    for (const mesh of [pavement, decals]) {
      mesh.frustumCulled = false
      if (mesh.geometry.getAttribute('position').count) ctx.add(mesh)
    }
    const material = new THREE.ShaderMaterial({ vertexShader: SS.furnitureVertex, fragmentShader: SS.furnitureFragment, uniforms: u, side: THREE.DoubleSide })
    const models = new Map<number, THREE.BufferGeometry>()
    const timed: { mesh: THREE.Mesh; span: [number, number] }[] = []
    for (const f of built.furniture) {
      if (!f.type.length) continue
      const group = GROUPS[f.group]
      if (!models.has(f.group)) models.set(f.group, modelGeometry(group.variants))
      const mesh = new THREE.Mesh(instanced(models.get(f.group)!, f), material)
      mesh.frustumCulled = false
      mesh.renderOrder = 2.5
      ctx.add(mesh)
      timed.push({ mesh, span: f.span })
    }
    // Skip whole meshes whose items all stand in other years (the old network today, for instance).
    ctx.animate(() => {
      const year = u.u_year.value
      for (const t of timed) t.mesh.visible = year >= t.span[0] && year < t.span[1]
      return false
    })
    console.info('streets:', built.counts)
  }
}

export default streets

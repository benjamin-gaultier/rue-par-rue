/**
 * The Île de la Cité's landmarks through time, as a city module.
 *
 * Data: python -m rpr landmarks (web/public/data/3d/landmarks-cite.json),
 * which finds the landmark buildings of the model by name and location and
 * dates them from history (sources in rpr/sources/landmarks.py and the README).
 *
 * prepare: gives the Palais de Justice, the Conciergerie, the Tribunal de
 *   commerce, the Préfecture de police, the Hôtel-Dieu, the place Dauphine
 *   and the flower market their own facades (landmarkshaders.ts) and dates;
 *   keeps the old Palais standing until the wing built on its site, and the
 *   east side of the place Dauphine until 1874; hides the Sainte-Chapelle's
 *   footprint to draw it in full.
 * build: the Sainte-Chapelle and its spires, the towers of the quai de
 *   l'Horloge, the dome of the Tribunal de commerce, Henri IV on the Pont
 *   Neuf (1614-1792, then from 1818), the two morgues, the flower market's
 *   stalls and pavilions, Notre-Dame's flying buttresses. Three merged meshes,
 *   three draw calls.
 */

import * as THREE from 'three'
import type { CityContext, CityModule, CityProps } from './city3d'
import { addBuilding, insidePoly, MeshData, normalisePoly, polyBbox, ROOF_MATERIAL, type BuildingSpec, type Poly, type Pt, type RoofShape } from './citygen'
import * as S from './cityshaders'
import * as G from './landmarkgen'
import { propFragment, propVertex } from './landmarkshaders'

export const LANDMARKS_URL = 'data/3d/landmarks-cite.json'

type LonLat = [number, number]
type Life = G.Life

export interface BuildingRule {
  id: string
  landmark?: string
  style?: number
  from?: number
  until?: number
  roof?: RoofShape
  roof_material?: keyof typeof ROOF_MATERIAL
  height?: number
  /** Drawn in full by this module: the footprint is hidden. */
  draw?: 'custom'
  /** The old buildings on its site stand until it is built. */
  replaces?: boolean
  note?: string
}

interface Dated {
  name?: string
  from?: number | null
  until?: number | null
  note?: string
}

export type Part =
  | ({ kind: 'chapel'; centre: LonLat; bearing: number; length: number; width: number; eave: number; ridge: number; porch: [number, number]; spires: { tip: number; from: number | null; until: number | null }[] } & Dated)
  | ({ kind: 'tower'; at: LonLat; radius: number; wall: number; tip: number; roof: 'cone' | 'battlements' } & Dated)
  | ({ kind: 'square-tower'; corners: LonLat[]; wall: number; roof_tip: number; tip: number; clock?: { facing: Pt; z: number } } & Dated)
  | ({ kind: 'dome'; at: LonLat; radius: number; rotation: number; drum_base: number; drum_top: number; dome_top: number; lantern: number } & Dated)
  | ({ kind: 'statue'; at: LonLat; heading: number; variant: number } & Dated)
  | ({ kind: 'building'; polygon: LonLat[]; height: number; roof: RoofShape; roof_material: keyof typeof ROOF_MATERIAL; style: number } & Dated)
  | ({ kind: 'pavilions'; ids: string[]; height: number; style: number } & Dated)
  | ({ kind: 'stalls'; items: [LonLat, number, number][] } & Dated)
  | ({ kind: 'flyers'; items: [LonLat, LonLat, number, number, number][] } & Dated)

export interface LandmarkFile {
  metadata?: { styles?: Record<string, number>; notes?: string[] }
  buildings: BuildingRule[]
  vasserot: { parcels: string[]; until: number; note?: string }[]
  parts: Part[]
}

/** The Vasserot parcel of a reconstructed building id ("vasserot:PA3418:2" is a lot of PA3418). */
export function parcelOf(id: string): string {
  return id.replace(/^vasserot:/, '').split(':')[0]
}

function ringCentroid(ring: Pt[]): Pt {
  let a = 0
  let x = 0
  let y = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    a += f
    x += (ring[j][0] + ring[i][0]) * f
    y += (ring[j][1] + ring[i][1]) * f
  }
  if (Math.abs(a) < 1e-9) return ring[0]
  return [x / (3 * a), y / (3 * a)]
}

/** Points spread over a footprint: each outline's centroid, and its corners pulled a third of the way in. */
export function samplePoints(polys: Poly[]): Pt[] {
  const out: Pt[] = []
  for (const poly of polys) {
    const c = ringCentroid(poly[0])
    out.push(c)
    for (const p of poly[0]) out.push([p[0] + (c[0] - p[0]) * 0.35, p[1] + (c[1] - p[1]) * 0.35])
  }
  return out
}

/**
 * The year a building gives way to the newer building that covers most of
 * its footprint (half its sample points at least), if any.
 */
export function replacedUntil(polys: Poly[], newer: { polys: Poly[]; bbox: [number, number, number, number]; from: number }[]): number | undefined {
  const pts = samplePoints(polys)
  if (!pts.length) return undefined
  let best: { n: number; from: number } | undefined
  for (const b of newer) {
    let n = 0
    for (const p of pts) {
      if (p[0] < b.bbox[0] || p[0] > b.bbox[2] || p[1] < b.bbox[1] || p[1] > b.bbox[3]) continue
      if (b.polys.some((poly) => insidePoly(p, poly))) n++
    }
    if (n && (!best || n > best.n)) best = { n, from: b.from }
  }
  return best && best.n >= pts.length / 2 ? best.from : undefined
}

export interface Applied {
  /** Buildings whose years changed, with the years the model gave them. */
  changed: Map<number, Life>
  /** Buildings this module draws itself, with their footprints. */
  hidden: { index: number; polys: Poly[] }[]
}

/** Give landmark buildings their styles, roofs and dates; date the old buildings they replaced. */
export function applyLandmarks(specs: BuildingSpec[], props: Pick<CityProps, 'id' | 'kind'>[], file: LandmarkFile): Applied {
  const index = new Map(props.map((p, i) => [p.id, i]))
  const changed = new Map<number, Life>()
  const hidden: Applied['hidden'] = []
  const remember = (i: number) => {
    if (!changed.has(i)) changed.set(i, [...specs[i].life])
  }
  for (const rule of file.buildings) {
    const i = index.get(rule.id)
    if (i === undefined) continue
    const s = specs[i]
    if (rule.style !== undefined) s.style = rule.style
    if (rule.roof) s.roof = rule.roof
    if (rule.roof_material && rule.roof_material in ROOF_MATERIAL) s.roofMaterial = ROOF_MATERIAL[rule.roof_material]
    if (rule.height) s.height = rule.height
    if (rule.from !== undefined || rule.until !== undefined) {
      remember(i)
      s.life = [rule.from ?? s.life[0], rule.until ?? s.life[1], s.life[2], s.life[3]]
    }
    if (rule.draw === 'custom') {
      hidden.push({ index: i, polys: s.polys })
      s.polys = []
    }
  }
  const newer = file.buildings
    .filter((r) => r.replaces)
    .map((r) => index.get(r.id))
    .filter((i): i is number => i !== undefined && specs[i].polys.length > 0)
    .map((i) => ({ polys: specs[i].polys, bbox: polyBbox(specs[i].polys), from: specs[i].life[0] }))
  const parcelUntil = new Map<string, number>()
  for (const v of file.vasserot ?? []) for (const p of v.parcels) parcelUntil.set(p, v.until)
  props.forEach((p, i) => {
    if (p.kind !== 'reconstructed') return
    const s = specs[i]
    let until = parcelUntil.get(parcelOf(p.id))
    if (until === undefined && newer.length) {
      const bb = polyBbox(s.polys)
      const near = newer.filter((b) => b.bbox[0] <= bb[2] && b.bbox[2] >= bb[0] && b.bbox[1] <= bb[3] && b.bbox[3] >= bb[1])
      if (near.length) until = replacedUntil(s.polys, near)
    }
    if (until !== undefined && until !== s.life[1]) {
      remember(i)
      s.life = [s.life[0], until, s.life[2], s.life[3]]
    }
  })
  return { changed, hidden }
}

function aliveIn(life: Life, year: number): boolean {
  return year >= life[0] && year < life[1] && !(year >= life[2] && year < life[3])
}

function geometry(m: MeshData): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.position, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normal, 3))
  g.setAttribute('a_a', new THREE.Float32BufferAttribute(m.a, 4))
  g.setAttribute('a_b', new THREE.Float32BufferAttribute(m.b, 4))
  g.setAttribute('a_life', new THREE.Float32BufferAttribute(m.life, 4))
  g.computeBoundingSphere()
  return g
}

interface Blocker {
  polys: Poly[]
  bbox: [number, number, number, number]
  /** Blocks in the years this is true. */
  when: (year: number) => boolean
}

let file: LandmarkFile | undefined
let applied: Applied | undefined

/** Build every dated part into three meshes; returns what blocks the way. */
export function buildParts(
  parts: Part[],
  project: (ll: number[]) => Pt,
  footprint: (id: string) => Poly[] | undefined,
  meshes: { walls: MeshData; roofs: MeshData; props: MeshData }
): Blocker[] {
  const { walls, roofs, props } = meshes
  const blockers: Blocker[] = []
  const block = (polys: Poly[], life: Life) => {
    if (polys.length) blockers.push({ polys, bbox: polyBbox(polys), when: (y) => aliveIn(life, y) })
  }
  for (const part of parts) {
    const life = G.lifeOf(part.from, part.until)
    try {
      switch (part.kind) {
        case 'chapel':
          G.addChapel(walls, roofs, props, { ...part, centre: project(part.centre) })
          break
        case 'tower':
          G.addRoundTower(walls, roofs, { at: project(part.at), radius: part.radius, wall: part.wall, tip: part.tip, roof: part.roof }, life)
          break
        case 'square-tower':
          G.addSquareTower(walls, roofs, props, { corners: part.corners.map(project), wall: part.wall, roofTip: part.roof_tip, tip: part.tip, clock: part.clock }, life)
          break
        case 'dome':
          G.addDome(walls, roofs, props, { ...part, at: project(part.at) }, life)
          break
        case 'statue': {
          const at = project(part.at)
          G.addStatue(props, at, part.heading, part.variant, life)
          const f = G.frame(at, part.heading)
          block([[[f.at(-3.4, -1.8), f.at(3.4, -1.8), f.at(3.4, 1.8), f.at(-3.4, 1.8)]]], life)
          break
        }
        case 'building': {
          const poly = normalisePoly([part.polygon.map(project)])
          if (!poly) break
          const spec: BuildingSpec = { polys: [poly], height: part.height, roof: part.roof, roofMaterial: ROOF_MATERIAL[part.roof_material] ?? ROOF_MATERIAL.zinc, style: part.style, seed: 0.5, life }
          addBuilding(spec, -1, walls, roofs)
          block(spec.polys, life)
          break
        }
        case 'pavilions': {
          const polys = part.ids.flatMap((id) => footprint(id) ?? [])
          for (const [k, poly] of polys.entries()) {
            addBuilding({ polys: [poly], height: part.height, roof: 'hip', roofMaterial: ROOF_MATERIAL.zinc, style: part.style, seed: (k + 0.5) / polys.length, life }, -1, walls, roofs)
          }
          block(polys, life)
          break
        }
        case 'stalls':
          // The data's grid, loosened: some stalls left out, the rest nudged and turned.
          part.items.forEach(([at, from, until], k) => {
            const h = (n: number) => (((Math.sin((k + 1) * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1
            if (h(0) < 0.3) return
            const [x, y] = project(at)
            G.addStall(props, [x + (h(1) - 0.5) * 1.6, y + (h(2) - 0.5) * 1.6], h(3), G.lifeOf(from, until))
          })
          break
        case 'flyers':
          for (const [foot, head, footZ, headZ, apse] of part.items) G.addFlyer(walls, roofs, { foot: project(foot), head: project(head), footZ, headZ, apse: apse > 0 })
          break
      }
    } catch (err) {
      console.warn(`Landmark part ${part.name ?? part.kind} skipped:`, err)
    }
  }
  return blockers
}

const landmarks: CityModule = {
  name: 'landmarks',

  async prepare(ctx) {
    const res = await fetch(`${ctx.base}${LANDMARKS_URL}`)
    if (!res.ok) throw new Error(`landmarks: ${res.status} for ${LANDMARKS_URL}`)
    file = (await res.json()) as LandmarkFile
    applied = applyLandmarks(ctx.buildings.specs, ctx.buildings.props, file)
  },

  build(ctx: CityContext) {
    if (!file || !applied) return
    const { specs, props } = ctx.buildings
    const index = new Map(props.map((p, i) => [p.id, i]))
    const meshes = { walls: new MeshData(), roofs: new MeshData(), props: new MeshData() }
    const blockers = buildParts(file.parts, ctx.project, (id) => {
      const i = index.get(id)
      return i === undefined ? undefined : specs[i].polys
    }, meshes)
    // Buildings standing longer than the model says block the way in those years.
    for (const [i, before] of applied.changed) {
      const s = specs[i]
      if (!s.polys.length) continue
      blockers.push({ polys: s.polys, bbox: polyBbox(s.polys), when: (y) => aliveIn(s.life, y) && !aliveIn(before, y) })
    }
    const materials: [MeshData, string, string, number][] = [
      [meshes.walls, S.wallVertex, S.wallFragment, 2],
      [meshes.roofs, S.roofVertex, S.roofFragment, 3],
      [meshes.props, propVertex, propFragment, 2]
    ]
    for (const [data, vs, fs, order] of materials) {
      if (!data.triangles) continue
      const m = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: ctx.uniforms, side: THREE.DoubleSide, transparent: true })
      const mesh = new THREE.Mesh(geometry(data), m)
      mesh.renderOrder = order
      mesh.frustumCulled = false
      mesh.name = `landmarks-${order}`
      ctx.add(mesh)
    }
    if (blockers.length)
      ctx.block((p, year) => {
        for (const b of blockers) {
          if (p[0] < b.bbox[0] || p[0] > b.bbox[2] || p[1] < b.bbox[1] || p[1] > b.bbox[3]) continue
          if (b.when(year) && b.polys.some((poly) => insidePoly(p, poly))) return true
        }
        return false
      })
  }
}

export default landmarks

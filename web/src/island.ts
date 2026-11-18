/**
 * The whole island, for walking: houses on the bridges until they were
 * cleared, and where one can walk in a given year.
 *
 * - Houses: the Pont Notre-Dame, the Pont au Change and the Pont Saint-Michel
 *   carried rows of narrow houses until 1786-1808 (dates in the site file's
 *   bridge histories). They are added as old houses (facade style 0, tile
 *   gable roofs) on both sides of the roadway, in the years they stood.
 * - Bridges through time: the core city lets walkers onto any deck; here a
 *   deck over the water blocks the way in the years no bridge stood there,
 *   and outside the narrower width of footbridges.
 * - Bounds: walking stops WALK_MARGIN_M inside the ground box, before the
 *   detailed ground fades out.
 */

import type { CityContext, CityModule, CityProps, PrepareContext } from './city3d'
import { bridgeHouses, deckFrame, deckRect, standsIn, widthOf, type BridgeGeneration, type BridgeHouse, type BridgeProps } from './bridges'
import { insidePoly, normalisePoly, ROOF_MATERIAL, STYLE, type Poly, type Pt } from './citygen'

/** Walking stops this far inside the ground box (the detail fades over its outer 70 m). */
export const WALK_MARGIN_M = 60

type Box = [number, number, number, number]

/** One crossing of the water, with the walkable deck of each structure that stood there. */
export interface Crossing {
  name: string
  deck: Poly
  bbox: Box
  generations: { g: BridgeGeneration; rect: Poly }[]
}

function bboxOf(poly: Poly): Box {
  const xs = poly[0].map((p) => p[0])
  const ys = poly[0].map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

const inBox = (p: Pt, b: Box) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]

/** The crossings in the site file's features, in local metres. */
export function crossingsOf(features: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[], project: (lonlat: number[]) => Pt): Crossing[] {
  const out: Crossing[] = []
  for (const f of features) {
    const props = f.properties as unknown as BridgeProps
    if (props.kind !== 'bridge') continue
    const g = f.geometry
    const list = (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []) as number[][][][]
    for (const rings of list) {
      const deck = normalisePoly(rings.map((r) => r.map((c) => project(c))))
      if (!deck) continue
      const frame = deckFrame(deck)
      const generations = (props.history ?? []).map((gen) => {
        const h = widthOf(gen, frame) / 2
        return { g: gen, rect: deckRect(frame, -frame.halfLen, frame.halfLen, -h, h) }
      })
      out.push({ name: `${props.name}${props.span ? ` ${props.span}` : ''}`, deck, bbox: bboxOf(deck), generations })
    }
  }
  return out
}

/**
 * Whether a point on a deck can be walked in `year`: on the deck of a
 * structure standing that year. Undefined when the point is on no deck.
 */
export function onStandingBridge(crossings: Crossing[], p: Pt, year: number): boolean | undefined {
  let onDeck = false
  for (const c of crossings) {
    if (!inBox(p, c.bbox) || !insidePoly(p, c.deck)) continue
    onDeck = true
    if (c.generations.some(({ g, rect }) => standsIn(g, year) && insidePoly(p, rect))) return true
  }
  return onDeck ? false : undefined
}

/** True inside the ground box (x0, y0, x1, y1) shrunk by `margin`. */
export function insideWalkBounds(box: Box, p: Pt, margin = WALK_MARGIN_M): boolean {
  return p[0] > box[0] + margin && p[0] < box[2] - margin && p[1] > box[1] + margin && p[1] < box[3] - margin
}

/** Houses of every crossing that carried them, with the props the building popup shows. */
export function housesOf(crossings: Crossing[]): { house: BridgeHouse; props: CityProps }[] {
  const out: { house: BridgeHouse; props: CityProps }[] = []
  for (const c of crossings) {
    for (const { g } of c.generations) {
      bridgeHouses(c.deck, g, c.name).forEach((house, i) => {
        const gone = g.houses_until!
        out.push({
          house,
          props: {
            id: `bridge-house:${c.name}:${i}`,
            kind: 'reconstructed',
            height: house.height,
            until: gone,
            period: `on the bridge until ${gone - 1}`,
            name: `House on the ${c.name.replace(/ \d+$/, '')}`,
            note: `Stood on the bridge until it was cleared (gone by ${gone})`,
            source: 'Rows of houses generated on the bridge deck: their number where known, facades and heights estimated',
            roof: 'gable',
            roof_material: 'tile',
            landmark: false,
            focus: true
          }
        })
      })
    }
  }
  return out
}

const sites = new WeakMap<object, { crossings: Crossing[]; houses: BridgeHouse[] }>()

function stateOf(ctx: PrepareContext) {
  let s = sites.get(ctx.site)
  if (!s) {
    s = { crossings: crossingsOf(ctx.site.features as never, ctx.project), houses: [] }
    sites.set(ctx.site, s)
  }
  return s
}

const island: CityModule = {
  name: 'island',

  prepare(ctx) {
    const s = stateOf(ctx)
    for (const { house, props } of housesOf(s.crossings)) {
      ctx.buildings.specs.push({
        polys: [house.poly],
        height: house.height,
        roof: 'gable',
        roofMaterial: ROOF_MATERIAL.tile,
        style: STYLE.old,
        seed: house.seed,
        life: house.life
      })
      ctx.buildings.props.push(props)
      s.houses.push(house)
    }
  },

  build(ctx: CityContext) {
    const s = stateOf(ctx)
    // Water under a deck blocks the way in the years no bridge stood there.
    ctx.block((p, year) => onStandingBridge(s.crossings, p, year) === false && ctx.water.some((w) => insidePoly(p, w)))
    // Houses on the bridges.
    const houses = s.houses.map((h) => ({ h, bbox: bboxOf(h.poly) }))
    ctx.block((p, year) => houses.some(({ h, bbox }) => year >= h.life[0] && year < h.life[1] && inBox(p, bbox) && insidePoly(p, h.poly)))
    // The edge of the detailed ground.
    ctx.block((p) => {
      const b = ctx.uniforms.u_box.value
      return b.z - b.x < 1e4 && !insideWalkBounds([b.x, b.y, b.z, b.w], p)
    })
  }
}

export default island

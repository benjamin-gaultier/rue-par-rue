/**
 * Low-poly models of period vehicles and boats, built from boxes, wedges
 * and wheels. Each model is a few hundred triangles, in metres: x forward
 * (the footprint's centre at the origin, horses in front), y to the left,
 * z up from the street (boats: from the waterline).
 *
 * Every vertex carries its colour and a part code read by the shaders
 * (vehicleshaders.ts): paint parts take a colour from the type's palette,
 * horse legs swing while moving, spoked wheels are cut out in the fragment
 * shader, horses and drivers vanish from unhitched carts. A part can also
 * have its own years (the omnibus's upper deck from 1853, a barge's mast
 * until 1930).
 *
 * Shapes follow the photographs listed in the README ("Vehicles and boats").
 */

export type V3 = [number, number, number]

/** Part codes, as read by the shaders. */
export const PART = {
  fixed: 0,
  paint: 1,
  paint2: 2,
  horse: 3,
  leg: 4,
  spoked: 5,
  glass: 6,
  person: 7,
  disc: 8,
  lamp: 9
} as const

export interface PartOptions {
  kind?: number
  /** Colour of the bottom corners of a box, shading into the main colour toward the top (hooves, wheel arches). */
  foot?: V3
  /** Years this part is shown, within the vehicle's own. */
  life?: [number, number]
  /** Extra values: leg swing phase and pivot (x, z); wheel disc coordinates are set by `wheel`. */
  extra?: [number, number, number]
}

/** Insets of a box's top face from its bottom face: front (+x), back, left (+y), right. */
export type Insets = [number, number, number, number]

const ALWAYS: [number, number] = [-1e4, 1e4]

export class ModelBuilder {
  position: number[] = []
  normal: number[] = []
  colour: number[] = []
  part: number[] = []
  life: number[] = []
  index: number[] = []

  get vertices(): number {
    return this.position.length / 3
  }

  get triangles(): number {
    return this.index.length / 3
  }

  private vertex(p: V3, n: V3, c: V3, o: PartOptions, extra?: [number, number, number]) {
    this.position.push(...p)
    this.normal.push(...n)
    this.colour.push(...c)
    const e = extra ?? o.extra ?? [0, 0, 0]
    this.part.push(o.kind ?? PART.fixed, e[0], e[1], e[2])
    this.life.push(...(o.life ?? ALWAYS))
  }

  /** A flat quad (a, b, c, d counter-clockwise seen from outside), one colour or one per corner. */
  quad(a: V3, b: V3, c: V3, d: V3, colour: V3 | V3[], o: PartOptions = {}) {
    const n = faceNormal(a, b, c, d)
    if (!n) return
    const i = this.vertices
    const cs = (colour.length === 4 ? colour : [colour, colour, colour, colour]) as V3[]
    ;[a, b, c, d].forEach((p, k) => this.vertex(p, n, cs[k], o))
    this.index.push(i, i + 1, i + 2, i, i + 2, i + 3)
  }

  /**
   * A hexahedron from its 8 corners: bottom face 0-3 then top face 4-7, each
   * going (back, right), (front, right), (front, left), (back, left).
   */
  hexa(c: V3[], colour: V3, o: PartOptions = {}) {
    const [b0, b1, b2, b3, t0, t1, t2, t3] = c
    const f = o.foot ?? colour
    this.quad(b0, b3, b2, b1, f, o) // bottom
    this.quad(t0, t1, t2, t3, colour, o) // top
    this.quad(b1, b2, t2, t1, [f, f, colour, colour], o) // front
    this.quad(b0, t0, t3, b3, [f, colour, colour, f], o) // back
    this.quad(b3, t3, t2, b2, [f, colour, colour, f], o) // left
    this.quad(b0, b1, t1, t0, [f, f, colour, colour], o) // right
  }

  /** A box from x0..x1, y0..y1, z0..z1, its top face inset by `top` (wedges, roofs, bonnets). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, colour: V3, o: PartOptions = {}, top: Insets = [0, 0, 0, 0], bottom: Insets = [0, 0, 0, 0]) {
    const [f, b, l, r] = top
    const [bf, bb, bl, br] = bottom
    this.hexa(
      [
        [x0 + bb, y0 + br, z0],
        [x1 - bf, y0 + br, z0],
        [x1 - bf, y1 - bl, z0],
        [x0 + bb, y1 - bl, z0],
        [x0 + b, y0 + r, z1],
        [x1 - f, y0 + r, z1],
        [x1 - f, y1 - l, z1],
        [x0 + b, y1 - l, z1]
      ],
      colour,
      o
    )
  }

  /** A box centred on y = 0. */
  cbox(x0: number, x1: number, width: number, z0: number, z1: number, colour: V3, o: PartOptions = {}, top?: Insets, bottom?: Insets) {
    this.box(x0, x1, -width / 2, width / 2, z0, z1, colour, o, top, bottom)
  }

  /** A slanted bar from p to q, square in section (shafts, handles, stays). */
  bar(p: V3, q: V3, size: number, colour: V3, o: PartOptions = {}) {
    const d: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]]
    const len = Math.hypot(...d)
    if (len < 1e-6) return
    const u: V3 = [d[0] / len, d[1] / len, d[2] / len]
    // Two axes across the bar.
    const ref: V3 = Math.abs(u[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const v = norm(cross(u, ref))
    const w = cross(v, u)
    const h = size / 2
    const corner = (base: V3, sv: number, sw: number): V3 => [base[0] + (v[0] * sv + w[0] * sw) * h, base[1] + (v[1] * sv + w[1] * sw) * h, base[2] + (v[2] * sv + w[2] * sw) * h]
    // hexa expects bottom/top faces: use the p end as "back", q end as "front".
    this.hexa([corner(p, 1, -1), corner(q, 1, -1), corner(q, -1, -1), corner(p, -1, -1), corner(p, 1, 1), corner(q, 1, 1), corner(q, -1, 1), corner(p, -1, 1)], colour, o)
  }

  /**
   * A wheel standing in the x-z plane at (x, y), hub at height zc. Its two
   * faces carry disc coordinates for the shader (spokes or a solid disc),
   * the tread is an iron tyre or a rubber one.
   */
  wheel(x: number, y: number, zc: number, r: number, width: number, colour: V3, tyre: V3, spoked = true, segments = r > 0.6 ? 10 : 8) {
    const kind = spoked ? PART.spoked : PART.disc
    for (const side of [1, -1]) {
      const yy = y + (side * width) / 2
      const n: V3 = [0, side, 0]
      const i = this.vertices
      this.vertex([x, yy, zc], n, colour, { kind }, [0, 0, 0])
      for (let k = 0; k < segments; k++) {
        const a = (k / segments) * Math.PI * 2
        this.vertex([x + Math.cos(a) * r, yy, zc + Math.sin(a) * r], n, colour, { kind }, [Math.cos(a), Math.sin(a), 0])
      }
      for (let k = 0; k < segments; k++) {
        const a = i + 1 + k
        const b = i + 1 + ((k + 1) % segments)
        if (side > 0) this.index.push(i, b, a)
        else this.index.push(i, a, b)
      }
    }
    // The tread: one quad per segment, facing out.
    for (let k = 0; k < segments; k++) {
      const a0 = (k / segments) * Math.PI * 2
      const a1 = ((k + 1) / segments) * Math.PI * 2
      const p = (a: number, s: number): V3 => [x + Math.cos(a) * r, y + (s * width) / 2, zc + Math.sin(a) * r]
      this.quad(p(a0, 1), p(a1, 1), p(a1, -1), p(a0, -1), tyre)
    }
  }

  /** Two wheels on an axle. */
  axle(x: number, track: number, r: number, width: number, colour: V3, tyre: V3, spoked = true) {
    this.wheel(x, track / 2, r, r, width, colour, tyre, spoked)
    this.wheel(x, -track / 2, r, r, width, colour, tyre, spoked)
    this.bar([x, track / 2, r], [x, -track / 2, r], 0.07, IRON)
  }

  /**
   * A draught horse facing +x, its body centred at (x, y), hooves on z = 0.
   * About 100 triangles. Legs swing while the vehicle moves.
   */
  horse(x: number, y: number, size = 1, index = 0) {
    const s = size
    // The horse's number in a team rides in the part's first value (tens), so each gets its own coat.
    const team: [number, number, number] = [index * 10, 0, 0]
    const o = { kind: PART.horse, extra: team }
    const dark: V3 = [0.55, 0.55, 0.55] // mane, tail, hooves: darker than the coat
    // Body: a barrel, deeper at the chest.
    this.box(x - 0.85 * s, x + 0.8 * s, y - 0.31 * s, y + 0.31 * s, 0.98 * s, 1.58 * s, WHITE, o, [0.08, 0.1, 0.06, 0.06], [0.1, 0.12, 0.08, 0.08])
    // Neck, rising forward.
    this.hexa(
      [
        [x + 0.55 * s, y - 0.17 * s, 1.25 * s],
        [x + 0.95 * s, y - 0.15 * s, 1.35 * s],
        [x + 0.95 * s, y + 0.15 * s, 1.35 * s],
        [x + 0.55 * s, y + 0.17 * s, 1.25 * s],
        [x + 0.62 * s, y - 0.13 * s, 1.72 * s],
        [x + 1.12 * s, y - 0.11 * s, 1.95 * s],
        [x + 1.12 * s, y + 0.11 * s, 1.95 * s],
        [x + 0.62 * s, y + 0.13 * s, 1.72 * s]
      ],
      WHITE,
      o
    )
    // Mane along the top of the neck.
    this.bar([x + 0.6 * s, y, 1.74 * s], [x + 1.08 * s, y, 1.98 * s], 0.08 * s, dark, o)
    // Head, pointing down and forward.
    this.hexa(
      [
        [x + 0.98 * s, y - 0.12 * s, 1.72 * s],
        [x + 1.5 * s, y - 0.08 * s, 1.42 * s],
        [x + 1.5 * s, y + 0.08 * s, 1.42 * s],
        [x + 0.98 * s, y + 0.12 * s, 1.72 * s],
        [x + 1.05 * s, y - 0.11 * s, 2.0 * s],
        [x + 1.58 * s, y - 0.07 * s, 1.62 * s],
        [x + 1.58 * s, y + 0.07 * s, 1.62 * s],
        [x + 1.05 * s, y + 0.11 * s, 2.0 * s]
      ],
      WHITE,
      o
    )
    // Tail.
    this.bar([x - 0.86 * s, y, 1.5 * s], [x - 0.95 * s, y, 0.8 * s], 0.12 * s, dark, o)
    // Legs: front pair and hind pair in opposite phase (a walk).
    const legs: [number, number, number][] = [
      [x + 0.6 * s, y + 0.18 * s, 0],
      [x + 0.6 * s, y - 0.18 * s, 0.5],
      [x - 0.62 * s, y + 0.18 * s, 0.5],
      [x - 0.62 * s, y - 0.18 * s, 0]
    ]
    for (const [lx, ly, phase] of legs) {
      const top = 1.05 * s
      // Darker toward the hoof and its feathering.
      const leg = { kind: PART.leg, extra: [phase + index * 10, top, lx] as [number, number, number], foot: [0.35, 0.35, 0.35] as V3 }
      this.box(lx - 0.085 * s, lx + 0.085 * s, ly - 0.075 * s, ly + 0.075 * s, 0, top, WHITE, leg, [0.02, 0.02, 0.01, 0.01])
    }
  }

  /** Harness collar and saddle pad on a horse built at (x, y). */
  harness(x: number, y: number) {
    this.box(x + 0.5, x + 0.62, y - 0.34, y + 0.34, 1.15, 1.75, LEATHER, { kind: PART.horse }, [0.02, 0.02, 0.08, 0.08])
    this.box(x - 0.15, x + 0.12, y - 0.33, y + 0.33, 1.5, 1.63, LEATHER, { kind: PART.horse })
  }

  /** A seated driver (coachman, carter, chauffeur) at (x, y), seat at height z. */
  seated(x: number, y: number, z: number, hat: 'top' | 'cap' | 'none' = 'top') {
    const o = { kind: PART.person }
    this.box(x - 0.32, x + 0.12, y - 0.2, y + 0.2, z, z + 0.2, WHITE, o) // thighs
    this.box(x + 0.05, x + 0.22, y - 0.18, y + 0.18, z - 0.45, z + 0.05, WHITE, o) // shins
    this.box(x - 0.33, x - 0.05, y - 0.22, y + 0.22, z + 0.15, z + 0.75, WHITE, o, [0.02, 0.02, 0.04, 0.04]) // torso
    this.head(x - 0.18, y, z + 0.75, hat)
  }

  /** A person standing at (x, y) on height z (a carter by his horse). */
  standing(x: number, y: number, z = 0, hat: 'top' | 'cap' | 'none' = 'cap') {
    const o = { kind: PART.person }
    this.box(x - 0.12, x + 0.12, y - 0.18, y + 0.18, z, z + 0.85, WHITE, o, [0.02, 0.02, 0.03, 0.03])
    this.box(x - 0.14, x + 0.14, y - 0.22, y + 0.22, z + 0.85, z + 1.45, WHITE, o, [0.02, 0.02, 0.04, 0.04])
    this.head(x, y, z + 1.45, hat)
  }

  private head(x: number, y: number, z: number, hat: 'top' | 'cap' | 'none') {
    this.box(x - 0.1, x + 0.1, y - 0.09, y + 0.09, z, z + 0.24, SKIN)
    if (hat === 'top') this.box(x - 0.12, x + 0.12, y - 0.11, y + 0.11, z + 0.2, z + 0.42, HAT)
    else if (hat === 'cap') this.box(x - 0.12, x + 0.15, y - 0.11, y + 0.11, z + 0.19, z + 0.29, HAT, {}, [0.03, 0.03, 0.02, 0.02])
  }

  /** Window glass set just proud of a face of a box (x0..x1 at y = ±y, z0..z1). */
  sideGlass(x0: number, x1: number, y: number, z0: number, z1: number, o: PartOptions = {}) {
    const g = { kind: PART.glass, ...o }
    this.quad([x0, -y, z0], [x1, -y, z0], [x1, -y, z1], [x0, -y, z1], GLASS, g)
    this.quad([x1, y, z0], [x0, y, z0], [x0, y, z1], [x1, y, z1], GLASS, g)
  }

  /** Glass across the vehicle at x (windscreen if facing +x), leaning back by `lean` metres at the top. */
  crossGlass(x: number, halfWidth: number, z0: number, z1: number, facing: 1 | -1, lean = 0, o: PartOptions = {}) {
    const g = { kind: PART.glass, ...o }
    const xt = x - lean * facing
    if (facing > 0) this.quad([x, -halfWidth, z0], [x, halfWidth, z0], [xt, halfWidth, z1], [xt, -halfWidth, z1], GLASS, g)
    else this.quad([x, halfWidth, z0], [x, -halfWidth, z0], [xt, -halfWidth, z1], [xt, halfWidth, z1], GLASS, g)
  }
}

/* ------------------------------------------------------------- maths */

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function norm(a: V3): V3 {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/** Normal of a planar quad (Newell's method), undefined if degenerate. */
function faceNormal(...p: V3[]): V3 | undefined {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    nx += (a[1] - b[1]) * (a[2] + b[2])
    ny += (a[2] - b[2]) * (a[0] + b[0])
    nz += (a[0] - b[0]) * (a[1] + b[1])
  }
  const l = Math.hypot(nx, ny, nz)
  return l < 1e-9 ? undefined : [nx / l, ny / l, nz / l]
}

/* ------------------------------------------------------------- colours */

const WHITE: V3 = [1, 1, 1]
const IRON: V3 = [0.16, 0.16, 0.17]
const RUBBER: V3 = [0.09, 0.09, 0.1]
const LEATHER: V3 = [0.2, 0.13, 0.09]
const SKIN: V3 = [0.78, 0.6, 0.48]
const HAT: V3 = [0.08, 0.08, 0.09]
const GLASS: V3 = [0.2, 0.24, 0.27]
const WOOD: V3 = [0.5, 0.41, 0.3]
const DARKWOOD: V3 = [0.3, 0.23, 0.17]
const CHROME: V3 = [0.7, 0.71, 0.72]
const CANVAS: V3 = [0.78, 0.75, 0.66]
const BLACK: V3 = [0.07, 0.07, 0.08]
const TAR: V3 = [0.1, 0.09, 0.08]
const CREAM: V3 = [0.86, 0.83, 0.74]
const ZINC: V3 = [0.48, 0.5, 0.52]
const LAMP: V3 = [1.0, 0.92, 0.7]
/** Multiplier for paint parts: the palette colour as is, or a shade of it. */
const P: V3 = [1, 1, 1]
const PD: V3 = [0.72, 0.72, 0.72]

/* ------------------------------------------------------------- models */

export interface ModelDef {
  build(b: ModelBuilder): void
  /** Floats on the river (placed at the water level). */
  boat?: boolean
  /** An unhitched cart tips forward about its axle: (axle x, axle height, angle in radians). */
  tip?: [number, number, number]
  /** Paint colours (part `paint`), one picked per vehicle. */
  palette: V3[]
  /** Second paint colours (part `paint2`). */
  palette2?: V3[]
  /** Lean of the soft ground shadow under it (0 for boats). */
  shadow?: number
}

const WOODS: V3[] = [
  [0.5, 0.43, 0.34],
  [0.42, 0.36, 0.29],
  [0.38, 0.45, 0.52], // the blue of French carts (bleu charrette)
  [0.48, 0.3, 0.22]
]

function cartBody(b: ModelBuilder, x0: number, x1: number, width: number, z0: number, depth: number) {
  const t = 0.06
  const z1 = z0 + depth
  b.cbox(x0, x1, width, z0, z0 + 0.08, P, { kind: PART.paint }) // floor
  b.box(x0, x1, width / 2 - t, width / 2, z0, z1, P, { kind: PART.paint }) // sides
  b.box(x0, x1, -width / 2, -width / 2 + t, z0, z1, P, { kind: PART.paint })
  b.cbox(x1 - t, x1, width, z0, z1, PD, { kind: PART.paint }) // front board
  b.cbox(x0, x0 + t, width, z0, z1 - 0.1, PD, { kind: PART.paint }) // tailboard
  // Side rails, a little darker.
  b.box(x0, x1, width / 2 - 0.02, width / 2 + 0.03, z1 - 0.06, z1, PD, { kind: PART.paint })
  b.box(x0, x1, -width / 2 - 0.03, -width / 2 + 0.02, z1 - 0.06, z1, PD, { kind: PART.paint })
}

function shafts(b: ModelBuilder, x0: number, x1: number, z0: number, z1: number, gap: number, colour: V3 = DARKWOOD, kind: number = PART.fixed) {
  b.bar([x0, gap / 2, z0], [x1, gap / 2 - 0.06, z1], 0.07, colour, { kind })
  b.bar([x0, -gap / 2, z0], [x1, -gap / 2 + 0.06, z1], 0.07, colour, { kind })
}

export const MODELS: Record<string, ModelDef> = {
  /* ------------------------------------------ handcart (voiture à bras) */
  handcart: {
    palette: WOODS,
    shadow: 1,
    build(b) {
      cartBody(b, -1.25, 0.45, 1.0, 0.6, 0.3)
      b.axle(-0.35, 1.2, 0.55, 0.07, WOOD, IRON)
      // Long handles and a crossbar to push on.
      b.bar([0.45, 0.42, 0.7], [1.25, 0.38, 0.85], 0.06, DARKWOOD)
      b.bar([0.45, -0.42, 0.7], [1.25, -0.38, 0.85], 0.06, DARKWOOD)
      b.bar([1.2, 0.38, 0.85], [1.2, -0.38, 0.85], 0.05, DARKWOOD)
      // A prop at the back.
      b.bar([-1.15, 0, 0.62], [-1.2, 0, 0], 0.06, DARKWOOD)
    }
  },

  /* ---------------------------------------------- cart, tip-cart (tombereau) */
  cart: {
    palette: WOODS,
    tip: [-1.35, 0.75, 0.27],
    shadow: 1,
    build(b) {
      cartBody(b, -2.65, -0.45, 1.35, 0.78, 0.62)
      b.axle(-1.35, 1.65, 0.75, 0.09, WOOD, IRON)
      shafts(b, -0.45, 1.75, 0.95, 1.05, 0.9)
      b.horse(1.15, 0)
      b.harness(1.15, 0)
      b.standing(1.0, 0.85, 0, 'cap')
    }
  },

  /* ------------------------------------------ covered cart (charrette bâchée) */
  tiltcart: {
    palette: WOODS,
    palette2: [CANVAS, [0.7, 0.68, 0.6], [0.6, 0.58, 0.5], [0.82, 0.8, 0.74]],
    tip: [-1.5, 0.7, 0.24],
    shadow: 1,
    build(b) {
      cartBody(b, -2.85, -0.25, 1.4, 0.75, 0.45)
      // The tilt: canvas over hoops, rounded at the top.
      b.cbox(-2.9, -0.2, 1.5, 1.2, 1.85, P, { kind: PART.paint2 })
      b.cbox(-2.9, -0.2, 1.5, 1.85, 2.25, P, { kind: PART.paint2 }, [0, 0, 0.35, 0.35])
      b.axle(-1.5, 1.7, 0.7, 0.09, WOOD, IRON)
      shafts(b, -0.25, 1.85, 0.92, 1.05, 0.9)
      b.horse(1.25, 0)
      b.harness(1.25, 0)
      b.seated(-0.05, 0.3, 1.2, 'cap')
    }
  },

  /* ------------------------------------------------- fiacre (closed cab) */
  fiacre: {
    palette: [
      [0.1, 0.1, 0.12],
      [0.12, 0.16, 0.26],
      [0.14, 0.22, 0.15],
      [0.3, 0.1, 0.09]
    ],
    palette2: [BLACK, [0.62, 0.5, 0.18], [0.45, 0.12, 0.08], BLACK],
    shadow: 1,
    build(b) {
      const w = 1.3
      // Lower body and the closed cabin with a door window on each side.
      b.cbox(-2.45, -0.75, w, 0.62, 1.25, P, { kind: PART.paint }, [0, 0, 0, 0], [0.12, 0.1, 0.06, 0.06])
      b.cbox(-2.35, -1.05, w - 0.04, 1.25, 2.02, P, { kind: PART.paint })
      b.cbox(-2.42, -0.98, w + 0.04, 2.02, 2.1, BLACK) // roof
      b.sideGlass(-1.75, -1.25, w / 2 - 0.01, 1.42, 1.9)
      b.crossGlass(-1.04, w / 2 - 0.1, 1.42, 1.9, 1)
      // Coachman's box at the front, with the coachman in a top hat.
      b.cbox(-1.05, -0.45, 1.1, 1.25, 1.55, BLACK)
      b.bar([-0.45, 0.4, 1.25], [-0.15, 0.4, 0.75], 0.05, IRON)
      b.bar([-0.45, -0.4, 1.25], [-0.15, -0.4, 0.75], 0.05, IRON)
      b.seated(-0.65, 0, 1.55, 'top')
      // Lamps, and the wheels in the second colour (often yellow or red).
      b.box(-1.12, -1.0, w / 2 + 0.02, w / 2 + 0.14, 1.75, 1.95, LAMP, { kind: PART.lamp })
      b.box(-1.12, -1.0, -w / 2 - 0.14, -w / 2 - 0.02, 1.75, 1.95, LAMP, { kind: PART.lamp })
      b.wheel(-1.95, 0.72, 0.57, 0.57, 0.07, P, RUBBER)
      b.wheel(-1.95, -0.72, 0.57, 0.57, 0.07, P, RUBBER)
      b.wheel(-0.65, 0.62, 0.42, 0.42, 0.07, P, RUBBER)
      b.wheel(-0.65, -0.62, 0.42, 0.42, 0.07, P, RUBBER)
      shafts(b, -0.5, 1.75, 0.8, 1.05, 0.88)
      b.horse(1.15, 0)
      b.harness(1.15, 0)
    }
  },

  /* ------------------------------------------- horse omnibus with impériale */
  omnibus: {
    palette: [
      [0.62, 0.48, 0.16],
      [0.36, 0.22, 0.13],
      [0.2, 0.3, 0.2],
      [0.55, 0.2, 0.13]
    ],
    palette2: [CREAM, CREAM, [0.8, 0.74, 0.55], CREAM],
    shadow: 1,
    build(b) {
      const w = 2.0
      const imperiale: [number, number] = [1853, 1e4]
      b.cbox(-4.3, -0.15, w, 0.62, 1.2, P, { kind: PART.paint }, [0, 0, 0, 0], [0.1, 0.05, 0.08, 0.08])
      b.cbox(-4.25, -0.2, w, 1.2, 2.25, P, { kind: PART.paint })
      // Lettering board above the windows, and the windows along each side.
      b.cbox(-4.27, -0.18, w + 0.03, 1.98, 2.22, P, { kind: PART.paint2 })
      b.sideGlass(-3.95, -0.6, w / 2 + 0.02, 1.38, 1.92)
      b.crossGlass(-0.19, w / 2 - 0.15, 1.38, 1.9, 1)
      b.cbox(-4.35, -0.1, w + 0.1, 2.25, 2.33, DARKWOOD) // roof
      // Upper deck: back-to-back bench along the roof, railings, the curved stair at the back.
      b.cbox(-4.0, -0.5, 0.5, 2.33, 2.65, DARKWOOD, { life: imperiale })
      b.cbox(-4.0, -0.5, 0.12, 2.65, 2.95, DARKWOOD, { life: imperiale })
      b.box(-4.3, -0.15, w / 2 - 0.04, w / 2 + 0.02, 2.33, 2.85, IRON, { life: imperiale }, [0, 0, 0, 0])
      b.box(-4.3, -0.15, -w / 2 - 0.02, -w / 2 + 0.04, 2.33, 2.85, IRON, { life: imperiale })
      b.cbox(-4.85, -4.3, 0.9, 0.45, 0.55, DARKWOOD) // rear platform
      b.bar([-4.75, -0.55, 0.55], [-4.35, -0.2, 2.35], 0.18, IRON, { life: imperiale })
      // Driver high at the front.
      b.cbox(-0.35, 0.25, 1.2, 2.0, 2.3, BLACK)
      b.seated(0.0, 0, 2.3, 'top')
      b.axle(-3.25, 1.95, 0.75, 0.1, P, IRON)
      b.axle(-0.55, 1.75, 0.5, 0.09, P, IRON)
      // Two horses abreast on a pole.
      b.bar([-0.1, 0, 0.85], [2.6, 0, 1.15], 0.08, DARKWOOD)
      b.horse(1.85, 0.42, 1, 0)
      b.horse(1.85, -0.42, 1, 1)
      b.harness(1.85, 0.42)
      b.harness(1.85, -0.42)
    }
  },

  /* ---------------------------------------------------- early motor car */
  car_early: {
    palette: [
      [0.08, 0.08, 0.09],
      [0.12, 0.2, 0.14],
      [0.14, 0.16, 0.3],
      [0.32, 0.1, 0.1]
    ],
    palette2: [BLACK, BLACK, [0.2, 0.17, 0.14], BLACK],
    shadow: 1,
    build(b) {
      const w = 1.45
      b.cbox(-1.95, 0.75, w, 0.55, 1.15, P, { kind: PART.paint }, [0, 0, 0.04, 0.04])
      // Bonnet and radiator.
      b.cbox(0.75, 1.75, 0.82, 0.62, 1.12, P, { kind: PART.paint }, [0.04, 0, 0.06, 0.06])
      b.cbox(1.75, 1.85, 0.78, 0.58, 1.15, CHROME)
      // Closed rear cabin (landaulet), open front seat with a windscreen.
      b.cbox(-1.95, -0.25, w - 0.05, 1.15, 2.05, P, { kind: PART.paint2 }, [0.05, 0.08, 0.04, 0.04])
      b.sideGlass(-1.25, -0.5, (w - 0.05) / 2 + 0.01, 1.35, 1.85)
      b.crossGlass(0.6, w / 2 - 0.08, 1.15, 1.75, 1, 0.08)
      b.cbox(-0.25, 0.55, w - 0.2, 0.95, 1.25, LEATHER) // front seat
      // Mudguards and running boards.
      for (const s of [1, -1]) {
        b.box(-1.95, 1.55, s > 0 ? w / 2 : -w / 2 - 0.22, s > 0 ? w / 2 + 0.22 : -w / 2, 0.42, 0.47, BLACK)
        b.box(1.0, 1.75, s > 0 ? 0.48 : -0.78, s > 0 ? 0.78 : -0.48, 0.82, 0.86, BLACK)
      }
      b.axle(-1.25, 1.42, 0.42, 0.11, WOOD, RUBBER)
      b.axle(1.35, 1.32, 0.42, 0.11, WOOD, RUBBER)
      b.box(1.85, 1.95, 0.25, 0.4, 0.9, 1.05, LAMP, { kind: PART.lamp })
      b.box(1.85, 1.95, -0.4, -0.25, 0.9, 1.05, LAMP, { kind: PART.lamp })
    }
  },

  /* ---------------------------------------- motor taxi (Renault AG kind) */
  taxi: {
    palette: [
      [0.45, 0.1, 0.08],
      [0.38, 0.09, 0.08],
      [0.12, 0.14, 0.24],
      [0.42, 0.12, 0.08]
    ],
    palette2: [BLACK, BLACK, BLACK, BLACK],
    shadow: 1,
    build(b) {
      const w = 1.4
      b.cbox(-1.95, 0.55, w, 0.55, 1.2, P, { kind: PART.paint })
      // The sloping "coal-scuttle" bonnet behind the radiator.
      b.cbox(0.55, 1.75, 0.95, 0.6, 1.1, BLACK, {}, [0.55, 0, 0.12, 0.12])
      b.cbox(1.6, 1.82, 0.85, 0.55, 0.85, CHROME)
      b.cbox(-1.95, -0.35, w - 0.05, 1.2, 2.15, P, { kind: PART.paint2 }, [0, 0.06, 0.03, 0.03])
      b.sideGlass(-1.4, -0.6, (w - 0.05) / 2 + 0.01, 1.4, 1.95)
      b.crossGlass(-0.34, w / 2 - 0.1, 1.4, 1.95, 1)
      // Open driver's seat, the driver in a cap, the meter on its post.
      b.cbox(-0.35, 0.35, w - 0.2, 0.95, 1.25, LEATHER)
      b.seated(0.05, 0.28, 1.0, 'cap')
      b.box(0.45, 0.55, -0.62, -0.52, 1.2, 1.5, CHROME)
      for (const s of [1, -1]) b.box(-1.95, 1.55, s > 0 ? w / 2 : -w / 2 - 0.2, s > 0 ? w / 2 + 0.2 : -w / 2, 0.42, 0.47, BLACK)
      b.axle(-1.3, 1.4, 0.4, 0.1, WOOD, RUBBER)
      b.axle(1.2, 1.3, 0.4, 0.1, WOOD, RUBBER)
    }
  },

  /* ----------------------------------------- early motor bus (Schneider) */
  motorbus: {
    palette: [
      [0.17, 0.32, 0.22],
      [0.15, 0.29, 0.2],
      [0.2, 0.34, 0.24],
      [0.16, 0.3, 0.21]
    ],
    palette2: [CREAM, CREAM, [0.84, 0.8, 0.68], CREAM],
    shadow: 1,
    build(b) {
      const w = 2.2
      b.cbox(-3.6, 2.45, w, 0.72, 1.62, P, { kind: PART.paint })
      b.cbox(-3.6, 2.45, w, 1.62, 2.3, P, { kind: PART.paint2 })
      b.sideGlass(-3.3, 2.2, w / 2 + 0.01, 1.68, 2.22)
      b.cbox(-3.6, 2.45, w, 2.3, 2.62, P, { kind: PART.paint2 })
      b.cbox(-3.7, 2.55, w + 0.08, 2.62, 2.72, DARKWOOD) // roof
      // Bonnet and radiator; the driver's half-open cab.
      b.cbox(2.45, 3.6, 1.25, 0.8, 1.6, P, { kind: PART.paint })
      b.cbox(3.6, 3.75, 1.2, 0.75, 1.65, CHROME)
      b.crossGlass(2.46, w / 2 - 0.1, 1.68, 2.25, 1)
      // Open rear platform.
      b.cbox(-4.1, -3.6, w - 0.2, 0.6, 0.74, DARKWOOD)
      b.bar([-4.05, 0.9, 0.74], [-4.05, 0.9, 2.62], 0.06, IRON)
      b.bar([-4.05, -0.9, 0.74], [-4.05, -0.9, 2.62], 0.06, IRON)
      b.cbox(-4.15, -3.6, w - 0.1, 2.62, 2.7, DARKWOOD)
      b.axle(-2.2, 1.9, 0.5, 0.18, IRON, RUBBER, false)
      b.axle(2.9, 1.85, 0.48, 0.12, IRON, RUBBER, false)
    }
  },

  /* ---------------------------------------------- early delivery van */
  van_early: {
    palette: [
      [0.2, 0.28, 0.2],
      [0.35, 0.24, 0.14],
      [0.55, 0.45, 0.2],
      [0.18, 0.2, 0.3]
    ],
    palette2: [CREAM, CREAM, [0.15, 0.13, 0.12], CREAM],
    shadow: 1,
    build(b) {
      const w = 1.65
      b.cbox(-2.3, 0.6, w, 0.6, 2.2, P, { kind: PART.paint })
      b.cbox(-2.32, 0.62, w + 0.02, 1.85, 2.1, P, { kind: PART.paint2 }) // lettering band
      b.cbox(0.6, 1.4, w - 0.1, 0.6, 1.95, P, { kind: PART.paint }, [0.12, 0, 0.05, 0.05])
      b.crossGlass(1.3, w / 2 - 0.15, 1.3, 1.85, 1, 0.1)
      b.sideGlass(0.75, 1.2, (w - 0.1) / 2 + 0.01, 1.3, 1.8)
      b.cbox(1.4, 2.2, 0.85, 0.6, 1.15, P, { kind: PART.paint }, [0.05, 0, 0.06, 0.06])
      b.cbox(2.2, 2.3, 0.8, 0.58, 1.18, CHROME)
      for (const s of [1, -1]) b.box(-2.0, 2.0, s > 0 ? w / 2 : -w / 2 - 0.15, s > 0 ? w / 2 + 0.15 : -w / 2, 0.45, 0.5, BLACK)
      b.axle(-1.4, 1.5, 0.42, 0.12, IRON, RUBBER, false)
      b.axle(1.7, 1.4, 0.42, 0.11, IRON, RUBBER, false)
    }
  },

  /* ----------------------------------------- mid-century car (1930s-1970s) */
  car_mid: {
    palette: [
      [0.08, 0.08, 0.09],
      [0.55, 0.56, 0.55],
      [0.62, 0.58, 0.46],
      [0.4, 0.5, 0.58],
      [0.2, 0.3, 0.24],
      [0.72, 0.7, 0.64],
      [0.5, 0.15, 0.12],
      [0.18, 0.22, 0.34]
    ],
    shadow: 1,
    build(b) {
      const w = 1.62
      b.cbox(-2.15, 2.1, w - 0.15, 0.35, 0.95, P, { kind: PART.paint }, [0.3, 0.25, 0.05, 0.05], [0.15, 0.1, 0, 0])
      // Separate wings over the wheels.
      for (const s of [1, -1]) {
        const y0 = s > 0 ? w / 2 - 0.2 : -w / 2
        const y1 = s > 0 ? w / 2 : -w / 2 + 0.2
        b.box(0.8, 2.0, y0, y1, 0.42, 0.88, P, { kind: PART.paint }, [0.35, 0.3, 0.05, 0.05])
        b.box(-2.0, -0.85, y0, y1, 0.42, 0.85, P, { kind: PART.paint }, [0.35, 0.3, 0.05, 0.05])
      }
      // Cabin with sloping screens.
      b.cbox(-1.45, 0.55, w - 0.25, 0.95, 1.5, P, { kind: PART.paint }, [0.32, 0.38, 0.08, 0.08])
      b.sideGlass(-1.25, 0.3, (w - 0.25) / 2 - 0.02, 1.0, 1.42)
      b.crossGlass(0.55, w / 2 - 0.2, 0.97, 1.48, 1, 0.3)
      b.crossGlass(-1.45, w / 2 - 0.2, 0.97, 1.48, -1, 0.36)
      b.cbox(2.08, 2.16, 0.8, 0.45, 0.8, CHROME)
      b.box(2.06, 2.14, 0.45, 0.62, 0.68, 0.82, LAMP, { kind: PART.lamp })
      b.box(2.06, 2.14, -0.62, -0.45, 0.68, 0.82, LAMP, { kind: PART.lamp })
      b.axle(-1.4, 1.38, 0.33, 0.16, IRON, RUBBER, false)
      b.axle(1.4, 1.38, 0.33, 0.16, IRON, RUBBER, false)
    }
  },

  /* ------------------------------------------ platform bus (Renault TN kind) */
  bus_mid: {
    palette: [
      [0.2, 0.36, 0.25],
      [0.18, 0.34, 0.24],
      [0.22, 0.38, 0.27],
      [0.2, 0.35, 0.25]
    ],
    palette2: [CREAM, CREAM, CREAM, CREAM],
    shadow: 1,
    build(b) {
      const w = 2.35
      b.cbox(-4.2, 4.0, w, 0.5, 1.5, P, { kind: PART.paint })
      b.cbox(-4.2, 4.0, w, 1.5, 2.6, P, { kind: PART.paint2 })
      b.sideGlass(-3.9, 3.6, w / 2 + 0.01, 1.58, 2.4)
      b.crossGlass(4.01, w / 2 - 0.15, 1.58, 2.4, 1, 0.1)
      b.cbox(-4.25, 4.05, w, 2.6, 2.85, P, { kind: PART.paint2 }, [0.1, 0.1, 0.1, 0.1])
      b.cbox(4.0, 4.7, 1.4, 0.55, 1.45, P, { kind: PART.paint }, [0.12, 0, 0.1, 0.1])
      b.cbox(4.7, 4.76, 1.2, 0.55, 1.3, CHROME)
      // Open rear platform with its railing.
      b.cbox(-4.7, -4.2, w - 0.1, 0.45, 0.6, DARKWOOD)
      b.cbox(-4.72, -4.62, w - 0.1, 0.6, 1.4, IRON, {}, [0, 0, 0, 0])
      b.cbox(-4.75, -4.2, w - 0.1, 2.55, 2.75, P, { kind: PART.paint2 })
      b.axle(-2.6, 2.0, 0.5, 0.25, IRON, RUBBER, false)
      b.axle(3.0, 2.0, 0.5, 0.2, IRON, RUBBER, false)
    }
  },

  /* ------------------------------------------- corrugated van (H kind) */
  van_mid: {
    palette: [
      [0.56, 0.58, 0.58],
      [0.5, 0.52, 0.53],
      [0.78, 0.66, 0.2],
      [0.24, 0.34, 0.5]
    ],
    shadow: 1,
    build(b) {
      const w = 1.75
      b.cbox(-2.2, 1.6, w, 0.32, 2.15, P, { kind: PART.paint }, [0, 0, 0.05, 0.05])
      // Corrugations: thin ribs along the sides.
      for (let z = 0.8; z < 2.0; z += 0.3) b.cbox(-2.15, 1.5, w + 0.03, z, z + 0.06, PD, { kind: PART.paint })
      b.cbox(1.6, 2.2, w - 0.05, 0.32, 1.95, P, { kind: PART.paint }, [0.35, 0, 0.08, 0.08], [0.0, 0, 0, 0])
      b.crossGlass(2.12, w / 2 - 0.15, 1.25, 1.85, 1, 0.3)
      b.sideGlass(1.65, 2.0, w / 2 - 0.02, 1.25, 1.8)
      b.axle(-1.35, 1.5, 0.33, 0.16, IRON, RUBBER, false)
      b.axle(1.55, 1.5, 0.33, 0.16, IRON, RUBBER, false)
    }
  },

  /* ----------------------------------------------------- modern car */
  car_modern: {
    palette: [
      [0.85, 0.86, 0.86],
      [0.62, 0.64, 0.66],
      [0.35, 0.36, 0.38],
      [0.07, 0.07, 0.08],
      [0.12, 0.17, 0.3],
      [0.55, 0.1, 0.1],
      [0.75, 0.76, 0.77],
      [0.22, 0.24, 0.26]
    ],
    shadow: 1,
    build(b) {
      const w = 1.78
      b.cbox(-2.1, 2.1, w, 0.25, 0.85, P, { kind: PART.paint }, [0.25, 0.12, 0.06, 0.06], [0.1, 0.12, 0.04, 0.04])
      b.cbox(-1.65, 0.85, w - 0.1, 0.85, 1.42, P, { kind: PART.paint }, [0.55, 0.3, 0.14, 0.14])
      b.sideGlass(-1.45, 0.6, (w - 0.1) / 2 - 0.08, 0.92, 1.36)
      b.crossGlass(0.84, w / 2 - 0.15, 0.88, 1.4, 1, 0.52)
      b.crossGlass(-1.64, w / 2 - 0.15, 0.88, 1.4, -1, 0.28)
      b.box(2.05, 2.12, 0.5, 0.78, 0.6, 0.72, LAMP, { kind: PART.lamp })
      b.box(2.05, 2.12, -0.78, -0.5, 0.6, 0.72, LAMP, { kind: PART.lamp })
      b.cbox(-2.12, -2.06, w - 0.3, 0.62, 0.75, [0.5, 0.06, 0.05])
      b.axle(-1.35, 1.52, 0.31, 0.2, [0.62, 0.63, 0.65], RUBBER, false)
      b.axle(1.32, 1.52, 0.31, 0.2, [0.62, 0.63, 0.65], RUBBER, false)
    }
  },

  /* ------------------------------------------------------- modern bus */
  bus_modern: {
    palette: [
      [0.88, 0.89, 0.88],
      [0.86, 0.87, 0.86],
      [0.88, 0.89, 0.88],
      [0.87, 0.88, 0.87]
    ],
    palette2: [
      [0.18, 0.52, 0.42],
      [0.18, 0.52, 0.42],
      [0.2, 0.55, 0.45],
      [0.18, 0.5, 0.4]
    ],
    shadow: 1,
    build(b) {
      const w = 2.5
      b.cbox(-5.75, 5.75, w, 0.3, 3.0, P, { kind: PART.paint }, [0.05, 0.05, 0.05, 0.05])
      b.sideGlass(-5.4, 5.2, w / 2 + 0.01, 1.0, 2.6)
      b.crossGlass(5.76, w / 2 - 0.1, 0.6, 2.75, 1, 0.08)
      b.cbox(-5.77, 5.77, w + 0.02, 0.32, 0.75, P, { kind: PART.paint2 }) // the green skirt
      b.cbox(-3.0, 1.5, 1.6, 3.0, 3.3, [0.8, 0.81, 0.8], {}, [0.1, 0.1, 0.1, 0.1]) // roof equipment
      b.box(5.72, 5.8, 0.75, 1.1, 0.55, 0.75, LAMP, { kind: PART.lamp })
      b.box(5.72, 5.8, -1.1, -0.75, 0.55, 0.75, LAMP, { kind: PART.lamp })
      b.axle(-3.2, 2.05, 0.5, 0.3, [0.55, 0.56, 0.57], RUBBER, false)
      b.axle(3.4, 2.05, 0.5, 0.3, [0.55, 0.56, 0.57], RUBBER, false)
    }
  },

  /* ------------------------------------------------------ modern van */
  van_modern: {
    palette: [
      [0.9, 0.9, 0.9],
      [0.88, 0.89, 0.9],
      [0.66, 0.68, 0.7],
      [0.86, 0.72, 0.2]
    ],
    shadow: 1,
    build(b) {
      const w = 1.95
      b.cbox(-2.5, 1.5, w, 0.35, 2.45, P, { kind: PART.paint }, [0.05, 0, 0.05, 0.05])
      b.cbox(1.5, 2.5, w - 0.05, 0.35, 1.9, P, { kind: PART.paint }, [0.55, 0, 0.1, 0.1], [0.05, 0, 0, 0])
      b.crossGlass(1.98, w / 2 - 0.15, 1.15, 1.85, 1, 0.45)
      b.sideGlass(1.25, 1.9, w / 2 - 0.02, 1.15, 1.8)
      b.box(2.42, 2.5, 0.55, 0.85, 0.75, 0.9, LAMP, { kind: PART.lamp })
      b.box(2.42, 2.5, -0.85, -0.55, 0.75, 0.9, LAMP, { kind: PART.lamp })
      b.axle(-1.6, 1.7, 0.34, 0.2, [0.55, 0.56, 0.57], RUBBER, false)
      b.axle(1.75, 1.7, 0.34, 0.2, [0.55, 0.56, 0.57], RUBBER, false)
    }
  },

  /* ------------------------------------------------------- péniche */
  barge: {
    boat: true,
    palette: [TAR, [0.14, 0.12, 0.1], [0.12, 0.16, 0.13], [0.16, 0.1, 0.08]],
    palette2: [
      [0.75, 0.73, 0.68],
      [0.62, 0.18, 0.12],
      [0.2, 0.35, 0.3],
      [0.8, 0.78, 0.7]
    ],
    build(b) {
      const w = 5.0
      // Hull: bluff bow and stern, flat sides.
      const hull = { kind: PART.paint }
      b.cbox(-15, 15, w, -1.0, 1.0, P, hull)
      b.hexa(bow(15, 18, w, -1.0, 1.0, 1.6, 1.0), P, hull)
      b.hexa(bow(-15, -17.6, w, -1.0, 1.0, 2.0, 0.8), P, hull)
      b.cbox(-17.2, 17.6, w + 0.04, 0.82, 1.0, P, { kind: PART.paint2 }) // gunwale band
      // Cargo under tarpaulins before 1950; a houseboat's long cabin after.
      const cargo = { life: [-1e4, 1950] as [number, number] }
      b.cbox(-11.5, 11.5, w - 1.2, 1.0, 1.45, [0.32, 0.3, 0.26], cargo, [0.1, 0.1, 0.5, 0.5])
      const house = { life: [1950, 1e4] as [number, number] }
      b.cbox(-12.5, 9.0, w - 1.0, 1.0, 3.0, CREAM, house)
      b.sideGlass(-11.5, 8.0, (w - 1.0) / 2 + 0.01, 1.7, 2.5, house)
      b.cbox(-12.7, 9.2, w - 0.8, 3.0, 3.15, ZINC, house)
      // Stern cabin and wheelhouse.
      b.cbox(-16.6, -12.8, w - 1.0, 1.0, 2.9, CREAM)
      b.sideGlass(-16.0, -13.4, (w - 1.0) / 2 + 0.01, 2.0, 2.6)
      b.cbox(-16.8, -12.6, w - 0.8, 2.9, 3.05, DARKWOOD)
      // A mast for the towing line, on the wooden barges of Atget's photographs.
      b.bar([8, 0, 1.0], [8, 0, 10.5], 0.18, DARKWOOD, { life: [-1e4, 1930] })
      b.bar([-17.6, 0, 1.2], [-18.4, 0, -0.6], 0.25, DARKWOOD) // rudder
    }
  },

  /* ---------------------------------------- wash-boat (bateau-lavoir) */
  lavoir: {
    boat: true,
    palette: [
      [0.42, 0.36, 0.28],
      [0.36, 0.32, 0.27],
      [0.5, 0.45, 0.36],
      [0.4, 0.38, 0.34]
    ],
    palette2: [ZINC, [0.36, 0.3, 0.26], ZINC, [0.4, 0.38, 0.36]],
    build(b) {
      const w = 6.4
      const L = 13
      b.cbox(-L, L, w, -0.6, 0.6, TAR) // pontoon hull
      b.cbox(-L + 0.4, L - 0.4, w - 0.6, 0.6, 0.72, DARKWOOD) // washing deck
      // Open washing floor under the loft: posts all round.
      for (let x = -L + 0.6; x <= L - 0.5; x += 2.6) {
        for (const y of [w / 2 - 0.35, -w / 2 + 0.35]) b.box(x - 0.08, x + 0.08, y - 0.08, y + 0.08, 0.72, 3.0, P, { kind: PART.paint })
      }
      // Washing benches along the sides.
      b.box(-L + 0.6, L - 0.6, w / 2 - 0.9, w / 2 - 0.35, 0.72, 1.3, PD, { kind: PART.paint })
      b.box(-L + 0.6, L - 0.6, -w / 2 + 0.35, -w / 2 + 0.9, 0.72, 1.3, PD, { kind: PART.paint })
      // The drying loft above, with louvres, and its pitched roof.
      b.cbox(-L + 0.3, L - 0.3, w - 0.5, 3.0, 5.0, P, { kind: PART.paint })
      for (let z = 3.35; z < 4.8; z += 0.4) b.cbox(-L + 1, L - 1, w - 0.42, z, z + 0.08, PD, { kind: PART.paint })
      b.cbox(-L, L, w + 0.3, 5.0, 6.6, P, { kind: PART.paint2 }, [0, 0, w / 2 + 0.15 - 0.05, w / 2 + 0.15 - 0.05])
      // The laundry's boiler chimney.
      b.cbox(L - 3.2, L - 2.6, 0.6, 5.0, 7.6, [0.3, 0.2, 0.17])
    }
  },

  /* ------------------------------------------------------ floating baths */
  bath: {
    boat: true,
    palette: [
      [0.86, 0.84, 0.78],
      [0.8, 0.78, 0.7],
      [0.84, 0.8, 0.72],
      [0.78, 0.76, 0.72]
    ],
    palette2: [ZINC, [0.4, 0.42, 0.45], ZINC, ZINC],
    build(b) {
      const w = 9
      const L = 21
      b.cbox(-L, L, w, -0.7, 0.6, TAR)
      b.cbox(-L + 0.3, L - 0.3, w - 0.4, 0.6, 3.4, P, { kind: PART.paint })
      b.sideGlass(-L + 1.5, L - 1.5, (w - 0.4) / 2 + 0.01, 1.4, 2.8)
      b.cbox(-L + 0.6, L - 0.6, w - 1.2, 3.4, 5.6, P, { kind: PART.paint })
      b.sideGlass(-L + 2, L - 2, (w - 1.2) / 2 + 0.01, 4.0, 5.1)
      b.cbox(-L + 0.3, L - 0.3, w - 0.6, 5.6, 6.6, P, { kind: PART.paint2 }, [0.4, 0.4, 1.5, 1.5])
      // Cornice and flagpoles.
      b.cbox(-L + 0.2, L - 0.2, w - 0.2, 3.3, 3.55, PD, { kind: PART.paint })
      b.bar([L - 3, 0, 6.6], [L - 3, 0, 10.5], 0.1, DARKWOOD)
      b.bar([-L + 3, 0, 6.6], [-L + 3, 0, 10.5], 0.1, DARKWOOD)
      b.box(L - 2.95, L - 1.7, -0.02, 0.02, 9.6, 10.4, [0.6, 0.15, 0.12])
    }
  },

  /* ------------------------------------- steam river bus (bateau-mouche) */
  steamer: {
    boat: true,
    palette: [TAR, TAR, [0.12, 0.14, 0.18], TAR],
    palette2: [
      [0.85, 0.84, 0.8],
      [0.82, 0.8, 0.74],
      [0.86, 0.85, 0.82],
      [0.8, 0.78, 0.72]
    ],
    build(b) {
      const w = 4.4
      b.cbox(-12.5, 11, w, -0.8, 0.8, P, { kind: PART.paint })
      b.hexa(bow(11, 15, w, -0.8, 0.8, 0.2, 0.9), P, { kind: PART.paint })
      b.hexa(bow(-12.5, -14.5, w, -0.8, 0.8, 1.6, 0.7), P, { kind: PART.paint })
      // Saloon with windows, an awning on posts above the open deck.
      b.cbox(-11.5, 8.5, w - 0.6, 0.8, 2.6, P, { kind: PART.paint2 })
      b.sideGlass(-11, 8, (w - 0.6) / 2 + 0.01, 1.35, 2.25)
      b.cbox(-12, 9, w - 0.2, 2.6, 2.75, P, { kind: PART.paint2 })
      for (const x of [-11.5, -6, -0.5, 5, 8.6]) {
        for (const y of [w / 2 - 0.25, -w / 2 + 0.25]) b.bar([x, y, 2.75], [x, y, 4.3], 0.08, IRON)
      }
      b.cbox(-12.2, 9.3, w, 4.3, 4.45, CANVAS)
      // Funnel through the awning.
      b.cbox(-0.4, 0.4, 0.8, 2.75, 6.6, BLACK)
      b.cbox(-0.42, 0.42, 0.84, 5.6, 6.0, [0.65, 0.15, 0.1])
    }
  },

  /* ----------------------------------------------------- rowing boat */
  skiff: {
    boat: true,
    palette: [
      [0.3, 0.24, 0.18],
      [0.2, 0.3, 0.26],
      [0.45, 0.38, 0.28],
      [0.25, 0.28, 0.35]
    ],
    build(b) {
      const w = 1.5
      b.cbox(-2.2, 1.8, w, -0.25, 0.4, P, { kind: PART.paint }, [0, 0, 0, 0], [0.3, 0.2, 0.25, 0.25])
      b.hexa(bow(1.8, 2.75, w, -0.25, 0.45, 0.04, 0.35), P, { kind: PART.paint })
      b.cbox(-2.1, 1.7, w - 0.18, 0.2, 0.41, [0.12, 0.1, 0.08]) // the dark inside
      b.cbox(-0.5, -0.2, w - 0.2, 0.2, 0.32, WOOD) // thwart
      b.cbox(0.8, 1.1, w - 0.25, 0.2, 0.32, WOOD)
    }
  },

  /* ---------------------------------------- glass-roofed sightseeing boat */
  tourboat: {
    boat: true,
    palette: [
      [0.9, 0.9, 0.9],
      [0.88, 0.88, 0.87],
      [0.86, 0.87, 0.88],
      [0.9, 0.89, 0.86]
    ],
    palette2: [
      [0.2, 0.25, 0.42],
      [0.15, 0.3, 0.5],
      [0.55, 0.12, 0.12],
      [0.2, 0.25, 0.42]
    ],
    build(b) {
      const w = 7.0
      b.cbox(-17.5, 14.5, w, -0.8, 0.9, P, { kind: PART.paint })
      b.hexa(bow(14.5, 18.2, w, -0.8, 0.9, 0.6, 1.2), P, { kind: PART.paint })
      b.cbox(-17.55, 14.55, w + 0.04, 0.55, 0.85, P, { kind: PART.paint2 })
      // The long glazed saloon, a curved glass roof.
      b.cbox(-15.5, 12.5, w - 0.8, 0.9, 1.3, P, { kind: PART.paint })
      b.sideGlass(-15.3, 12.3, (w - 0.8) / 2 + 0.01, 1.3, 2.6)
      b.cbox(-15.5, 12.5, w - 0.8, 2.6, 3.1, GLASS, { kind: PART.glass }, [0.6, 0.4, 1.0, 1.0])
      b.crossGlass(12.5, (w - 0.8) / 2 - 0.1, 1.3, 2.6, 1, 0.5)
      // Open deck at the stern, with a rail.
      b.cbox(-17.4, -15.5, w - 0.4, 0.9, 1.9, IRON, {}, [0, 1.4, 0, 0])
    }
  }
}

/** Corners of a bow (or stern) block from x0 to the tip at x1: the tip is narrower (tipWidth) and raked by `rake`. */
export function bow(x0: number, x1: number, width: number, z0: number, z1: number, tipWidth: number, rake: number): V3[] {
  const s = Math.sign(x1 - x0)
  const xb = x1 - s * rake // the bottom of the tip lies back from the top
  const h = width / 2
  const t = tipWidth / 2
  const b = t * 0.6
  // hexa order: bottom (back, right), (front, right), (front, left), (back, left), then the top the same way.
  if (s > 0)
    return [
      [x0, -h, z0],
      [xb, -b, z0],
      [xb, b, z0],
      [x0, h, z0],
      [x0, -h, z1],
      [x1, -t, z1],
      [x1, t, z1],
      [x0, h, z1]
    ]
  // A stern: the tip is the back.
  return [
    [xb, -b, z0],
    [x0, -h, z0],
    [x0, h, z0],
    [xb, b, z0],
    [x1, -t, z1],
    [x0, -h, z1],
    [x0, h, z1],
    [x1, t, z1]
  ]
}

/** Build every model once. */
export function buildModels(): Record<string, ModelBuilder> {
  const out: Record<string, ModelBuilder> = {}
  for (const [id, def] of Object.entries(MODELS)) {
    const b = new ModelBuilder()
    def.build(b)
    out[id] = b
  }
  return out
}

/**
 * The period look: while walking, the 3D view is tinted, grained and
 * darkened at the edges like the photographs of the chosen year, so the
 * model and the archive photos read as one picture.
 *
 * It is a display effect, a CSS filter on the map's canvas and two layers
 * above it. It changes no data and no shader, and the app says so.
 *
 * The processes are those of the photos the app shows: Marville's albumen
 * prints of the 1850s to 1870s, Atget's prints from the 1890s, the
 * Albert-Kahn autochromes of 1907 to 1930s, then black-and-white and colour film.
 */

export interface PeriodLook {
  id: 'early' | 'albumen' | 'silver' | 'autochrome' | 'film' | 'colour'
  /** The photographs of the time, for the label: "albumen prints, as Marville's". */
  process: string
  /** CSS filter for the 3D canvas. */
  filter: string
  /** Strength of the grain layer, 0 to 1. */
  grain: number
  /** Colour grain, like the starch grains of an autochrome. */
  colourGrain: boolean
  /** Strength of the darkened corners, 0 to 1. */
  vignette: number
}

const LOOKS: { until: number; look: PeriodLook }[] = [
  {
    until: 1850,
    look: { id: 'early', process: 'the first paper prints of the 1840s', filter: 'grayscale(1) sepia(0.55) contrast(0.92) brightness(1.06)', grain: 0.3, colourGrain: false, vignette: 0.6 }
  },
  {
    until: 1890,
    look: { id: 'albumen', process: 'albumen prints, as Marville’s', filter: 'grayscale(1) sepia(0.8) saturate(1.25) hue-rotate(-6deg) contrast(1.1) brightness(1.04)', grain: 0.18, colourGrain: false, vignette: 0.45 }
  },
  {
    until: 1907,
    look: { id: 'silver', process: 'silver prints, as Atget’s', filter: 'grayscale(1) sepia(0.45) contrast(1.06) brightness(1.03)', grain: 0.22, colourGrain: false, vignette: 0.4 }
  },
  {
    until: 1936,
    look: { id: 'autochrome', process: 'autochrome colour plates, as the Albert-Kahn archive’s', filter: 'saturate(0.6) sepia(0.28) hue-rotate(-4deg) contrast(0.9) brightness(1.05)', grain: 0.4, colourGrain: true, vignette: 0.5 }
  },
  {
    until: 1970,
    look: { id: 'film', process: 'black-and-white film', filter: 'grayscale(1) contrast(1.16) brightness(0.98)', grain: 0.24, colourGrain: false, vignette: 0.3 }
  },
  {
    until: 2000,
    look: { id: 'colour', process: 'colour film', filter: 'saturate(0.82) sepia(0.16) contrast(1.04)', grain: 0.14, colourGrain: false, vignette: 0.2 }
  }
]

/** The look of the photographs of `year`, or null for today's pictures (2000 on). */
export function periodLook(year: number): PeriodLook | null {
  return LOOKS.find((l) => year < l.until)?.look ?? null
}

/** The line the app shows while the look is on. */
export function periodLabel(look: PeriodLook): string {
  return `Tinted like ${look.process}: a display effect, not part of the data`
}

/**
 * Grain tiles: fractal noise, grey or coloured, as SVG data URLs. Built once;
 * the layer moves the tile a little every few frames so the grain flickers.
 */
function noise(colour: boolean): string {
  const matrix = colour ? '1.6 0 0 0 -0.3  0 1.6 0 0 -0.3  0 0 1.6 0 -0.3  0 0 0 0 0.55' : '0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  1.4 0 0 0 -0.2'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="${matrix}"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

export class PeriodLayer {
  private grain: HTMLDivElement
  private vignette: HTMLDivElement
  private tiles = { grey: '', colour: '' }
  current: PeriodLook | null = null

  constructor(private canvas: HTMLCanvasElement, after: HTMLElement) {
    this.grain = document.createElement('div')
    this.grain.className = 'period-grain'
    this.vignette = document.createElement('div')
    this.vignette.className = 'period-vignette'
    for (const d of [this.grain, this.vignette]) {
      d.setAttribute('aria-hidden', 'true')
      d.hidden = true
    }
    after.after(this.vignette, this.grain)
  }

  /** Show the look of a year, or nothing (null). */
  set(look: PeriodLook | null) {
    this.current = look
    this.canvas.style.filter = look?.filter ?? ''
    this.grain.hidden = this.vignette.hidden = !look
    if (!look) return
    const key = look.colourGrain ? 'colour' : 'grey'
    this.tiles[key] ||= noise(look.colourGrain)
    this.grain.style.backgroundImage = this.tiles[key]
    this.grain.style.opacity = String(look.grain)
    this.vignette.style.opacity = String(look.vignette)
  }
}

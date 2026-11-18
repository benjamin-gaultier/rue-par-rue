/**
 * Lettering for the 3D streets: shop fascias, projecting signs, painted
 * advertisements on blind walls and house numbers.
 *
 * Every word is drawn once on a canvas when the city loads (no download,
 * no extra request) into a single-channel texture of 4 columns × 32 rows.
 * The last row of cells holds no word: the first pixels of the texture's
 * bottom row store the inked width of each cell, so the shader can fit a
 * word to its fascia without distortion.
 *
 * Which word a shop shows depends on its trade and on the year: the GLSL
 * function `signRow(trade, year, modern)` is generated from TRADES below.
 */

import * as THREE from 'three'

export type Font = 'serif' | 'sans' | 'slab'

/** A trade and the words on its fascia from a given year; `sans` entries are the modern (after about 1960) fronts. */
export interface Trade {
  name: string
  /** [from year, word, font], in order. The first entry applies to every earlier year. */
  periods: [number, string, Font][]
}

export const TRADES: Trade[] = [
  { name: 'wine', periods: [[0, 'MARCHAND DE VINS', 'serif'], [1890, 'VINS', 'serif'], [1950, 'BAR', 'sans']] },
  { name: 'wine2', periods: [[0, 'VINS', 'serif'], [1895, 'VINS ET LIQUEURS', 'serif'], [1950, 'CAFÉ', 'sans']] },
  { name: 'bakery', periods: [[0, 'BOULANGER', 'serif'], [1830, 'BOULANGERIE', 'serif'], [1950, 'BOULANGERIE', 'sans']] },
  // Tobacco was sold by grocers until the state monopoly of 1810 gave it its own shops.
  { name: 'tobacco', periods: [[0, 'ÉPICIER', 'serif'], [1815, 'TABAC', 'serif'], [1950, 'TABAC', 'sans']] },
  { name: 'cafe', periods: [[0, 'CAFÉ', 'serif'], [1880, 'BRASSERIE', 'serif'], [1950, 'BRASSERIE', 'sans']] },
  { name: 'hotel', periods: [[0, 'HÔTEL GARNI', 'serif'], [1850, 'HÔTEL MEUBLÉ', 'serif'], [1925, 'HÔTEL', 'serif'], [1950, 'HÔTEL', 'sans']] },
  { name: 'mercer', periods: [[0, 'MERCERIE', 'serif'], [1950, 'SOUVENIRS', 'sans']] },
  { name: 'books', periods: [[0, 'LIBRAIRIE', 'serif'], [1950, 'LIBRAIRIE', 'sans']] },
  { name: 'butcher', periods: [[0, 'BOUCHERIE', 'serif'], [1950, 'CRÊPERIE', 'sans']] },
  // Horse meat was sold legally from 1866.
  { name: 'horse', periods: [[0, 'BOUCHER', 'serif'], [1866, 'BOUCHERIE CHEVALINE', 'serif'], [1950, 'GLACES', 'sans']] },
  { name: 'barber', periods: [[0, 'PERRUQUIER', 'serif'], [1800, 'COIFFEUR', 'serif'], [1950, 'COIFFURE', 'sans']] },
  { name: 'grocer', periods: [[0, 'ÉPICERIE', 'serif'], [1950, 'ALIMENTATION', 'sans']] },
  { name: 'pharmacy', periods: [[0, 'APOTHICAIRE', 'serif'], [1800, 'PHARMACIE', 'serif'], [1950, 'PHARMACIE', 'sans']] },
  { name: 'dairy', periods: [[0, 'FRUITIER', 'serif'], [1850, 'CRÈMERIE', 'serif'], [1950, 'FROMAGERIE', 'sans']] },
  { name: 'pork', periods: [[0, 'CHARCUTIER', 'serif'], [1850, 'CHARCUTERIE', 'serif'], [1950, 'RESTAURANT', 'sans']] },
  // Clockmakers on the quai de l'Horloge, goldsmiths on the quai des Orfèvres.
  { name: 'clocks', periods: [[0, 'HORLOGER', 'serif'], [1850, 'HORLOGERIE', 'serif'], [1950, 'BIJOUTERIE', 'sans']] },
  { name: 'gold', periods: [[0, 'ORFÈVRE', 'serif'], [1950, 'GALERIE', 'sans']] },
  { name: 'stationer', periods: [[0, 'PAPETIER', 'serif'], [1850, 'PAPETERIE', 'serif'], [1950, 'CARTES POSTALES', 'sans']] },
  { name: 'restaurant', periods: [[0, 'TRAITEUR', 'serif'], [1830, 'RESTAURANT', 'serif'], [1880, 'BOUILLON', 'serif'], [1950, 'RESTAURANT', 'sans']] },
  { name: 'pastry', periods: [[0, 'PÂTISSIER', 'serif'], [1850, 'PÂTISSERIE', 'serif'], [1950, 'SALON DE THÉ', 'sans']] }
]

/** Index of each trade in TRADES, by name. */
export const TRADE = Object.fromEntries(TRADES.map((t, i) => [t.name, i])) as Record<string, number>

/**
 * Painted advertisements on blind gable walls (about 1880–1960): a big word
 * and a smaller line. Generic products, no brand names.
 */
export const ADS: [string, string][] = [
  ['QUINQUINA', 'APÉRITIF TONIQUE'],
  ['CHOCOLAT', 'À LA VANILLE'],
  ['SAVON', 'DE MARSEILLE'],
  ['CYCLES', 'ET AUTOMOBILES'],
  ['NOUVEAUTÉS', 'GRANDS MAGASINS'],
  ['AMEUBLEMENT', 'LITERIE'],
  ['VINS FINS', 'EN GROS'],
  ['BIÈRE', 'DE GARDE'],
  ['CAFÉ', 'TORRÉFIÉ'],
  ['PNEUMATIQUES', 'POUR VÉLOS'],
  ['DÉMÉNAGEMENTS', 'GARDE-MEUBLES'],
  ['ENCRE', 'POUR STYLOS']
]

export const ATLAS = { width: 2048, height: 2048, cols: 4, rows: 32, cellW: 512, cellH: 64 }

/** One atlas cell per distinct (word, font). */
export interface AtlasLayout {
  cells: { text: string; font: Font }[]
  index(text: string, font: Font): number
  /** Cell of the digits 0–9 (equal advance, centred in tenths of the cell). */
  digits: number
}

export function atlasLayout(): AtlasLayout {
  const cells: { text: string; font: Font }[] = []
  const at = new Map<string, number>()
  const index = (text: string, font: Font) => {
    const k = `${font}:${text}`
    let i = at.get(k)
    if (i === undefined) {
      i = cells.length
      cells.push({ text, font })
      at.set(k, i)
    }
    return i
  }
  for (const t of TRADES) for (const [, w, f] of t.periods) index(w, f)
  for (const [a, b] of ADS) {
    index(a, 'slab')
    index(b, 'sans')
  }
  const digits = index('0123456789', 'serif')
  // The last row of cells is kept free: its bottom pixels store the widths.
  if (cells.length > ATLAS.cols * (ATLAS.rows - 1)) throw new Error('sign atlas is full')
  return { cells, index, digits }
}

const LAYOUT = atlasLayout()

/** GLSL: `int signRow(int trade, float year, bool modern)`, `int adRow(int ad, bool line2)`, the digits cell and counts. */
export function signGlsl(layout: AtlasLayout = LAYOUT): string {
  const lines: string[] = []
  lines.push(`const int SIGN_TRADES = ${TRADES.length};`)
  lines.push(`const int SIGN_ADS = ${ADS.length};`)
  lines.push(`const int SIGN_DIGITS = ${layout.digits};`)
  lines.push('int signRow(int trade, float year, bool modern) {')
  TRADES.forEach((t, ti) => {
    const modern = t.periods.filter((p) => p[2] === 'sans')
    const old = t.periods.filter((p) => p[2] !== 'sans')
    const body: string[] = []
    if (modern.length) body.push(`if (modern) return ${layout.index(modern[modern.length - 1][1], 'sans')};`)
    for (let i = old.length - 1; i > 0; i--) body.push(`if (year >= ${old[i][0].toFixed(1)}) return ${layout.index(old[i][1], old[i][2])};`)
    body.push(`return ${layout.index(old[0][1], old[0][2])};`)
    lines.push(`  if (trade == ${ti}) { ${body.join(' ')} }`)
  })
  lines.push('  return 0;')
  lines.push('}')
  lines.push('int adRow(int ad, bool line2) {')
  ADS.forEach(([a, b], i) => lines.push(`  if (ad == ${i}) return line2 ? ${layout.index(b, 'sans')} : ${layout.index(a, 'slab')};`))
  lines.push('  return 0;')
  lines.push('}')
  return lines.join('\n')
}

/** The word a trade shows in a year (the JS twin of signRow, for tests and projecting signs). */
export function tradeWord(trade: number, year: number, modern: boolean): string {
  const t = TRADES[trade]
  const m = t.periods.filter((p) => p[2] === 'sans')
  if (modern && m.length) return m[m.length - 1][1]
  const old = t.periods.filter((p) => p[2] !== 'sans')
  let w = old[0][1]
  for (const [from, word] of old) if (year >= from) w = word
  return w
}

const FONTS: Record<Font, string> = {
  serif: '"Bodoni 72", Didot, "Bodoni MT", "Playfair Display", Georgia, "Times New Roman", "Noto Serif", "DejaVu Serif", serif',
  sans: '"Barlow Condensed", "Helvetica Neue", Arial, "Liberation Sans", "Noto Sans", sans-serif',
  slab: 'Rockwell, "Roboto Slab", "Courier New", "DejaVu Serif", serif'
}

/** Draw the atlas on a canvas and return the alpha channel (one byte per pixel). */
function drawAtlas(layout: AtlasLayout): Uint8Array | null {
  if (typeof document === 'undefined') return null
  const { width, height, cols, cellW, cellH } = ATLAS
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const widths: number[] = []
  layout.cells.forEach((cell, i) => {
    const x0 = (i % cols) * cellW
    const y0 = Math.floor(i / cols) * cellH
    const size = cell.font === 'sans' ? 56 : 48
    const weight = cell.font === 'sans' ? 700 : cell.font === 'slab' ? 800 : 700
    ctx.font = `${weight} ${size}px ${FONTS[cell.font]}`
    const max = cellW - 24
    if (i === layout.digits) {
      // Digits on a fixed advance of a tenth of the cell, so the shader can pick each one.
      for (let d = 0; d < 10; d++) ctx.fillText(String(d), x0 + (d + 0.5) * (cellW / 10), y0 + cellH / 2 + 2, cellW / 10 - 8)
      widths.push(1)
      return
    }
    const natural = ctx.measureText(cell.text).width
    const w = Math.min(natural, max)
    ctx.save()
    ctx.translate(x0 + cellW / 2, y0 + cellH / 2 + 2)
    ctx.scale(w / natural, 1)
    ctx.fillText(cell.text, 0, 0)
    ctx.restore()
    widths.push(w / cellW)
  })
  const data = ctx.getImageData(0, 0, width, height).data
  const out = new Uint8Array(width * height)
  // Rows are flipped so that texture v grows upward, like the wall's z.
  for (let y = 0; y < height; y++) {
    const src = y * width * 4
    const dst = (height - 1 - y) * width
    for (let x = 0; x < width; x++) out[dst + x] = data[src + x * 4 + 3]
  }
  // Widths in the first pixels of the texture's bottom row (under the free last row of cells).
  widths.forEach((w, i) => (out[i] = Math.round(Math.min(1, w) * 255)))
  return out
}

/** The sign atlas as a texture (an empty one outside a browser). Redrawn once web fonts are ready. */
export function signAtlas(): THREE.DataTexture {
  const { width, height } = ATLAS
  const data = drawAtlas(LAYOUT)
  const tex = data
    ? new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType)
    : new THREE.DataTexture(new Uint8Array(1), 1, 1, THREE.RedFormat, THREE.UnsignedByteType)
  tex.generateMipmaps = !!data
  tex.minFilter = data ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter
  tex.magFilter = data ? THREE.LinearFilter : THREE.NearestFilter
  tex.anisotropy = 4
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  if (data && typeof document !== 'undefined' && document.fonts) {
    document.fonts.ready.then(() => {
      const again = drawAtlas(LAYOUT)
      if (again) {
        ;(tex.image.data as Uint8Array).set(again)
        tex.needsUpdate = true
      }
    })
  }
  return tex
}

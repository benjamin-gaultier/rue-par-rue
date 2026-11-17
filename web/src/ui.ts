/**
 * DOM for the time bar, the photo panel and the layer controls.
 * Plain DOM, no framework: the app has a handful of moving parts.
 */

import { type Basemap, BASEMAPS, YEAR_MAX, YEAR_MIN } from './timeline'
import { type Bin, dateLabel, positionLabel, type PhotoProps, SOURCE_COLORS, SOURCE_NAMES, FALLBACK_COLOR } from './photos'
import type { TodayPicture } from './panoramax'
import { bestPicture } from './alignment'

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string | null | undefined)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else node.setAttribute(k, v)
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c)
  return node
}

const pct = (year: number) => ((year - YEAR_MIN) / (YEAR_MAX - YEAR_MIN)) * 100

/* ---------------------------------------------------------------- time bar */

export interface Timebar {
  setYear(year: number): void
  setBasemap(b: Basemap, nearestOnly: boolean): void
  setHistogram(bins: Bin[], binSize: number): void
  setPlaying(playing: boolean): void
}

export function buildTimebar(
  root: HTMLElement,
  handlers: { onYear: (y: number) => void; onPlay: () => void }
): Timebar {
  const year = el('output', { class: 'tb-year', id: 'year-out', 'aria-live': 'polite' })
  const mapTitle = el('span', { class: 'tb-map-title' })
  const mapDated = el('span', { class: 'tb-map-dated' })
  const mapNote = el('span', { class: 'tb-map-note' })
  const play = el('button', { class: 'tb-btn', type: 'button', id: 'play', 'aria-label': 'Play through the years' })
  const back = el('button', { class: 'tb-btn', type: 'button', 'aria-label': 'Back ten years', text: '−10' })
  const fwd = el('button', { class: 'tb-btn', type: 'button', 'aria-label': 'Forward ten years', text: '+10' })
  const range = el('input', {
    type: 'range',
    id: 'year-range',
    min: String(YEAR_MIN),
    max: String(YEAR_MAX),
    step: '1',
    'aria-label': 'Year'
  })
  const hist = el('div', { class: 'tb-hist', 'aria-hidden': 'true' })
  const band = el('div', { class: 'tb-band', title: "Haussmann's renovation, 1853–1870", 'aria-hidden': 'true' })
  band.style.left = `${pct(1853)}%`
  band.style.width = `${pct(1870) - pct(1853)}%`
  band.append(el('span', { text: 'Haussmann' }))

  const ticks = el('div', { class: 'tb-ticks' })
  for (const b of BASEMAPS) {
    const label = b.dated === 'today' ? 'today' : String(b.from)
    const t = el('button', {
      class: 'tb-tick',
      type: 'button',
      title: `${b.title}, ${b.dated}`,
      'aria-label': `Jump to ${label}: ${b.title}`
    })
    t.style.left = `${pct(Math.max(b.from, YEAR_MIN))}%`
    if (b.label) t.append(el('span', { text: label }))
    else t.classList.add('tb-tick-minor')
    t.addEventListener('click', () => handlers.onYear(b.dated === 'today' ? YEAR_MAX : b.from))
    ticks.append(t)
  }

  const axis = el('div', { class: 'tb-axis', 'aria-hidden': 'true' })
  for (let y = 1800; y <= 2000; y += 50) {
    const a = el('span', { text: String(y) })
    a.style.left = `${pct(y)}%`
    axis.append(a)
  }

  root.append(
    el('div', { class: 'tb-head' }, [
      year,
      el('div', { class: 'tb-map' }, [mapTitle, el('span', { class: 'tb-map-meta' }, [mapDated, mapNote])]),
      el('div', { class: 'tb-controls' }, [back, play, fwd])
    ]),
    el('div', { class: 'tb-track' }, [band, hist, range, ticks, axis])
  )

  range.addEventListener('input', () => handlers.onYear(Number(range.value)))
  back.addEventListener('click', () => handlers.onYear(Number(range.value) - 10))
  fwd.addEventListener('click', () => handlers.onYear(Number(range.value) + 10))
  play.addEventListener('click', handlers.onPlay)

  const api: Timebar = {
    setYear(y) {
      range.value = String(y)
      range.setAttribute('aria-valuetext', String(y))
      year.textContent = String(y)
    },
    setBasemap(b, nearestOnly) {
      mapTitle.textContent = b.title
      mapDated.textContent = b.dated === 'today' ? 'Today' : b.dated
      mapNote.textContent = nearestOnly ? 'Earliest survey available' : b.partial ? 'Covers the pre-1860 city' : ''
    },
    setHistogram(bins, binSize) {
      hist.replaceChildren()
      const max = Math.max(1, ...bins.map((b) => b.count))
      for (const b of bins) {
        if (!b.count) continue
        const bar = el('i')
        bar.style.left = `${pct(b.start)}%`
        bar.style.width = `${pct(b.start + binSize) - pct(b.start)}%`
        bar.style.height = `${Math.max(8, (b.count / max) * 100)}%`
        bar.title = `${b.start}–${b.start + binSize - 1}: ${b.count} photos`
        hist.append(bar)
      }
    },
    setPlaying(playing) {
      play.classList.toggle('is-playing', playing)
      play.setAttribute('aria-label', playing ? 'Pause' : 'Play through the years')
      play.textContent = playing ? '❚❚' : '▶'
    }
  }
  api.setPlaying(false)
  return api
}

/* ------------------------------------------------------------------- panel */

export interface Panel {
  show(p: PhotoProps): void
  hide(): void
  setToday(state: { loading: true } | { error: string } | { pictures: TodayPicture[] }): void
}

export function buildPanel(
  root: HTMLElement,
  onClose: () => void,
  onCompare: (pic: TodayPicture) => void,
  depth: { has: (id: string) => boolean; open: (p: PhotoProps) => void } = { has: () => false, open: () => {} }
): Panel {
  const close = el('button', { class: 'panel-close', type: 'button', 'aria-label': 'Close', text: '×' })
  const body = el('div', { class: 'panel-body' })
  const today = el('div', { class: 'today-list' })
  root.append(close, body)
  close.addEventListener('click', onClose)
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onClose()
  })

  const depthButton = (p: PhotoProps) => {
    const b = el('button', { class: 'depth-btn', type: 'button' }, [
      el('span', { text: 'View as a 3D photo' }),
      el('small', { text: 'AI depth estimate' })
    ])
    b.addEventListener('click', () => depth.open(p))
    return b
  }

  return {
    show(p) {
      const imgSrc = p.iiif ? `${p.iiif}/full/!900,900/0/default.jpg` : (p.thumb ?? p.image)
      const full = p.image ?? imgSrc
      const sourceName = SOURCE_NAMES[p.source] ?? p.source
      const swatch = el('i', { class: 'swatch', 'aria-hidden': 'true' })
      swatch.style.background = SOURCE_COLORS[p.source] ?? FALLBACK_COLOR
      const rows: [string, Node | string][] = [
        ['Date', dateLabel(p)],
        ...(p.creator ? ([['Photographer', p.creator]] as [string, string][]) : []),
        ['Source', el('span', {}, [swatch, sourceName])],
        ['Position', positionLabel(p)],
        ['Licence', p.license]
      ]
      const dl = el('dl', { class: 'facts' })
      for (const [k, v] of rows) dl.append(el('dt', { text: k }), el('dd', {}, [v]))
      const parts: (Node | null)[] = [
        el('figure', { class: 'then' }, [
          imgSrc
            ? el('a', { href: full ?? '#', target: '_blank', rel: 'noopener' }, [
                el('img', { src: imgSrc, alt: p.title, loading: 'lazy' })
              ])
            : el('div', { class: 'no-image', text: 'No image available' }),
          el('figcaption', { text: p.credit ?? '' })
        ]),
        el('h2', { class: 'panel-title', text: p.title }),
        depth.has(p.id) ? depthButton(p) : null,
        dl,
        p.url ? el('a', { class: 'archive-link', href: p.url, target: '_blank', rel: 'noopener', text: 'Open the archive record' }) : null,
        el('section', { class: 'today', 'aria-labelledby': 'today-h' }, [
          el('h3', { id: 'today-h', text: 'The same spot today' }),
          today,
          el('p', {
            class: 'today-credit',
            text: 'Street-level photos from Panoramax contributors. Licences: CC BY-SA 4.0 or Etalab 2.0, shown per photo.'
          })
        ])
      ]
      body.replaceChildren(...parts.filter((n): n is Node => n !== null))
      root.hidden = false
      close.focus({ preventScroll: true })
    },
    hide() {
      root.hidden = true
    },
    setToday(state) {
      if ('loading' in state) {
        today.replaceChildren(el('p', { class: 'muted', text: 'Looking for recent photos of this place…' }))
        return
      }
      if ('error' in state) {
        today.replaceChildren(el('p', { class: 'muted', text: `Panoramax could not be reached (${state.error}).` }))
        return
      }
      if (!state.pictures.length) {
        today.replaceChildren(
          el('p', { class: 'muted', text: 'Nobody has photographed this spot on Panoramax yet. You can add photos at panoramax.fr.' })
        )
        return
      }
      const best = bestPicture(state.pictures)!
      const compare = el('button', { class: 'compare-btn', type: 'button' }, [
        el('span', { text: 'Compare then and now' }),
        el('small', { text: best.is360 ? '360° panorama' : 'street photo' })
      ])
      compare.addEventListener('click', () => onCompare(best))
      const items = state.pictures.slice(0, 6).map((pic) => {
        const b = el('button', { class: 'today-item', type: 'button', title: `Compare with this photo (${pic.license})` }, [
          el('img', { src: pic.thumb, alt: `Street view taken ${pic.date}`, loading: 'lazy' }),
          el('span', { class: 'today-meta' }, [
            el('span', { text: pic.date || 'undated' }),
            el('span', { text: `${Math.round(pic.distance)} m` }),
            pic.is360 ? el('b', { text: '360°' }) : null
          ])
        ])
        b.addEventListener('click', () => onCompare(pic))
        return b
      })
      today.replaceChildren(compare, ...items)
    }
  }
}

/* ---------------------------------------------------------------- controls */

export interface ControlState {
  cadastre: boolean
  photos: boolean
  allYears: boolean
  panoramax: boolean
}

export function buildControls(
  root: HTMLElement,
  initial: ControlState,
  onChange: (s: ControlState) => void,
  onAbout: () => void
) {
  const state = { ...initial }
  const box = (key: keyof ControlState, label: string, hint?: string) => {
    const input = el('input', { type: 'checkbox', id: `opt-${key}` })
    input.checked = state[key]
    input.addEventListener('change', () => {
      state[key] = input.checked
      onChange({ ...state })
    })
    return el('label', { for: `opt-${key}`, class: 'opt' }, [input, el('span', {}, [label, hint ? el('small', { text: hint }) : null])])
  }
  const about = el('button', { type: 'button', class: 'about-btn', text: 'Sources & licences' })
  about.addEventListener('click', onAbout)
  root.append(
    box('cadastre', 'Vasserot street plan', 'Surveyed 1810–1836 · ghosted after 1860'),
    box('photos', 'Archive photographs'),
    box('allYears', 'Photos from every year'),
    box('panoramax', "Today's street imagery", 'Panoramax coverage'),
    about
  )
}

export function setPhotoStatus(root: HTMLElement, total: number, visible: number) {
  root.textContent =
    total === 0
      ? 'No archive photographs loaded yet. Run the harvest to add them.'
      : `${visible.toLocaleString('en')} of ${total.toLocaleString('en')} photographs shown for these years`
}

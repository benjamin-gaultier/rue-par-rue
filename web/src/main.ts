import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import {
  AttributionControl,
  NavigationControl,
  Popup,
  ScaleControl,
  type GeoJSONSource,
  type MapGeoJSONFeature
} from 'maplibre-gl'
import { BASEMAPS, basemapForYear, YEAR_MAX } from './timeline'
import { describeBuilding, Model3D, MODEL_COLORS, MODEL_LABELS, type ModelProps } from './model3d'
import { AREA, areaCenter, inArea } from './areas'
import type { PhotoFrames } from './frames3d'
import type { City3D } from './city3d'
import type { DepthIndex } from './depth'
import { Walker } from './walk'
import { clampYear, formatHash, parseHash, type ViewState } from './state'
import { histogram, inWindow, loadPhotos, type PhotoCollection, type PhotoFeature, type PhotoProps } from './photos'
import { picturesOf, type TodayPicture } from './panoramax'
import { formatAlignment, lookTarget, parseAlignment } from './alignment'
import type { ThenNow } from './thennow'
import {
  addCadastre,
  addPanoramaxCoverage,
  addPhotos,
  BasemapSwitcher,
  createMap,
  filterPhotos,
  selectionGeometry,
  setSelection,
  styleCadastre
} from './map'
import { buildControls, buildPanel, buildTimebar, type ControlState, setPhotoStatus } from './ui'

const BASE = import.meta.env.BASE_URL
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

const initial = parseHash(location.hash)
const state: ViewState = { ...initial }
const controls: ControlState = { cadastre: true, photos: true, allYears: false, panoramax: false }

const map = createMap($('#map'), [initial.lon!, initial.lat!], initial.zoom!)
map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

/** On phones, keep the credits folded behind their (i) button: open, they cover the controls. */
function foldCredits() {
  if (!window.matchMedia('(max-width: 720px)').matches) return
  map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show')
}
map.once('idle', foldCredits)
map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

const basemaps = new BasemapSwitcher(map, BASE)
const model = new Model3D(map, BASE, 'selection-cone', AREA)
let ready = false // set once the load handler has added sources and layers
let photos: PhotoFeature[] = []
const byId = new Map<string, PhotoFeature>()

/* ----------------------------------------------------------------- URL hash */

let hashTimer = 0
function writeHash() {
  window.clearTimeout(hashTimer)
  hashTimer = window.setTimeout(() => {
    const c = map.getCenter()
    Object.assign(state, { zoom: map.getZoom(), lat: c.lat, lon: c.lng, bearing: map.getBearing(), pitch: map.getPitch() })
    history.replaceState(null, '', formatHash(state))
  }, 250)
}

/* ------------------------------------------------------------------- year */

const timebar = buildTimebar($('#timebar'), {
  onYear: (y) => {
    stopPlaying()
    setYear(y)
  },
  onPlay: () => (playTimer ? stopPlaying() : startPlaying())
})

function setYear(y: number) {
  const year = clampYear(y)
  state.year = year
  timebar.setYear(year)
  let { basemap, nearestOnly } = basemapForYear(year)
  // The Allmaps layer cannot be tilted, so the 3D view starts at the 1820 map.
  if (model.active && basemap.source.kind === 'allmaps') {
    basemap = BASEMAPS.find((b) => b.id === 'etatmajor')!
    nearestOnly = true
  }
  timebar.setBasemap(basemap, nearestOnly)
  if (ready) {
    void basemaps.show(basemap)
    model.setYear(year)
    city?.setYear(year)
    refreshFrames()
    walker.ensureFree()
    styleCadastre(map, year, controls.cadastre)
    filterPhotos(map, year, controls.allYears)
  }
  updatePhotoStatus()
  writeHash()
}

let playTimer = 0
function startPlaying() {
  if (state.year >= YEAR_MAX) setYear(1785)
  const step = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 10 : 2
  playTimer = window.setInterval(() => {
    if (state.year >= YEAR_MAX) return stopPlaying()
    setYear(state.year + step)
  }, 220)
  timebar.setPlaying(true)
}
function stopPlaying() {
  if (!playTimer) return
  window.clearInterval(playTimer)
  playTimer = 0
  timebar.setPlaying(false)
}

/* ------------------------------------------------------------------ photos */

const panelRoot = $('#panel')
let depthIndex: DepthIndex = {}
const panel = buildPanel(panelRoot, () => select(undefined), (pic) => openCompare(pic), {
  has: (id) => id in depthIndex,
  open: (p) => void openDepth(p)
})

/** Photos with an AI depth map open as 3D photos (depth.ts, loaded on demand). */
async function openDepth(p: PhotoProps) {
  const entry = depthIndex[p.id]
  const f = byId.get(p.id)
  if (!entry || !f) return
  const { openDepthViewer, depthImageUrl } = await import('./depth')
  const imageUrl = depthImageUrl(BASE, f, entry)
  if (!imageUrl) return
  await openDepthViewer($('#thennow'), {
    title: p.title,
    caption: `${p.credit ?? ''} · Depth estimated by Depth Anything V2 Small from this single photograph: a parallax effect, not a measured model.`,
    imageUrl,
    depthUrl: `${BASE}data/3d/depth/${entry.depth}`,
    onClose: () => panelRoot.focus({ preventScroll: true })
  })
}
let todayAbort: AbortController | undefined
let todayPictures: TodayPicture[] = []
let compare: ThenNow | undefined

function updatePhotoStatus() {
  const visible = controls.allYears ? photos.length : photos.filter((f) => inWindow(f.properties, state.year)).length
  setPhotoStatus($('#photo-status'), photos.length, visible)
}

function select(id: string | undefined, fly = false, resume?: string) {
  todayAbort?.abort()
  compare?.close()
  todayPictures = []
  state.photo = id
  state.align = undefined
  writeHash()
  const f = id ? byId.get(id) : undefined
  if (!f) {
    panel.hide()
    setSelection(map, { type: 'FeatureCollection', features: [] })
    return
  }
  const p = f.properties
  const lonlat = f.geometry.coordinates
  setSelection(map, selectionGeometry(lonlat, p.heading, p.fov))
  panel.show(p)
  if (fly) map.flyTo({ center: lonlat, zoom: Math.max(map.getZoom(), 17), speed: 1.4 })
  loadToday(p, lonlat, resume)
}

function setPhotos(data: PhotoCollection) {
  photos = data.features
  byId.clear()
  for (const f of photos) byId.set(f.properties.id, f)
  ;(map.getSource('photos') as GeoJSONSource | undefined)?.setData(data as unknown as GeoJSON.FeatureCollection)
  timebar.setHistogram(histogram(photos, 1780, YEAR_MAX, 5), 5)
  updatePhotoStatus()
}

async function loadToday(p: PhotoProps, lonlat: [number, number], resume?: string) {
  todayAbort = new AbortController()
  panel.setToday({ loading: true })
  try {
    todayPictures = await picturesOf(lookTarget(lonlat, p.heading), { signal: todayAbort.signal })
    panel.setToday({ pictures: todayPictures })
    const saved = parseAlignment(resume)
    const pic = saved && todayPictures.find((x) => x.id === saved.pic)
    if (pic) openCompare(pic, saved)
  } catch (err) {
    if ((err as Error).name !== 'AbortError') panel.setToday({ error: (err as Error).message })
  }
}

/* ------------------------------------------------------------ then & now */

async function openCompare(pic: TodayPicture, saved = parseAlignment(state.align)) {
  const f = state.photo ? byId.get(state.photo) : undefined
  if (!f) return
  const { openThenNow } = await import('./thennow')
  compare?.close()
  compare = openThenNow($('#thennow'), {
    photo: f.properties,
    lonlat: f.geometry.coordinates,
    pictures: todayPictures,
    picture: pic,
    alignment: saved,
    onAlign: (a) => {
      state.align = formatAlignment(a)
      writeHash()
    },
    onClose: () => {
      compare = undefined
      state.align = undefined
      writeHash()
      panelRoot.focus({ preventScroll: true })
    }
  })
}

/* ---------------------------------------------------------------- controls */

buildControls(
  $('#controls'),
  controls,
  (s) => {
    Object.assign(controls, s)
    styleCadastre(map, state.year, controls.cadastre)
    photoDotsVisible()
    refreshFrames()
    if (map.getLayer('panoramax-sequences'))
      map.setLayoutProperty('panoramax-sequences', 'visibility', controls.panoramax ? 'visible' : 'none')
    filterPhotos(map, state.year, controls.allYears)
    updatePhotoStatus()
  },
  () => ($('#about') as HTMLDialogElement).showModal()
)
$('#about-close').addEventListener('click', () => ($('#about') as HTMLDialogElement).close())

/* ---------------------------------------------------------------------- 3D */

const btn3d = $('#btn-3d') as HTMLButtonElement
const banner3d = $('#banner-3d')
const legend3d = $('#legend-3d')
for (const kind of ['standing', 'traced', 'reconstructed', 'later'] as const) {
  const chip = document.createElement('span')
  const sw = document.createElement('i')
  sw.style.background = MODEL_COLORS[kind]
  chip.append(sw, MODEL_LABELS[kind])
  legend3d.append(chip)
}

/* Photos as frames in the 3D streets (frames3d.ts, loaded on demand). */
const AREA_CENTER = areaCenter(AREA)
let frames: PhotoFrames | undefined
let framesModule: typeof import('./frames3d') | undefined
let thumbIndex: Record<string, string> = {}

async function ensureFrames() {
  if (frames) return
  framesModule = await import('./frames3d')
  try {
    thumbIndex = await (await fetch(`${BASE}data/3d/thumbs/index.json`)).json()
  } catch {
    thumbIndex = {}
  }
  frames = new framesModule.PhotoFrames(
    AREA_CENTER,
    (f) => {
      const thumb = thumbIndex[f.properties.id]
      if (thumb) return `${BASE}data/3d/thumbs/${thumb}`
      // The Albert-Kahn portal serves its images with CORS headers.
      if (f.properties.source === 'kahn') return f.properties.image
      return undefined
    },
    (f) => {
      const e = depthIndex[f.properties.id]
      return e ? { depth: `${BASE}data/3d/depth/${e.depth}`, image: e.image ? `${BASE}data/3d/depth/${e.image}` : undefined } : undefined
    }
  )
  map.addLayer(frames)
}

/* The detailed focus area around Notre-Dame (city3d.ts, loaded on demand). */
let city: City3D | undefined
let cityLoading: Promise<void> | undefined

function ensureCity(): Promise<void> {
  cityLoading ??= (async () => {
    try {
      const [{ City3D }, { CITY_MODULES }] = await Promise.all([import('./city3d'), import('./citymodules')])
      const modules = (
        await Promise.all(
          CITY_MODULES.map((load) =>
            load()
              .then((m) => m.default)
              .catch((err) => {
                console.warn('City module unavailable:', err)
                return undefined
              })
          )
        )
      ).filter((m): m is NonNullable<typeof m> => m !== undefined)
      const layer = new City3D(AREA_CENTER)
      layer.onFail = (reason) => {
        // Fall back to the plain blocks, and say why.
        model.setHideFocus(false)
        walker.extraBlock = undefined
        walker.skipIds = undefined
        const note = document.createElement('p')
        note.className = 'banner-3d-error'
        note.textContent = `The detailed island cannot be drawn on this device: ${reason}. Showing plain blocks instead.`
        banner3d.querySelector('.banner-3d-text')?.append(note)
      }
      await layer.load(AREA.files, modules, BASE)
      map.addLayer(layer, map.getLayer('photo-frames') ? 'photo-frames' : undefined)
      city = layer
      city.setYear(state.year)
      city.setVisible(model.active)
      model.setHideFocus(true)
      walker.extraBlock = (p) => city?.isBlocked(p, state.year) ?? false
      walker.skipIds = city.buildingIds
    } catch (err) {
      console.warn('Detailed 3D area unavailable:', err)
    }
  })()
  return cityLoading
}

function refreshFrames() {
  if (!frames || !framesModule) return
  if (!model.active || !controls.photos) return frames.setGroups([])
  const groups = framesModule.groupPhotos(photos, state.year, controls.allYears, AREA.bounds, undefined, (f) => f.properties.id in depthIndex)
  const c = map.getCenter()
  frames.setGroups(framesModule.nearestGroups(groups, [c.lng, c.lat], 120))
}

function photoDotsVisible() {
  const show = controls.photos && !model.active
  if (map.getLayer('photos')) map.setLayoutProperty('photos', 'visibility', show ? 'visible' : 'none')
}

function enter3D(fly = true) {
  if (!ready) return
  if (fly && (state.year < 1810 || state.year >= 1860)) setYear(1836)
  model.enter(state.year, fly)
  state.view3d = true
  banner3d.hidden = false
  btn3d.setAttribute('aria-pressed', 'true')
  document.body.classList.add('is-3d')
  map.once('idle', foldCredits) // the 3D sources add their credits
  setYear(state.year) // reapply the basemap rule for 3D
  photoDotsVisible()
  city?.setVisible(true)
  void ensureCity()
  void ensureFrames().then(refreshFrames)
}

function exit3D() {
  stopWalk(false)
  model.exit()
  state.view3d = false
  banner3d.hidden = true
  btn3d.setAttribute('aria-pressed', 'false')
  document.body.classList.remove('is-3d')
  frames?.setGroups([])
  city?.setVisible(false)
  setYear(state.year)
  photoDotsVisible()
}

/* Walking at street level (walk.ts). */
const walker = new Walker(map, BASE + AREA.files.model, () => state.year)
const walkUi = $('#walk-ui')

async function startWalk() {
  if (!model.active) enter3D(false)
  await ensureCity() // so the river blocks the way from the first step
  const c = map.getCenter()
  const inside = inArea(AREA, c.lng, c.lat)
  // Straight after the fly-in the centre is the camera target, at the foot of
  // Notre-Dame's tower: start on the parvis instead, facing the west front.
  const [tx, ty] = AREA.camera.to
  const atTarget = Math.hypot((c.lng - tx) * 73300, (c.lat - ty) * 111200) < 40
  const here = inside && !atTarget
  await walker.start(here ? [c.lng, c.lat] : AREA.walk.start, here ? map.getBearing() : AREA.walk.bearing)
  basemaps.setDimmed(true)
  walkUi.hidden = false
  banner3d.classList.add('is-walking')
  document.body.classList.add('is-walking-mode')
  refreshFrames()
}

function stopWalk(rise = true) {
  if (!walker.active) return
  walker.stop()
  basemaps.setDimmed(false)
  walkUi.hidden = true
  banner3d.classList.remove('is-walking')
  document.body.classList.remove('is-walking-mode')
  if (rise) map.easeTo({ zoom: 18, pitch: 62, duration: 900 })
}

$('#walk-3d').addEventListener('click', () => void startWalk())
$('#walk-stop').addEventListener('click', () => stopWalk())
for (const b of walkUi.querySelectorAll<HTMLButtonElement>('[data-key]')) {
  const key = b.dataset.key!
  const up = () => walker.press(key, false)
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    walker.press(key, true)
  })
  b.addEventListener('pointerup', up)
  b.addEventListener('pointerleave', up)
  b.addEventListener('pointercancel', up)
}

btn3d.addEventListener('click', () => (model.active ? exit3D() : enter3D()))

const buildingPopup = new Popup({ closeButton: true, maxWidth: '300px', className: 'building-popup' })
function showBuilding(p: ModelProps, at: [number, number]) {
  const d = describeBuilding(p)
  const box = document.createElement('div')
  const h = document.createElement('strong')
  h.textContent = d.title
  box.append(h)
  for (const line of d.lines) {
    const el = document.createElement('p')
    el.textContent = line
    box.append(el)
  }
  if (d.link) {
    const a = document.createElement('a')
    a.href = d.link.href
    a.target = '_blank'
    a.rel = 'noopener'
    a.textContent = d.link.text
    box.append(a)
  }
  buildingPopup.setLngLat(at).setDOMContent(box).addTo(map)
}
$('#exit-3d').addEventListener('click', exit3D)

/* --------------------------------------------------------------------- boot */

timebar.setYear(state.year)
timebar.setBasemap(basemapForYear(state.year).basemap, basemapForYear(state.year).nearestOnly)

const depthReady = import('./depth')
  .then(async ({ loadDepthIndex }) => {
    depthIndex = await loadDepthIndex(BASE)
  })
  .catch(() => undefined)

map.on('load', async () => {
  addCadastre(map, BASE)
  addPanoramaxCoverage(map)
  const data = await loadPhotos(BASE)
  addPhotos(map, { type: 'FeatureCollection', features: [] })
  setPhotos(data)
  ready = true
  setYear(state.year)
  if (initial.view3d) {
    enter3D(false)
    if (initial.pitch === undefined) map.jumpTo(AREA.view)
    else map.jumpTo({ pitch: initial.pitch, bearing: initial.bearing ?? 0 })
  }

  map.on('click', 'photos', (e) => {
    const f = e.features?.[0] as MapGeoJSONFeature | undefined
    if (f) select(String(f.properties.id))
  })
  map.on('click', (e) => {
    if (!model.active || !map.getLayer('model')) return
    const framed = frames?.pick(e.point)
    if (framed) return select(framed.properties.id)
    const detailed = city?.pick(e.point)
    if (detailed) return showBuilding(detailed, [e.lngLat.lng, e.lngLat.lat])
    const f = map.queryRenderedFeatures(e.point, { layers: ['model'] })[0]
    if (f) showBuilding(f.properties as unknown as ModelProps, [e.lngLat.lng, e.lngLat.lat])
  })
  map.on('mouseenter', 'photos', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'photos', () => (map.getCanvas().style.cursor = ''))
  await depthReady // so a shared link's panel knows about its 3D photo
  if (initial.photo) select(initial.photo, true, initial.align)
})
map.on('moveend', () => {
  writeHash()
  if (model.active) refreshFrames()
})
if (new URLSearchParams(location.search).has('debug')) {
  /** What the area costs, for the README's baseline (measure.ts, tools/baseline/README.md). */
  const measure = async (options?: import('./measure').MeasureOptions) => {
    await ensureCity()
    if (!city) throw new Error('The detailed area did not load')
    return (await import('./measure')).measure(map, city, AREA, state.year, startWalk, options)
  }
  Object.assign(window, { rpr: { map, basemaps, state, setPhotos, select, openCompare, setYear, startWalk, city: () => city, walker, measure } })
}

window.addEventListener('hashchange', () => {
  const next = parseHash(location.hash)
  if (next.year !== state.year) setYear(next.year)
  if (next.photo !== state.photo) select(next.photo, true)
})
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
  if (e.key === 'Escape' && walker.active && !state.photo) return stopWalk()
  if (e.key === 'Escape' && state.photo && !compare) select(undefined)
})

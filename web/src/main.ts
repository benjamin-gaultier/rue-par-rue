import 'maplibre-gl/dist/maplibre-gl.css'
import './style.css'
import {
  AttributionControl,
  NavigationControl,
  ScaleControl,
  type GeoJSONSource,
  type MapGeoJSONFeature
} from 'maplibre-gl'
import { basemapForYear, YEAR_MAX } from './timeline'
import { clampYear, formatHash, parseHash, type ViewState } from './state'
import { histogram, inWindow, loadPhotos, type PhotoCollection, type PhotoFeature, type PhotoProps } from './photos'
import { picturesOf } from './panoramax'
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
map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')

const basemaps = new BasemapSwitcher(map, BASE)
let ready = false // set once the load handler has added sources and layers
let photos: PhotoFeature[] = []
const byId = new Map<string, PhotoFeature>()

/* ----------------------------------------------------------------- URL hash */

let hashTimer = 0
function writeHash() {
  window.clearTimeout(hashTimer)
  hashTimer = window.setTimeout(() => {
    const c = map.getCenter()
    Object.assign(state, { zoom: map.getZoom(), lat: c.lat, lon: c.lng })
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
  const { basemap, nearestOnly } = basemapForYear(year)
  timebar.setBasemap(basemap, nearestOnly)
  if (ready) {
    void basemaps.show(basemap)
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
const panel = buildPanel(panelRoot, () => select(undefined))
let todayAbort: AbortController | undefined

function updatePhotoStatus() {
  const visible = controls.allYears ? photos.length : photos.filter((f) => inWindow(f.properties, state.year)).length
  setPhotoStatus($('#photo-status'), photos.length, visible)
}

function select(id: string | undefined, fly = false) {
  todayAbort?.abort()
  state.photo = id
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
  loadToday(p, lonlat)
}

function setPhotos(data: PhotoCollection) {
  photos = data.features
  byId.clear()
  for (const f of photos) byId.set(f.properties.id, f)
  ;(map.getSource('photos') as GeoJSONSource | undefined)?.setData(data as unknown as GeoJSON.FeatureCollection)
  timebar.setHistogram(histogram(photos, 1780, YEAR_MAX, 5), 5)
  updatePhotoStatus()
}

/** Where the photographer was looking: a little ahead when the heading is known. */
function lookTarget(p: PhotoProps, lonlat: [number, number]): [number, number] {
  if (p.heading === undefined) return lonlat
  const d = 20
  const r = (p.heading * Math.PI) / 180
  return [
    lonlat[0] + (Math.sin(r) * d) / (111320 * Math.cos((lonlat[1] * Math.PI) / 180)),
    lonlat[1] + (Math.cos(r) * d) / 111320
  ]
}

async function loadToday(p: PhotoProps, lonlat: [number, number]) {
  todayAbort = new AbortController()
  panel.setToday({ loading: true })
  try {
    const pictures = await picturesOf(lookTarget(p, lonlat), { signal: todayAbort.signal })
    panel.setToday({ pictures })
  } catch (err) {
    if ((err as Error).name !== 'AbortError') panel.setToday({ error: (err as Error).message })
  }
}

/* ---------------------------------------------------------------- controls */

buildControls(
  $('#controls'),
  controls,
  (s) => {
    Object.assign(controls, s)
    styleCadastre(map, state.year, controls.cadastre)
    if (map.getLayer('photos')) map.setLayoutProperty('photos', 'visibility', controls.photos ? 'visible' : 'none')
    if (map.getLayer('panoramax-sequences'))
      map.setLayoutProperty('panoramax-sequences', 'visibility', controls.panoramax ? 'visible' : 'none')
    filterPhotos(map, state.year, controls.allYears)
    updatePhotoStatus()
  },
  () => ($('#about') as HTMLDialogElement).showModal()
)
$('#about-close').addEventListener('click', () => ($('#about') as HTMLDialogElement).close())

/* --------------------------------------------------------------------- boot */

timebar.setYear(state.year)
timebar.setBasemap(basemapForYear(state.year).basemap, basemapForYear(state.year).nearestOnly)

map.on('load', async () => {
  addCadastre(map, BASE)
  addPanoramaxCoverage(map)
  const data = await loadPhotos(BASE)
  addPhotos(map, { type: 'FeatureCollection', features: [] })
  setPhotos(data)
  ready = true
  setYear(state.year)

  map.on('click', 'photos', (e) => {
    const f = e.features?.[0] as MapGeoJSONFeature | undefined
    if (f) select(String(f.properties.id))
  })
  map.on('mouseenter', 'photos', () => (map.getCanvas().style.cursor = 'pointer'))
  map.on('mouseleave', 'photos', () => (map.getCanvas().style.cursor = ''))
  if (initial.photo) select(initial.photo, true)
})
map.on('moveend', writeHash)
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { rpr: { map, basemaps, state, setPhotos, select } })

window.addEventListener('hashchange', () => {
  const next = parseHash(location.hash)
  if (next.year !== state.year) setYear(next.year)
  if (next.photo !== state.photo) select(next.photo, true)
})
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
  if (e.key === 'Escape' && state.photo) select(undefined)
})

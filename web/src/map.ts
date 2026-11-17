/**
 * Map assembly: basemaps that change with the year, the 1836 cadastre
 * overlay, Panoramax coverage, and the archive photo layer.
 */

import {
  addProtocol,
  Map as MapLibreMap,
  setWorkerUrl,
  type CustomLayerInterface,
  type GeoJSONSource,
  type StyleSpecification
} from 'maplibre-gl'
import { Protocol } from 'pmtiles'
// MapLibre 6 resolves its worker next to its own module, which breaks once
// bundled. Ship the worker as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { WarpedMapLayer } from '@allmaps/maplibre'
import { type Basemap, BASEMAPS, cadastreMode, wmtsTileUrl } from './timeline'
import { colorExpression, type PhotoCollection, yearFilter } from './photos'
import { PANORAMAX_TILES } from './panoramax'

const FADE_MS = 450
const PAPER = '#ebe5d6'

// Lowest overlay layer: every basemap is inserted beneath it.
const OVERLAY_FLOOR = 'cadastre-ilots'

export const CADASTRE_LAYERS = {
  voirie: { file: 'vasserot/voirie.pmtiles', sourceLayer: 'Vasserot_Emprise_de_la_voiriefgb' },
  ilots: { file: 'vasserot/ilots.pmtiles', sourceLayer: 'Vasserot_Ilotsfgb' },
  parcelles: { file: 'vasserot/parcelles.pmtiles', sourceLayer: 'Vasserots_parcelles2_vfgb' }
}

let protocolAdded = false

export function createMap(container: HTMLElement, center: [number, number], zoom: number): MapLibreMap {
  if (!protocolAdded) {
    setWorkerUrl(workerUrl)
    addProtocol('pmtiles', new Protocol().tile)
    protocolAdded = true
  }
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [{ id: 'paper', type: 'background', paint: { 'background-color': PAPER } }]
  }
  return new MapLibreMap({
    container,
    style,
    center,
    zoom,
    minZoom: 10,
    maxZoom: 20,
    maxPitch: 0, // the Allmaps layer does not support pitch
    dragRotate: false,
    maxBounds: [
      [1.9, 48.6],
      [2.8, 49.1]
    ],
    attributionControl: false
  })
}

/** Shows one basemap at a time and cross-fades between them. */
export class BasemapSwitcher {
  private added = new Set<string>()
  private warped?: WarpedMapLayer
  private warpedLoading?: Promise<void>
  private activeId?: string
  private hideTimers = new Map<string, number>()

  constructor(
    private map: MapLibreMap,
    private base: string
  ) {}

  get active(): string | undefined {
    return this.activeId
  }

  async show(b: Basemap): Promise<void> {
    if (this.activeId === b.id) return
    const previous = this.activeId
    this.activeId = b.id
    if (b.source.kind === 'wmts') {
      this.ensureRaster(b)
      this.fadeRaster(b.id, 1)
    } else {
      await this.ensureWarped(b.source.url)
      if (this.activeId === b.id) this.warped?.setLayerOptions({ visible: true })
    }
    if (previous && previous !== b.id) this.hide(previous)
  }

  private hide(id: string) {
    const b = BASEMAPS.find((x) => x.id === id)
    if (!b) return
    if (b.source.kind === 'wmts') this.fadeRaster(id, 0)
    else this.warped?.setLayerOptions({ visible: false })
  }

  private ensureRaster(b: Basemap) {
    if (this.added.has(b.id) || b.source.kind !== 'wmts') return
    const s = b.source
    this.map.addSource(b.id, {
      type: 'raster',
      tiles: [wmtsTileUrl(s)],
      tileSize: 256,
      minzoom: s.minzoom ?? 0,
      maxzoom: s.maxzoom,
      attribution: b.attribution
    })
    this.map.addLayer(
      {
        id: b.id,
        type: 'raster',
        source: b.id,
        layout: { visibility: 'none' },
        paint: {
          'raster-opacity': 0,
          'raster-opacity-transition': { duration: FADE_MS, delay: 0 },
          'raster-fade-duration': 150
        }
      },
      this.map.getLayer(OVERLAY_FLOOR) ? OVERLAY_FLOOR : undefined
    )
    this.added.add(b.id)
  }

  private fadeRaster(id: string, opacity: 0 | 1) {
    const timer = this.hideTimers.get(id)
    if (timer) window.clearTimeout(timer)
    if (opacity === 1) {
      this.map.setLayoutProperty(id, 'visibility', 'visible')
      // Let the layer become visible before the opacity transition starts.
      requestAnimationFrame(() => this.map.setPaintProperty(id, 'raster-opacity', 1))
    } else {
      this.map.setPaintProperty(id, 'raster-opacity', 0)
      this.hideTimers.set(
        id,
        window.setTimeout(() => {
          if (this.activeId !== id) this.map.setLayoutProperty(id, 'visibility', 'none')
        }, FADE_MS + 50)
      )
    }
  }

  private ensureWarped(url: string): Promise<void> {
    if (this.warpedLoading) return this.warpedLoading
    // Allmaps is large; load it only when the 1790 map is first needed.
    this.warpedLoading = import('@allmaps/maplibre')
      .then(({ WarpedMapLayer }) => {
        this.warped = new WarpedMapLayer({ layerId: 'verniquet' })
        this.map.addLayer(
          this.warped as unknown as CustomLayerInterface,
          this.map.getLayer(OVERLAY_FLOOR) ? OVERLAY_FLOOR : undefined
        )
        if (this.activeId !== 'verniquet') this.warped.setLayerOptions({ visible: false })
        return fetch(this.base + url)
      })
      .then((r) => r.json())
      .then((annotation) => this.warped!.addGeoreferenceAnnotation(annotation))
      .then(() => undefined)
      .catch((err) => console.error('Could not load the Verniquet atlas', err))
    return this.warpedLoading
  }
}

export function addCadastre(map: MapLibreMap, base: string) {
  const url = (file: string) => `pmtiles://${new URL(base + 'data/' + file, window.location.href).href}`
  const attribution = 'Vasserot cadastre 1810–1836: Arch. nat., Arch. Paris, © ALPAGE (ODbL)'
  for (const [key, def] of Object.entries(CADASTRE_LAYERS)) {
    map.addSource(`cadastre-${key}`, { type: 'vector', url: url(def.file), attribution })
  }
  map.addLayer({
    id: 'cadastre-ilots',
    type: 'fill',
    source: 'cadastre-ilots',
    'source-layer': CADASTRE_LAYERS.ilots.sourceLayer,
    paint: { 'fill-color': '#d9c9a3', 'fill-opacity': 0.35, 'fill-outline-color': '#8a6d3b' }
  })
  map.addLayer({
    id: 'cadastre-parcelles',
    type: 'line',
    source: 'cadastre-parcelles',
    'source-layer': CADASTRE_LAYERS.parcelles.sourceLayer,
    minzoom: 15,
    paint: { 'line-color': '#7a5c2e', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 0.3, 18, 1], 'line-opacity': 0.7 }
  })
  map.addLayer({
    id: 'cadastre-voirie',
    type: 'line',
    source: 'cadastre-voirie',
    'source-layer': CADASTRE_LAYERS.voirie.sourceLayer,
    paint: { 'line-color': '#5b3d12', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.4, 17, 1.6] }
  })
}

/**
 * Before 1860 the cadastre is drawn as the street plan. After, it becomes a
 * thin ghost so streets lost to Haussmann show through over later maps.
 */
export function styleCadastre(map: MapLibreMap, year: number, enabled: boolean) {
  const mode = cadastreMode(year)
  const vis = enabled && mode !== 'hidden' ? 'visible' : 'none'
  for (const id of ['cadastre-ilots', 'cadastre-parcelles', 'cadastre-voirie']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis)
  }
  if (vis === 'none') return
  if (mode === 'primary') {
    map.setPaintProperty('cadastre-ilots', 'fill-opacity', 0.35)
    map.setPaintProperty('cadastre-voirie', 'line-color', '#5b3d12')
    map.setPaintProperty('cadastre-voirie', 'line-opacity', 1)
    map.setPaintProperty('cadastre-parcelles', 'line-opacity', 0.7)
  } else {
    map.setPaintProperty('cadastre-ilots', 'fill-opacity', 0)
    map.setPaintProperty('cadastre-voirie', 'line-color', '#f59e0b')
    map.setPaintProperty('cadastre-voirie', 'line-opacity', 0.9)
    map.setPaintProperty('cadastre-parcelles', 'line-opacity', 0)
  }
}

export function addPanoramaxCoverage(map: MapLibreMap) {
  map.addSource('panoramax', {
    type: 'vector',
    tiles: [PANORAMAX_TILES],
    minzoom: 0,
    maxzoom: 15,
    attribution: 'Street-level imagery: Panoramax contributors'
  })
  map.addLayer({
    id: 'panoramax-sequences',
    type: 'line',
    source: 'panoramax',
    'source-layer': 'sequences',
    minzoom: 13,
    layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#0f766e', 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 18, 4], 'line-opacity': 0.75 }
  })
}

export function addPhotos(map: MapLibreMap, data: PhotoCollection) {
  map.addSource('photos', { type: 'geojson', data: data as unknown as GeoJSON.FeatureCollection, promoteId: 'id' })
  map.addSource('selection', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  map.addLayer({
    id: 'selection-cone',
    type: 'fill',
    source: 'selection',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#facc15', 'fill-opacity': 0.35, 'fill-outline-color': '#a16207' }
  })
  map.addLayer({
    id: 'photos',
    type: 'circle',
    source: 'photos',
    paint: {
      'circle-color': colorExpression() as never,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 5, 18, 8],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 1.5],
      'circle-opacity': ['case', ['boolean', ['feature-state', 'dim'], false], 0.35, 1]
    }
  })
  map.addLayer({
    id: 'selection-point',
    type: 'circle',
    source: 'selection',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 11,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#facc15',
      'circle-stroke-width': 3
    }
  })
}

export function filterPhotos(map: MapLibreMap, year: number, showAll: boolean) {
  if (map.getLayer('photos')) map.setFilter('photos', yearFilter(year, undefined, showAll))
}

/** A view cone for photos whose heading is known; a ring for the others. */
export function selectionGeometry(
  lonlat: [number, number],
  heading?: number,
  fov = 50,
  length = 60
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: lonlat } }]
  if (heading !== undefined) {
    const [lon, lat] = lonlat
    const mPerDegLat = 111320
    const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180)
    const ring: [number, number][] = [lonlat]
    for (let a = heading - fov / 2; a <= heading + fov / 2 + 0.01; a += fov / 12) {
      const r = (a * Math.PI) / 180
      ring.push([lon + (Math.sin(r) * length) / mPerDegLon, lat + (Math.cos(r) * length) / mPerDegLat])
    }
    ring.push(lonlat)
    features.unshift({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } })
  }
  return { type: 'FeatureCollection', features }
}

export function setSelection(map: MapLibreMap, data: GeoJSON.FeatureCollection) {
  ;(map.getSource('selection') as GeoJSONSource | undefined)?.setData(data)
}

/**
 * Archive photographs as picture frames standing in the 3D streets.
 *
 * A MapLibre custom layer drawn with three.js in the map's own WebGL context.
 * It shares the depth buffer, so buildings hide frames behind them. Frames
 * turn to face the viewer, keep a readable size when zoomed out and shrink
 * to about street-sign scale up close. Photos that share a spot (captions
 * geocoded to the same street, plates exposed from the same place) become
 * one frame with a count.
 *
 * WebGL needs CORS-enabled images: Albert-Kahn images load from the museum's
 * portal; Paris Musées images come from same-origin thumbnails
 * (python -m rpr thumbs).
 */

import * as THREE from 'three'
import { MercatorCoordinate, type CustomLayerInterface, type CustomRenderMethodInput, type Map as MapLibreMap } from 'maplibre-gl'
import { inWindow, type PhotoFeature } from './photos'

export interface FrameGroup {
  key: string
  lon: number
  lat: number
  photo: PhotoFeature
  count: number
}

/** Ground resolution in metres per CSS pixel (512 px tiles). */
export function metersPerPixel(zoom: number, lat: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom)
}

/** Frame height in metres: about 48 px on screen, between 5 m (street level) and 30 m (overview). */
export function frameHeight(zoom: number, lat: number): number {
  return Math.min(30, Math.max(5, metersPerPixel(zoom, lat) * 48))
}

/**
 * One group per spot (cells of about 4 m) inside `bounds`, for photos in the
 * year window. Each group shows the photo closest in date to `year`.
 */
export function groupPhotos(
  photos: PhotoFeature[],
  year: number,
  showAll: boolean,
  bounds: [number, number, number, number],
  cell = 0.00005
): FrameGroup[] {
  const [x0, y0, x1, y1] = bounds
  const groups = new Map<string, FrameGroup & { gap: number }>()
  for (const f of photos) {
    const [lon, lat] = f.geometry.coordinates
    if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue
    if (!showAll && !inWindow(f.properties, year)) continue
    const key = `${Math.round(lon / cell)}:${Math.round(lat / cell)}`
    const gap = f.properties.year === undefined ? 999 : Math.abs(f.properties.year - year)
    const g = groups.get(key)
    if (!g) {
      groups.set(key, { key, lon, lat, photo: f, count: 1, gap })
    } else {
      g.count++
      if (gap < g.gap) Object.assign(g, { photo: f, gap })
    }
  }
  return [...groups.values()].map(({ gap: _gap, ...g }) => g)
}

/** The `max` groups nearest to `center`. */
export function nearestGroups(groups: FrameGroup[], center: [number, number], max: number): FrameGroup[] {
  const k = Math.cos((center[1] * Math.PI) / 180)
  const d = (g: FrameGroup) => ((g.lon - center[0]) * k) ** 2 + (g.lat - center[1]) ** 2
  return [...groups].sort((a, b) => d(a) - d(b)).slice(0, max)
}

/* ------------------------------------------------------------------ layer */

interface Frame {
  group: FrameGroup
  node: THREE.Group
  picture: THREE.Mesh
  border: THREE.Mesh
  aspect: number
}

const PLANE = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2) // vertical, facing south (-y)

function labelTexture(lines: string[], w = 256, h = 192): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.fillStyle = '#e9dcc0'
  g.fillRect(0, 0, w, h)
  g.fillStyle = '#5b4526'
  g.textAlign = 'center'
  g.font = '600 34px "Barlow Condensed", sans-serif'
  g.fillText(lines[0] ?? '', w / 2, h / 2 - 6)
  g.font = '20px "IBM Plex Sans", sans-serif'
  g.fillText(lines[1] ?? '', w / 2, h / 2 + 26)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function badgeTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = '#1c3a6d'
  g.beginPath()
  g.roundRect(2, 2, 124, 60, 28)
  g.fill()
  g.fillStyle = '#ffffff'
  g.font = '600 34px "IBM Plex Sans", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(n > 99 ? '99+' : `×${n}`, 64, 34)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class PhotoFrames implements CustomLayerInterface {
  readonly id = 'photo-frames'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  private map!: MapLibreMap
  private renderer!: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.Camera()
  private origin: MercatorCoordinate
  private meter: number
  private frames = new Map<string, Frame>()
  private textures = new Map<string, THREE.Texture>()
  private loader = new THREE.TextureLoader().setCrossOrigin('anonymous')
  private matrix = new THREE.Matrix4()
  private visible = true

  constructor(
    private center: [number, number],
    private imageFor: (f: PhotoFeature) => string | undefined
  ) {
    this.origin = MercatorCoordinate.fromLngLat(center, 0)
    this.meter = this.origin.meterInMercatorCoordinateUnits()
  }

  onAdd(map: MapLibreMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
    this.map = map
    this.renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl as WebGL2RenderingContext, antialias: true })
    this.renderer.autoClear = false
  }

  onRemove() {
    for (const f of this.frames.values()) this.dispose(f)
    this.frames.clear()
    for (const t of this.textures.values()) t.dispose()
    this.textures.clear()
  }

  setVisible(v: boolean) {
    this.visible = v
    this.map?.triggerRepaint()
  }

  /** Show exactly these groups, reusing frames that stay. */
  setGroups(groups: FrameGroup[]) {
    const keep = new Set(groups.map((g) => g.key + g.photo.id))
    for (const [k, f] of this.frames) {
      if (!keep.has(k)) {
        this.dispose(f)
        this.frames.delete(k)
      }
    }
    for (const g of groups) {
      const k = g.key + g.photo.id
      if (!this.frames.has(k)) this.frames.set(k, this.build(g))
    }
    this.map?.triggerRepaint()
  }

  private local(lon: number, lat: number): [number, number] {
    const k = Math.cos((this.center[1] * Math.PI) / 180)
    return [(lon - this.center[0]) * 111320 * k, (lat - this.center[1]) * 110574]
  }

  private build(g: FrameGroup): Frame {
    const p = g.photo.properties
    const node = new THREE.Group()
    const [x, y] = this.local(g.lon, g.lat)
    node.position.set(x, y, 0)

    const border = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ color: 0x2a2118, side: THREE.DoubleSide }))
    border.position.y = 0.02
    const placeholder = labelTexture([p.year ? String(p.year) : 'Undated', (p.creator ?? '').split(',')[0]])
    const picture = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: placeholder, side: THREE.DoubleSide }))
    node.add(border, picture)
    if (g.count > 1) {
      const badge = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: badgeTexture(g.count), transparent: true, side: THREE.DoubleSide }))
      badge.name = 'badge'
      node.add(badge)
    }
    this.scene.add(node)
    const frame: Frame = { group: g, node, picture, border, aspect: 4 / 3 }

    const url = this.imageFor(g.photo)
    if (url) this.texture(url, frame, placeholder)
    return frame
  }

  private texture(url: string, frame: Frame, placeholder: THREE.Texture) {
    const apply = (t: THREE.Texture) => {
      const img = t.image as HTMLImageElement
      frame.aspect = img.width && img.height ? img.width / img.height : frame.aspect
      ;(frame.picture.material as THREE.MeshBasicMaterial).map = t
      ;(frame.picture.material as THREE.MeshBasicMaterial).needsUpdate = true
      placeholder.dispose()
      this.map?.triggerRepaint()
    }
    const cached = this.textures.get(url)
    if (cached) return apply(cached)
    this.loader.load(
      url,
      (t) => {
        t.colorSpace = THREE.SRGBColorSpace
        t.anisotropy = 4
        this.textures.set(url, t)
        if (this.frames.has(frame.group.key + frame.group.photo.id)) apply(t)
      },
      undefined,
      () => {
        /* keep the placeholder label */
      }
    )
  }

  private dispose(f: Frame) {
    this.scene.remove(f.node)
    for (const child of f.node.children) {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial
      if (mat.map && ![...this.textures.values()].includes(mat.map)) mat.map.dispose()
      mat.dispose()
    }
  }

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
    if (!this.visible || this.frames.size === 0) return
    const m = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix as unknown as number[])
    const l = new THREE.Matrix4()
      .makeTranslation(this.origin.x, this.origin.y, this.origin.z)
      .scale(new THREE.Vector3(this.meter, -this.meter, this.meter))
    this.camera.projectionMatrix = m.multiply(l)
    this.matrix.copy(this.camera.projectionMatrix)

    const h = frameHeight(this.map.getZoom(), this.center[1])
    const turn = (-this.map.getBearing() * Math.PI) / 180
    for (const f of this.frames.values()) {
      f.node.rotation.z = turn
      f.node.scale.setScalar(h)
      f.node.position.z = h / 2 + 0.4
      f.picture.scale.set(f.aspect, 1, 1)
      f.border.scale.set(f.aspect + 0.06, 1, 1.06)
      const badge = f.node.getObjectByName('badge')
      if (badge) {
        badge.scale.set(0.42, 1, 0.21)
        badge.position.set(f.aspect / 2 - 0.12, -0.03, 0.5)
      }
    }
    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
  }

  /** The photo whose frame is under a screen point (nearest first), if any. */
  pick(point: { x: number; y: number }): PhotoFeature | undefined {
    const canvas = this.map.getCanvas()
    const w = canvas.clientWidth
    const hgt = canvas.clientHeight
    let best: { w: number; photo: PhotoFeature } | undefined
    const v = new THREE.Vector4()
    for (const f of this.frames.values()) {
      f.node.updateMatrixWorld()
      const corners = [
        [-f.aspect / 2, 0, -0.5],
        [f.aspect / 2, 0, -0.5],
        [f.aspect / 2, 0, 0.5],
        [-f.aspect / 2, 0, 0.5]
      ].map(([x, y, z]) => {
        const p = new THREE.Vector3(x, y, z).applyMatrix4(f.node.matrixWorld)
        v.set(p.x, p.y, p.z, 1).applyMatrix4(this.matrix)
        return { x: ((v.x / v.w + 1) / 2) * w, y: ((1 - v.y / v.w) / 2) * hgt, w: v.w }
      })
      if (corners.some((c) => c.w <= 0)) continue
      if (insideQuad(point, corners)) {
        const depth = corners[0].w
        if (!best || depth < best.w) best = { w: depth, photo: f.group.photo }
      }
    }
    return best?.photo
  }
}

function insideQuad(p: { x: number; y: number }, q: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const a = q[i]
    const b = q[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

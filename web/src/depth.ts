/**
 * "3D photos": archive photographs turned into reliefs with an AI depth map
 * (Depth Anything V2 Small, run by `python -m rpr depth`).
 *
 * The depth is relative and estimated from a single image, so the result is
 * a parallax effect, not a measured model. The mesh is torn where depth jumps
 * sharply, so foreground and background do not join into a rubber sheet.
 */

import * as THREE from 'three'
import type { PhotoFeature } from './photos'

export interface DepthEntry {
  depth: string
  width: number
  height: number
  /** Same-origin copy, for archives that send no CORS headers. */
  image?: string
}

export type DepthIndex = Record<string, DepthEntry>

export interface DepthGrid {
  w: number
  h: number
  /** Row-major, 0 = far, 1 = near. */
  values: Float32Array
}

export async function loadDepthIndex(base: string): Promise<DepthIndex> {
  try {
    const res = await fetch(`${base}data/3d/depth/index.json`)
    return res.ok ? ((await res.json()) as DepthIndex) : {}
  } catch {
    return {}
  }
}

export function depthImageUrl(base: string, f: PhotoFeature, entry: DepthEntry): string | undefined {
  if (entry.image) return `${base}data/3d/depth/${entry.image}`
  return f.properties.image ?? f.properties.thumb
}

/** Read an 8-bit depth PNG into a grid. */
export async function loadDepthGrid(url: string): Promise<DepthGrid> {
  const img = new Image()
  img.src = url
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.drawImage(img, 0, 0)
  const data = g.getImageData(0, 0, c.width, c.height).data
  const values = new Float32Array(c.width * c.height)
  for (let i = 0; i < values.length; i++) values[i] = data[i * 4] / 255
  return { w: c.width, h: c.height, values }
}

/** Bilinear sample of the grid at u, v in 0..1 (v = 0 at the top of the image). */
export function sample(grid: DepthGrid, u: number, v: number): number {
  const x = Math.min(grid.w - 1, Math.max(0, u * (grid.w - 1)))
  const y = Math.min(grid.h - 1, Math.max(0, v * (grid.h - 1)))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(grid.w - 1, x0 + 1)
  const y1 = Math.min(grid.h - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const at = (xx: number, yy: number) => grid.values[yy * grid.w + xx]
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy
}

export interface ReliefOptions {
  /** Width in scene units; height is 1. */
  aspect: number
  /** How far the farthest point sits behind the nearest, in scene units. */
  strength: number
  segments?: number
  /** Depth jump (0..1) across one cell above which the mesh is torn. */
  tear?: number
  /** The relief's facing axis: 'z' for a free-standing viewer, '-y' for map frames. */
  facing?: 'z' | '-y'
}

/**
 * A grid mesh spanning [-aspect/2, aspect/2] x [-1/2, 1/2], pushed back by
 * (1 - depth) * strength. Triangles crossing a sharp depth edge are dropped.
 */
export function reliefGeometry(grid: DepthGrid, o: ReliefOptions): THREE.BufferGeometry {
  const segX = o.segments ?? 128
  const segY = Math.max(8, Math.round(segX / o.aspect))
  const tear = o.tear ?? 0.12
  const positions = new Float32Array((segX + 1) * (segY + 1) * 3)
  const uvs = new Float32Array((segX + 1) * (segY + 1) * 2)
  const depth = new Float32Array((segX + 1) * (segY + 1))
  let i = 0
  for (let y = 0; y <= segY; y++) {
    for (let x = 0; x <= segX; x++) {
      const u = x / segX
      const v = y / segY
      const d = sample(grid, u, v)
      depth[i] = d
      const px = (u - 0.5) * o.aspect
      const py = 0.5 - v
      const back = (1 - d) * o.strength
      if (o.facing === '-y') {
        // Map frames: the picture faces -y, z is up, farther is +y.
        positions.set([px, back, py], i * 3)
      } else {
        positions.set([px, py, -back], i * 3)
      }
      uvs.set([u, 1 - v], i * 2)
      i++
    }
  }
  const index: number[] = []
  const id = (x: number, y: number) => y * (segX + 1) + x
  for (let y = 0; y < segY; y++) {
    for (let x = 0; x < segX; x++) {
      const a = id(x, y)
      const b = id(x + 1, y)
      const c = id(x, y + 1)
      const d = id(x + 1, y + 1)
      const quad = [depth[a], depth[b], depth[c], depth[d]]
      if (Math.max(...quad) - Math.min(...quad) > tear) continue
      index.push(a, c, b, b, c, d)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geo.setIndex(index)
  return geo
}

/* ------------------------------------------------------------- viewer */

export interface DepthViewer {
  close(): void
}

/**
 * A small full-screen viewer: the photo as a relief that follows the
 * pointer (or device tilt), so the scene shifts like a window.
 */
export async function openDepthViewer(
  root: HTMLElement,
  opts: { title: string; caption: string; imageUrl: string; depthUrl: string; onClose: () => void }
): Promise<DepthViewer> {
  const canvas = document.createElement('canvas')
  canvas.className = 'dv-canvas'
  const close = document.createElement('button')
  close.className = 'tn-close'
  close.type = 'button'
  close.setAttribute('aria-label', 'Close the 3D photo')
  close.textContent = '×'
  const strengthInput = document.createElement('input')
  Object.assign(strengthInput, { type: 'range', min: '0', max: '100', value: '45', id: 'dv-strength' })
  strengthInput.setAttribute('aria-label', 'Depth')
  const head = document.createElement('header')
  head.className = 'tn-head'
  const title = document.createElement('div')
  title.className = 'tn-title'
  title.innerHTML = '<span class="tn-eyebrow"></span><h2></h2>'
  title.querySelector('span')!.textContent = '3D photo · AI depth estimate'
  title.querySelector('h2')!.textContent = opts.title
  head.append(title, close)
  const stage = document.createElement('div')
  stage.className = 'dv-stage'
  stage.append(canvas)
  const status = document.createElement('p')
  status.className = 'tn-status'
  status.textContent = 'Move the pointer over the photo, or drag. The depth is estimated by AI from this single photograph.'
  stage.append(status)
  const foot = document.createElement('footer')
  foot.className = 'tn-controls dv-controls'
  const label = document.createElement('label')
  label.className = 'tn-slider'
  label.htmlFor = 'dv-strength'
  label.append(Object.assign(document.createElement('span'), { textContent: 'Flat' }), strengthInput, Object.assign(document.createElement('span'), { textContent: 'Deep' }))
  const credit = document.createElement('p')
  credit.className = 'tn-now-info'
  credit.textContent = opts.caption
  foot.append(label, credit)
  const panel = document.createElement('div')
  panel.className = 'tn'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', '3D photo')
  panel.append(head, stage, foot)
  root.replaceChildren(panel)
  root.hidden = false
  close.focus({ preventScroll: true })

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50)
  const [grid, texture] = await Promise.all([
    loadDepthGrid(opts.depthUrl),
    new THREE.TextureLoader().setCrossOrigin('anonymous').loadAsync(opts.imageUrl)
  ])
  texture.colorSpace = THREE.SRGBColorSpace
  const img = texture.image as HTMLImageElement
  const aspect = img.width / img.height
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide })
  let mesh = new THREE.Mesh(reliefGeometry(grid, { aspect, strength: 0.45, segments: 192 }), material)
  scene.add(mesh)

  let target = { x: 0, y: 0 }
  const current = { x: 0, y: 0 }
  let raf = 0
  let drag: { x: number; y: number; tx: number; ty: number } | undefined

  const resize = () => {
    const w = stage.clientWidth
    const h = stage.clientHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // Fit the photo with a margin.
    const fitH = 1.15
    const fitW = (aspect * 1.15) / camera.aspect
    const fov = (camera.fov * Math.PI) / 180
    camera.userData.distance = Math.max(fitH, fitW) / (2 * Math.tan(fov / 2)) + 0.1
    camera.updateProjectionMatrix()
  }
  const frame = () => {
    current.x += (target.x - current.x) * 0.08
    current.y += (target.y - current.y) * 0.08
    const d = camera.userData.distance as number
    const yaw = current.x * 0.35
    const pitch = current.y * 0.22
    camera.position.set(Math.sin(yaw) * d, Math.sin(pitch) * d, Math.cos(yaw) * Math.cos(pitch) * d)
    camera.lookAt(0, 0, -0.15)
    renderer.render(scene, camera)
    raf = requestAnimationFrame(frame)
  }
  const onMove = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect()
    if (drag) {
      target = { x: drag.tx + ((e.clientX - drag.x) / r.width) * 2, y: drag.ty + ((e.clientY - drag.y) / r.height) * 2 }
    } else if (e.pointerType === 'mouse') {
      target = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: ((e.clientY - r.top) / r.height) * 2 - 1 }
    }
    target.x = Math.max(-1.5, Math.min(1.5, target.x))
    target.y = Math.max(-1.2, Math.min(1.2, target.y))
  }
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, tx: target.x, ty: target.y }
  }
  const onUp = () => (drag = undefined)
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') api.close()
  }
  stage.addEventListener('pointermove', onMove)
  stage.addEventListener('pointerdown', onDown)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('keydown', onKey)
  const ro = new ResizeObserver(resize)
  ro.observe(stage)
  strengthInput.addEventListener('input', () => {
    const old = mesh.geometry
    mesh.geometry = reliefGeometry(grid, { aspect, strength: Number(strengthInput.value) / 100, segments: 192 })
    old.dispose()
  })
  resize()
  frame()

  const api: DepthViewer = {
    close() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      stage.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      mesh.geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
      root.replaceChildren()
      root.hidden = true
      opts.onClose()
    }
  }
  close.addEventListener('click', () => api.close())
  return api
}

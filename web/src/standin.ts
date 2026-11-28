/**
 * The stand-in view: stand where the photographer stood.
 *
 * The walk's camera moves to the photo's camera (position, height, bearing,
 * pitch, roll and field of view) and the photograph is laid over the 3D view
 * in a frame of its own proportions. Where the camera is right, the streets
 * of the model run on past the edges of the picture. A slider fades between
 * the model and the photograph.
 *
 * The photograph is a plain <img> above the map, as in the then-and-now
 * viewer: Paris Musées sends no CORS headers, so it cannot be a WebGL texture.
 * Where the pipeline made a same-origin copy (a photo scene), the model is
 * also painted with the photograph from its camera (photoscene.ts), and you
 * can walk into the picture.
 * It only works for photos with a full camera (`cameraOf`); see
 * pipeline/rpr/cameras.py for how a camera is placed.
 */

import type { Map as MapLibreMap } from 'maplibre-gl'
import { type Camera, cameraLabel, dateLabel, type PhotoProps } from './photos'
import { EYE_HEIGHT, offset, type Walker, type WalkView } from './walk'
import { el } from './ui'

/** MapLibre's own vertical field of view, degrees. */
export const DEFAULT_VFOV = 36.87
/** How long the camera takes to reach the photographer's place, ms. */
export const MOVE_MS = 1600

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export interface Frame {
  x: number
  y: number
  w: number
  h: number
  /** The 3D view's vertical field of view that matches the photo across the frame. */
  vfov: number
}

export interface Margins {
  x: number
  top: number
  bottom: number
}

/**
 * The photo's frame in a view `w` × `h` pixels: as large as fits inside the
 * margins. The 3D view looks straight ahead through the centre of the canvas,
 * so the point of the picture straight ahead of the camera must sit there:
 * the picture's middle, or below it by the rising front (`shift`). The 3D
 * view's vertical field of view is then the one that makes the frame's width
 * span the photo's horizontal field of view.
 */
export function frameFor(w: number, h: number, aspect: number, hfov: number, m: Margins, shift = 0): Frame {
  const ahead = Math.min(0.95, Math.max(0.05, 0.5 + shift)) // from the top, as a share of the height
  const room = Math.min((h / 2 - m.top) / ahead, (h / 2 - m.bottom) / (1 - ahead))
  const fw = Math.min(Math.max(1, w - 2 * m.x), Math.max(1, room) * aspect)
  const fh = fw / aspect
  const focal = fw / 2 / Math.tan(rad(hfov) / 2)
  return { x: (w - fw) / 2, y: h / 2 - ahead * fh, w: fw, h: fh, vfov: deg(2 * Math.atan(h / 2 / focal)) }
}

/** The walk view a camera describes. */
export function viewOf(c: Camera): WalkView {
  return { pos: [c.lon, c.lat], heading: c.bearing, lookUp: c.pitch, height: c.height, roll: c.roll }
}

/** Smooth start and end. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

/** The view part way (t, 0 to 1) from a to b, turning the short way round. */
export function between(a: WalkView, b: WalkView, t: number): WalkView {
  const lerp = (x: number, y: number) => x + (y - x) * t
  const turn = ((((b.heading - a.heading) % 360) + 540) % 360) - 180
  return {
    pos: [lerp(a.pos[0], b.pos[0]), lerp(a.pos[1], b.pos[1])],
    heading: (a.heading + turn * t + 360) % 360,
    lookUp: lerp(a.lookUp, b.lookUp),
    height: lerp(a.height, b.height),
    roll: lerp(a.roll, b.roll)
  }
}

/** Metres between two points (equirectangular, fine across a street). */
export function metresBetween(a: [number, number], b: [number, number]): number {
  const k = Math.cos(rad((a[1] + b[1]) / 2))
  return Math.hypot((a[0] - b[0]) * 111320 * k, (a[1] - b[1]) * 110574)
}

/** One photo's entry in data/3d/scenes/index.json (pipeline/rpr/sources/scenes.py). */
export interface SceneEntry {
  image: string
  mask: string
  width: number
  height: number
  /** The camera's crop the picture was cut with: the scene is stale if the camera's crop differs. */
  crop: [number, number, number, number]
  sky: number
  leaves: number
  covered: number
}

export type SceneIndex = Record<string, SceneEntry>

export async function loadSceneIndex(base: string): Promise<SceneIndex> {
  try {
    const res = await fetch(`${base}data/3d/scenes/index.json`)
    return res.ok ? ((await res.json()) as SceneIndex) : {}
  } catch {
    return {}
  }
}

/** The scene made for this camera, if its picture was cut with the camera's crop. */
export function sceneFor(index: SceneIndex, id: string, camera: Camera): SceneEntry | undefined {
  const e = index[id]
  if (!e) return undefined
  return e.crop.every((v, i) => Math.abs(v - camera.crop[i]) < 1e-4) ? e : undefined
}

/** The posed photo nearest a point, within `metres`, or undefined. */
export function nearestPosed<T extends { camera: Camera }>(posed: T[], at: [number, number], metres: number): T | undefined {
  let best: T | undefined
  let bestD = metres
  for (const p of posed) {
    const d = metresBetween(at, [p.camera.lon, p.camera.lat])
    if (d <= bestD) [best, bestD] = [p, d]
  }
  return best
}

/** The aspect (width / height) of the picture inside an image of w × h pixels. */
export function pictureAspect(w: number, h: number, crop: Camera['crop']): number {
  return (w * (crop[2] - crop[0])) / (h * (crop[3] - crop[1]))
}

/** The pose as an entry for pipeline/poses/manual.json. */
export function poseEntry(id: string, c: Camera, date: string): string {
  const r = (v: number, n: number) => Number(v.toFixed(n))
  return JSON.stringify(
    {
      id,
      camera: { lon: r(c.lon, 7), lat: r(c.lat, 7), height: r(c.height, 2), bearing: r(c.bearing, 2), pitch: r(c.pitch, 2), roll: r(c.roll, 2), hfov: r(c.hfov, 2), shift: r(c.shift, 3) },
      crop: c.crop.map((v) => r(v, 4)),
      confidence: 0.5,
      by: '',
      date,
      how: ''
    },
    null,
    2
  )
}

/** Said in the card when the model is painted with the photograph. */
export const PAINTED_NOTE =
  'The model is painted with this photograph, thrown from where it was taken. Sky, leaves and labels are left out, and walls the camera did not see keep the model’s colours. Where the model’s walls differ from the real ones, the picture slips.'

export interface StandInOptions {
  map: MapLibreMap
  walker: Walker
  photo: PhotoProps
  camera: Camera
  /** The year the model is shown at. */
  year: number
  /** Show the controls that move the camera and copy the pose. */
  adjust?: boolean
  /** The model is painted with this photograph (photoscene.ts): say so, and offer to walk into it. */
  painted?: boolean
  /** The camera changed (adjust mode). */
  onCamera?: (c: Camera) => void
  /** `walkIn`: the walker leaves by walking into the picture, which stays painted on the model. */
  onClose: (how: { walkIn: boolean }) => void
}

export interface StandIn {
  /** Move back to the walk's eye and remove the photograph (`walkIn`: keep it painted on the model). */
  close(walkIn?: boolean): Promise<void>
  /** Remove everything at once (the walk is ending). */
  dispose(): void
  /** Change part of the camera (adjust mode and tests). */
  set(c: Partial<Camera>): void
  camera(): Camera
  /** Balance between the model (0) and the photograph (1). */
  fade(v: number): void
  /** Resolves once the camera stands in the photo. */
  ready: Promise<void>
}

export function openStandIn(root: HTMLElement, o: StandInOptions): StandIn {
  const { map, walker, photo } = o
  let cam: Camera = { ...o.camera }
  let aspect = 4 / 3
  let fade = 1
  let closing = false
  let disposed = false
  let walkIn = false
  const startView = walker.view
  const startFov = map.getVerticalFieldOfView()
  walker.held = true

  /* ------------------------------------------------------------ DOM */
  const img = el('img', { class: 'si-photo', alt: `Archive photograph: ${photo.title}`, draggable: 'false' })
  const frame = el('div', { class: 'si-frame' }, [img])
  const slider = el('input', { type: 'range', id: 'si-fade', min: '0', max: '100', value: '100', 'aria-label': 'Balance between the 3D model and the photograph' })
  const leave = el('button', { class: 'tb-btn si-leave', type: 'button', text: 'Leave the photograph' })
  const walkInto = o.painted ? el('button', { class: 'tb-btn si-walk', type: 'button', text: 'Walk into the picture' }) : null
  const status = el('p', { class: 'si-status', role: 'status' })
  const credit = [photo.credit, photo.license].filter(Boolean).join(' · ')
  const card = el('section', { class: 'si-card', 'aria-label': 'Standing in the photograph' }, [
    el('span', { class: 'si-eyebrow', text: [dateLabel(photo), photo.creator].filter(Boolean).join(' · ') }),
    el('strong', { class: 'si-title', text: photo.title }),
    el('label', { class: 'si-fade', for: 'si-fade' }, [el('span', { text: o.painted ? 'Painted model' : `Model of ${o.year}` }), slider, el('span', { text: 'Photograph' })]),
    el('p', { class: 'si-how', text: cameraLabel(cam, o.year) }),
    o.painted ? el('p', { class: 'si-how si-painted', text: PAINTED_NOTE }) : null,
    status,
    el('div', { class: 'si-foot' }, [
      el('p', { class: 'si-credit' }, [
        el('span', { text: credit }),
        photo.url ? el('a', { href: photo.url, target: '_blank', rel: 'noopener', text: 'Archive record' }) : null
      ]),
      el('div', { class: 'si-buttons' }, [walkInto, leave])
    ])
  ])
  const box = el('div', { class: 'si' }, [frame, card])
  root.replaceChildren(box)
  root.hidden = false

  /* --------------------------------------------------------- layout */
  const margins = () => {
    const w = root.clientWidth
    const h = root.clientHeight
    const phone = w < 720
    // The card sits below the picture, above the map's credits; on a small screen it may cover the picture's foot.
    const m: Margins = { x: phone ? 8 : 24, top: phone ? 8 : 16, bottom: Math.min(h - card.offsetTop + 10, h * 0.4) }
    return { w, h, m }
  }
  let current: Frame = frameFor(root.clientWidth, root.clientHeight, aspect, cam.hfov, margins().m, cam.shift)
  const layout = () => {
    const m = margins()
    current = frameFor(m.w, m.h, aspect, cam.hfov, m.m, cam.shift)
    Object.assign(frame.style, { left: `${current.x}px`, top: `${current.y}px`, width: `${current.w}px`, height: `${current.h}px` })
    // The image is larger than the frame by the card around the print; the frame cuts it off.
    const [x0, y0, x1, y1] = cam.crop
    const iw = current.w / (x1 - x0)
    const ih = current.h / (y1 - y0)
    Object.assign(img.style, { width: `${iw}px`, height: `${ih}px`, left: `${-x0 * iw}px`, top: `${-y0 * ih}px` })
  }
  const place = (v: WalkView, vfov: number) => {
    map.setVerticalFieldOfView(vfov)
    walker.lookFrom(v)
  }
  let moving = true
  const settle = () => {
    layout()
    if (!moving && !closing) place(viewOf(cam), current.vfov)
  }

  /* ------------------------------------------------- the move there */
  const animate = (from: WalkView, to: WalkView, fromFov: number, toFov: () => number, ms: number) =>
    new Promise<void>((done) => {
      const t0 = performance.now()
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const step = (now: number) => {
        const t = reduce ? 1 : Math.min(1, (now - t0) / ms)
        const e = ease(t)
        place(between(from, to, e), fromFov + (toFov() - fromFov) * e)
        if (t < 1) requestAnimationFrame(step)
        else done()
      }
      requestAnimationFrame(step)
    })

  const loaded = new Promise<void>((done) => {
    img.addEventListener('load', () => {
      aspect = pictureAspect(img.naturalWidth, img.naturalHeight, cam.crop)
      done()
    })
    img.addEventListener('error', () => {
      if (photo.thumb && img.src !== photo.thumb) {
        img.src = photo.thumb // the thumbnail has the same proportions
        return
      }
      status.textContent = 'The photograph could not be loaded from its archive. The camera still stands where it was taken.'
      done()
    })
    window.setTimeout(done, 5000) // a slow archive does not hold the walk up
  })
  img.src = photo.image ?? photo.thumb ?? ''

  const ready = (async () => {
    await loaded
    layout()
    await animate(startView, viewOf(cam), startFov, () => current.vfov, MOVE_MS)
    moving = false
    settle()
    box.classList.add('is-in')
  })()

  /* ------------------------------------------------------- controls */
  const setFade = (v: number) => {
    fade = Math.max(0, Math.min(1, v))
    img.style.opacity = String(fade)
    slider.value = String(Math.round(fade * 100))
  }
  slider.addEventListener('input', () => setFade(Number(slider.value) / 100))
  setFade(fade)

  const api: StandIn = {
    ready,
    camera: () => ({ ...cam }),
    set(c) {
      cam = { ...cam, ...c }
      if (c.crop && img.naturalWidth) aspect = pictureAspect(img.naturalWidth, img.naturalHeight, cam.crop)
      settle()
      readout?.()
      o.onCamera?.({ ...cam })
    },
    fade: setFade,
    async close(into = false) {
      if (closing) return
      closing = true
      walkIn = into
      await ready
      if (disposed) return
      box.classList.remove('is-in')
      const here = viewOf(cam)
      const back: WalkView = { ...here, height: EYE_HEIGHT, roll: 0, lookUp: Math.max(-10, Math.min(20, here.lookUp)) }
      await animate(here, back, current.vfov, () => DEFAULT_VFOV, 600)
      if (disposed) return
      api.dispose()
      walker.resume()
    },
    dispose() {
      if (disposed) return
      disposed = closing = true
      window.removeEventListener('keydown', onKey)
      ro.disconnect()
      map.setVerticalFieldOfView(DEFAULT_VFOV)
      root.replaceChildren()
      root.hidden = true
      o.onClose({ walkIn })
    }
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
    if (e.key === 'Escape') {
      e.preventDefault()
      void api.close()
    } else if (o.adjust) nudge(e)
  }
  window.addEventListener('keydown', onKey)
  leave.addEventListener('click', () => void api.close())
  walkInto?.addEventListener('click', () => void api.close(true))
  const ro = new ResizeObserver(settle)
  ro.observe(root)

  /* -------------------------------------- adjust: line up by eye */
  let readout: (() => void) | undefined
  const nudge = (e: KeyboardEvent) => {
    const fine = e.altKey ? 0.2 : 1
    const step = { turn: 0.25 * fine, move: 0.5 * fine, fov: 0.5 * fine, height: 0.1 * fine }
    const k = e.key
    let c: Partial<Camera> | undefined
    const move = (bearing: number) => {
      const [lon, lat] = offset([cam.lon, cam.lat], bearing, step.move)
      return { lon, lat }
    }
    if (e.shiftKey && k === 'ArrowUp') c = move(cam.bearing)
    else if (e.shiftKey && k === 'ArrowDown') c = move(cam.bearing + 180)
    else if (e.shiftKey && k === 'ArrowLeft') c = move(cam.bearing - 90)
    else if (e.shiftKey && k === 'ArrowRight') c = move(cam.bearing + 90)
    else if (k === 'ArrowLeft') c = { bearing: (cam.bearing - step.turn + 360) % 360 }
    else if (k === 'ArrowRight') c = { bearing: (cam.bearing + step.turn) % 360 }
    else if (k === 'ArrowUp') c = { pitch: cam.pitch + step.turn }
    else if (k === 'ArrowDown') c = { pitch: cam.pitch - step.turn }
    else if (k === '[') c = { hfov: Math.max(10, cam.hfov - step.fov) }
    else if (k === ']') c = { hfov: Math.min(120, cam.hfov + step.fov) }
    else if (k === ',') c = { roll: cam.roll - step.turn }
    else if (k === '.') c = { roll: cam.roll + step.turn }
    else if (k === '=' || k === '+') c = { shift: Math.min(0.5, cam.shift + 0.01 * fine) }
    else if (k === '-') c = { shift: Math.max(-0.5, cam.shift - 0.01 * fine) }
    else if (k === 'PageUp') c = { height: cam.height + step.height }
    else if (k === 'PageDown') c = { height: Math.max(0.3, cam.height - step.height) }
    if (!c) return
    e.preventDefault()
    api.set(c)
  }
  if (o.adjust) {
    const out = el('pre', { class: 'si-pose' })
    const copy = el('button', { class: 'tb-btn', type: 'button', text: 'Copy pose' })
    const help = el('p', { class: 'si-keys', text: 'Arrows turn · Shift+arrows move · [ ] field of view · - = rising front · , . roll · Page Up/Down height · Alt finer' })
    box.append(el('section', { class: 'si-tools', 'aria-label': 'Line up the camera' }, [help, out, copy]))
    readout = () => (out.textContent = poseEntry(photo.id, cam, new Date().toISOString().slice(0, 10)))
    readout()
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(out.textContent ?? '')
        copy.textContent = 'Copied'
      } catch {
        copy.textContent = 'Select the text above'
      }
      window.setTimeout(() => (copy.textContent = 'Copy pose'), 2000)
    })
  }

  return api
}

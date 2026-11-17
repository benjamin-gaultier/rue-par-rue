/**
 * The then-and-now viewer: an archive photograph laid over today's
 * street-level imagery of the same place.
 *
 * 360° panoramas: the archive photo is pinned to the centre of the screen
 * and people turn the panorama underneath it (Photo Sphere Viewer).
 * Flat photos: people drag the archive photo over today's picture.
 *
 * The archive image is a plain <img> above the panorama, never a WebGL
 * texture, so it works whether or not the archive sends CORS headers.
 *
 * This module is loaded on demand; it pulls in three.js.
 */

import { Viewer } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'
import {
  type Alignment,
  bearingForYaw,
  DEFAULT_PHOTO_FOV,
  initialAlignment,
  lookTarget,
  MAX_PHOTO_FOV,
  MIN_PHOTO_FOV,
  overlayWidth,
  viewFovFor,
  yawForBearing
} from './alignment'
import type { TodayPicture } from './panoramax'
import { dateLabel, type PhotoProps } from './photos'
import { el } from './ui'

export interface ThenNowOptions {
  photo: PhotoProps
  lonlat: [number, number]
  pictures: TodayPicture[]
  picture: TodayPicture
  alignment?: Alignment
  onAlign: (a: Alignment) => void
  onClose: () => void
}

export interface ThenNow {
  close(): void
}

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function openThenNow(root: HTMLElement, opts: ThenNowOptions): ThenNow {
  const target = lookTarget(opts.lonlat, opts.photo.heading)
  const thenSrc = opts.photo.iiif ? `${opts.photo.iiif}/full/!1200,1200/0/default.jpg` : (opts.photo.image ?? opts.photo.thumb ?? '')

  let pic = opts.picture
  let align: Alignment = opts.alignment?.pic === pic.id ? opts.alignment : initialAlignment(pic, target)
  let opacity = 0.65
  let viewer: Viewer | undefined
  let flat: { img: HTMLImageElement; drag?: { x: number; y: number; ax: number; ay: number } } | undefined

  /* ------------------------------------------------------------ DOM */
  const stage = el('div', { class: 'tn-stage' })
  const then = el('img', { class: 'tn-then', alt: `Archive photograph: ${opts.photo.title}`, src: thenSrc, draggable: 'false' })
  const status = el('p', { class: 'tn-status', role: 'status' })
  const close = el('button', { class: 'tn-close', type: 'button', 'aria-label': 'Close the then-and-now view', text: '×' })

  const opacityInput = el('input', { type: 'range', id: 'tn-opacity', min: '0', max: '100', value: String(opacity * 100), 'aria-label': 'Balance between today and the archive photograph' })
  const sizeInput = el('input', { type: 'range', id: 'tn-size', min: String(MIN_PHOTO_FOV), max: String(MAX_PHOTO_FOV), value: String(align.fov), 'aria-label': 'Size of the archive photograph' })
  const hold = el('button', { class: 'tn-btn', type: 'button', text: 'Hold to see then' })
  const reset = el('button', { class: 'tn-btn', type: 'button', text: 'Reset alignment' })
  const copy = el('button', { class: 'tn-btn', type: 'button', text: 'Copy link' })
  const nowInfo = el('p', { class: 'tn-now-info' })
  const strip = el('div', { class: 'tn-strip', role: 'list', 'aria-label': "Other photos of this place today" })

  const panel = el('div', { class: 'tn', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Then and now' }, [
    el('header', { class: 'tn-head' }, [
      el('div', { class: 'tn-title' }, [
        el('span', { class: 'tn-eyebrow', text: `Then · ${dateLabel(opts.photo)}${opts.photo.creator ? ' · ' + opts.photo.creator : ''}` }),
        el('h2', { text: opts.photo.title })
      ]),
      close
    ]),
    el('div', { class: 'tn-stage-wrap' }, [stage, then, status]),
    el('footer', { class: 'tn-controls' }, [
      el('label', { class: 'tn-slider', for: 'tn-opacity' }, [el('span', { text: 'Now' }), opacityInput, el('span', { text: 'Then' })]),
      el('label', { class: 'tn-slider', for: 'tn-size' }, [el('span', { text: 'Smaller' }), sizeInput, el('span', { text: 'Larger' })]),
      el('div', { class: 'tn-buttons' }, [hold, reset, copy]),
      nowInfo,
      strip
    ])
  ])
  root.replaceChildren(panel)
  root.hidden = false
  close.focus({ preventScroll: true })

  /* ------------------------------------------------------- helpers */
  const setOpacity = (o: number) => {
    then.style.opacity = String(o)
  }
  setOpacity(opacity)

  let alignTimer = 0
  const saveAlign = () => {
    window.clearTimeout(alignTimer)
    alignTimer = window.setTimeout(() => opts.onAlign({ ...align }), 300)
  }

  const describeNow = () => {
    const bits = [
      `Today · ${pic.date || 'undated'}`,
      pic.is360 ? '360° panorama' : 'street photo',
      `${Math.round(pic.distance)} m from the archive position`,
      pic.producer ? `by ${pic.producer}` : null,
      pic.license
    ].filter(Boolean)
    nowInfo.replaceChildren(
      el('span', { text: bits.join(' · ') + ' · ' }),
      el('a', { href: pic.viewerUrl, target: '_blank', rel: 'noopener', text: 'Open in Panoramax' })
    )
    status.textContent = pic.is360
      ? 'Drag the panorama until it lines up with the archive photo. Scroll or pinch to zoom.'
      : 'Drag the archive photo over today’s picture. Use the size slider to match.'
  }

  /* ----------------------------------------------------- 360° mode */
  const layout360 = () => {
    if (!viewer) return
    const w = overlayWidth(stage.clientWidth, viewer.state.hFov, align.fov)
    then.style.width = `${w}px`
    then.style.left = '50%'
    then.style.top = '50%'
    then.style.transform = 'translate(-50%, -50%)'
  }

  /**
   * Zoom so the whole archive photo is visible: at most three quarters of
   * the width and nine tenths of the height. Runs until the first interaction.
   */
  let interacted = false
  const fit360 = () => {
    if (!viewer || interacted || !viewer.state.ready) return
    const W = stage.clientWidth
    const H = stage.clientHeight
    const aspect = then.naturalWidth && then.naturalHeight ? then.naturalWidth / then.naturalHeight : 4 / 3
    const fraction = Math.min(0.75, (0.9 * H * aspect) / W)
    const hFov = Math.min(100, viewFovFor(align.fov, fraction))
    const vFov = viewer.dataHelper.hFovToVFov(hFov)
    viewer.zoom(Math.max(0, Math.min(100, ((100 - vFov) / (100 - 15)) * 100)))
    layout360()
  }

  const open360 = () => {
    const azimuth = pic.azimuth ?? 0
    interacted = false
    viewer = new Viewer({
      container: stage,
      panorama: pic.hd,
      navbar: false,
      defaultYaw: yawForBearing(align.x, azimuth),
      defaultPitch: rad(align.y),
      minFov: 15,
      maxFov: 100,
      mousewheel: true,
      keyboard: 'always',
      loadingTxt: 'Loading today’s panorama…'
    })
    const v = viewer
    v.addEventListener('ready', fit360, { once: true })
    v.addEventListener('position-updated', ({ position }) => {
      align = { ...align, x: bearingForYaw(position.yaw, azimuth), y: deg(position.pitch) }
      saveAlign()
    })
    v.addEventListener('zoom-updated', layout360)
    v.addEventListener('size-updated', layout360)
    v.addEventListener('panorama-error', () => {
      status.textContent = 'This panorama could not be loaded. Try another one below.'
    })
    then.classList.remove('is-draggable')
  }

  /* ------------------------------------------------------ flat mode */
  const flatRect = () => {
    if (!flat) return undefined
    const img = flat.img
    const sw = stage.clientWidth
    const sh = stage.clientHeight
    if (!img.naturalWidth) return undefined
    const scale = Math.min(sw / img.naturalWidth, sh / img.naturalHeight)
    const w = img.naturalWidth * scale
    const h = img.naturalHeight * scale
    return { x: (sw - w) / 2, y: (sh - h) / 2, w, h }
  }

  const layoutFlat = () => {
    const r = flatRect()
    if (!r) return
    const picFov = pic.fov && pic.fov < 180 ? pic.fov : 70
    const w = r.w * (Math.tan(rad(align.fov) / 2) / Math.tan(rad(picFov) / 2))
    then.style.width = `${w}px`
    then.style.left = `${r.x + r.w / 2 + (align.x / 100) * r.w}px`
    then.style.top = `${r.y + r.h / 2 + (align.y / 100) * r.h}px`
    then.style.transform = 'translate(-50%, -50%)'
  }

  const openFlat = () => {
    const img = el('img', { class: 'tn-now', src: pic.sd, alt: `Street photo taken ${pic.date}` })
    img.addEventListener('load', layoutFlat)
    img.addEventListener('error', () => (status.textContent = 'This photo could not be loaded. Try another one below.'))
    stage.append(img)
    flat = { img }
    then.classList.add('is-draggable')
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!flat) return
    then.setPointerCapture(e.pointerId)
    flat.drag = { x: e.clientX, y: e.clientY, ax: align.x, ay: align.y }
  }
  const onPointerMove = (e: PointerEvent) => {
    const r = flatRect()
    if (!flat?.drag || !r) return
    align = {
      ...align,
      x: flat.drag.ax + ((e.clientX - flat.drag.x) / r.w) * 100,
      y: flat.drag.ay + ((e.clientY - flat.drag.y) / r.h) * 100
    }
    layoutFlat()
    saveAlign()
  }
  const onPointerUp = () => {
    if (flat) flat.drag = undefined
  }
  then.addEventListener('pointerdown', onPointerDown)
  then.addEventListener('pointermove', onPointerMove)
  then.addEventListener('pointerup', onPointerUp)
  then.addEventListener('pointercancel', onPointerUp)

  /* ---------------------------------------------------------- shared */
  const layout = () => (pic.is360 ? layout360() : layoutFlat())
  then.addEventListener('load', () => (pic.is360 ? fit360() : layoutFlat()))
  // Fall back to the smaller image, then say what went wrong.
  then.addEventListener('error', () => {
    const fallback = opts.photo.thumb
    if (fallback && then.src !== fallback) {
      then.src = fallback
      return
    }
    then.hidden = true
    status.textContent = 'The archive photograph could not be loaded from its source. Try again later.'
  })
  const markInteracted = () => (interacted = true)
  stage.addEventListener('pointerdown', markInteracted)
  stage.addEventListener('wheel', markInteracted, { passive: true })
  const ro = new ResizeObserver(layout)
  ro.observe(stage)

  const teardown = () => {
    viewer?.destroy()
    viewer = undefined
    flat = undefined
    stage.replaceChildren()
  }

  const show = (p: TodayPicture, a?: Alignment) => {
    teardown()
    pic = p
    align = a?.pic === p.id ? a : initialAlignment(p, target)
    sizeInput.value = String(Math.round(align.fov))
    describeNow()
    renderStrip()
    if (p.is360) open360()
    else openFlat()
    saveAlign()
  }

  const renderStrip = () => {
    strip.replaceChildren(
      ...opts.pictures.slice(0, 8).map((p) => {
        const b = el('button', {
          class: 'tn-thumb' + (p.id === pic.id ? ' is-active' : ''),
          type: 'button',
          role: 'listitem',
          'aria-pressed': String(p.id === pic.id),
          title: `${p.date} · ${p.is360 ? '360°' : 'photo'} · ${Math.round(p.distance)} m`
        }, [el('img', { src: p.thumb, alt: '', loading: 'lazy' }), p.is360 ? el('b', { text: '360°' }) : null])
        b.addEventListener('click', () => show(p))
        return b
      })
    )
  }

  opacityInput.addEventListener('input', () => {
    opacity = Number(opacityInput.value) / 100
    setOpacity(opacity)
  })
  sizeInput.addEventListener('input', () => {
    align = { ...align, fov: Number(sizeInput.value) }
    layout()
    saveAlign()
  })
  const holdOn = () => setOpacity(1)
  const holdOff = () => setOpacity(opacity)
  hold.addEventListener('pointerdown', holdOn)
  hold.addEventListener('pointerup', holdOff)
  hold.addEventListener('pointerleave', holdOff)
  reset.addEventListener('click', () => show(pic, initialAlignment(pic, target)))
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      copy.textContent = 'Link copied'
    } catch {
      copy.textContent = 'Copy from the address bar'
    }
    window.setTimeout(() => (copy.textContent = 'Copy link'), 2000)
  })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') api.close()
    if (e.key === ' ' && e.target === document.body) {
      e.preventDefault()
      holdOn()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === ' ') holdOff()
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('keyup', onKeyUp)
  close.addEventListener('click', () => api.close())

  const api: ThenNow = {
    close() {
      window.clearTimeout(alignTimer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      ro.disconnect()
      teardown()
      root.replaceChildren()
      root.hidden = true
      opts.onClose()
    }
  }

  show(pic, align)
  return api
}

export { DEFAULT_PHOTO_FOV }

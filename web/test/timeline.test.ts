import { describe, expect, it } from 'vitest'
import { BASEMAPS, basemapForYear, cadastreMode, wmtsTileUrl, YEAR_MAX } from '../src/timeline'

describe('basemapForYear', () => {
  it('never shows a map made after the selected year', () => {
    for (let y = 1785; y <= YEAR_MAX; y++) {
      const { basemap, nearestOnly } = basemapForYear(y)
      expect(basemap.from).toBeLessThanOrEqual(y)
      expect(nearestOnly).toBe(false)
    }
  })

  it('picks the latest map at or before the year', () => {
    expect(basemapForYear(1836).basemap.id).toBe('etatmajor')
    expect(basemapForYear(1819).basemap.id).toBe('verniquet')
    expect(basemapForYear(1906).basemap.id).toBe('carte1906')
    expect(basemapForYear(1950).basemap.id).toBe('ortho1949')
    expect(basemapForYear(YEAR_MAX).basemap.id).toBe('planign')
  })

  it('falls back to the earliest survey before 1785 and says so', () => {
    const choice = basemapForYear(1780)
    expect(choice.basemap.id).toBe('verniquet')
    expect(choice.nearestOnly).toBe(true)
  })

  it('has unique ids and increasing start years', () => {
    expect(new Set(BASEMAPS.map((b) => b.id)).size).toBe(BASEMAPS.length)
    const froms = BASEMAPS.map((b) => b.from)
    expect([...froms].sort((a, b) => a - b)).toEqual(froms)
  })
})

describe('wmtsTileUrl', () => {
  it('keeps MapLibre placeholders and sets the layer parameters', () => {
    const b = BASEMAPS.find((x) => x.id === 'ortho1949')!
    if (b.source.kind !== 'wmts') throw new Error('expected wmts')
    const url = wmtsTileUrl(b.source)
    expect(url).toContain('LAYER=ORTHOIMAGERY.EDUGEO.PARIS1949')
    expect(url).toContain('TILEMATRIXSET=PM_6_18')
    expect(url).toContain('FORMAT=image%2Fpng')
    expect(url).toMatch(/TILEMATRIX=\{z\}&TILEROW=\{y\}&TILECOL=\{x\}$/)
  })
})

it('shows the cadastre only from its survey date, ghosted after Haussmann', () => {
  expect(cadastreMode(1790)).toBe('hidden')
  expect(cadastreMode(1836)).toBe('primary')
  expect(cadastreMode(1860)).toBe('ghost')
})

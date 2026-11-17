import { describe, expect, it } from 'vitest'
import { dateLabel, histogram, positionLabel, inWindow, type PhotoFeature, type PhotoProps, yearFilter } from '../src/photos'

const props = (p: Partial<PhotoProps>): PhotoProps => ({
  id: 'x:1', source: 'kahn', source_id: '1', title: 't', license: 'CC0', media: 'photo', pose: 'recorded', confidence: 0.8, ...p
})
const feature = (year?: number): PhotoFeature => ({
  type: 'Feature', id: String(year), geometry: { type: 'Point', coordinates: [2.35, 48.85] }, properties: props({ year })
})

describe('year window', () => {
  it('includes photos whose date range overlaps the window', () => {
    expect(inWindow(props({ year: 1914 }), 1920)).toBe(true)
    expect(inWindow(props({ year: 1900 }), 1920)).toBe(false)
    expect(inWindow(props({ year: 1890, year_end: 1915 }), 1920)).toBe(true)
    expect(inWindow(props({}), 1800)).toBe(true)
  })

  it('builds a MapLibre filter that matches inWindow', () => {
    expect(yearFilter(1900, 8, true)).toEqual(['all'])
    const f = JSON.stringify(yearFilter(1900))
    expect(f).toContain('1908')
    expect(f).toContain('1892')
  })
})

it('bins dated photos and skips undated ones', () => {
  const bins = histogram([feature(1910), feature(1912), feature(1925), feature(undefined)], 1900, 1930, 5)
  expect(bins.find((b) => b.start === 1910)?.count).toBe(2)
  expect(bins.find((b) => b.start === 1925)?.count).toBe(1)
  expect(bins.reduce((n, b) => n + b.count, 0)).toBe(3)
})

it('labels dates', () => {
  expect(dateLabel(props({ year: 1918, year_end: 1919 }))).toBe('1918–1919')
  expect(dateLabel(props({ year: 1918 }))).toBe('1918')
  expect(dateLabel(props({ date_text: 'vers 1910' }))).toBe('vers 1910')
})

it('names the geocoded street in the position label', () => {
  const p = props({ pose: 'geocoded', extra: JSON.stringify({ geocoded_street: "Rue d'Arras 75005 Paris" }) })
  expect(positionLabel(p)).toBe("Approximate: on Rue d'Arras, the street named in the caption")
  expect(positionLabel(props({ pose: 'recorded' }))).toBe('Camera position recorded by the archive')
})

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AREA, AREAS, areaCenter, inArea, type Area } from './areas'

const areas: Area[] = Object.values(AREAS)

describe('the table of 3D areas', () => {
  it('names each area by its key', () => {
    for (const [key, area] of Object.entries(AREAS)) expect(area.key).toBe(key)
    expect(AREA).toBe(AREAS.cite)
  })

  it('points at files that are in the repository', () => {
    for (const area of areas) {
      for (const [kind, file] of Object.entries(area.files)) {
        expect(file.startsWith('data/3d/'), `${area.key} ${kind}`).toBe(true)
        expect(existsSync(new URL(`../public/${file}`, import.meta.url)), file).toBe(true)
      }
    }
  })

  it('keeps the camera target, the opening view and the walk start inside the box', () => {
    for (const area of areas) {
      const [w, s, e, n] = area.bounds
      expect(w).toBeLessThan(e)
      expect(s).toBeLessThan(n)
      expect(inArea(area, ...area.camera.to)).toBe(true)
      expect(inArea(area, ...area.view.center)).toBe(true)
      expect(inArea(area, ...area.walk.start)).toBe(true)
      expect(inArea(area, ...areaCenter(area))).toBe(true)
      expect(inArea(area, w - 0.001, s)).toBe(false)
    }
  })

  it('holds the Cité as it was before the table', () => {
    const cite = AREAS.cite
    expect(cite.bounds).toEqual([2.3385, 48.8505, 2.3565, 48.859])
    expect(areaCenter(cite)).toEqual([(2.3385 + 2.3565) / 2, (48.8505 + 48.859) / 2])
    expect(cite.camera).toEqual({ from: [2.3455, 48.8522], altitude: 160, to: [2.3488, 48.8535] })
    expect(cite.view).toEqual({ center: [2.3488, 48.8535], zoom: 17.3, pitch: 60, bearing: 59 })
    expect(cite.walk).toEqual({ start: [2.34838, 48.85336], bearing: 115 })
    expect(cite.files).toEqual({
      model: 'data/3d/cite-1836.geojson',
      site: 'data/3d/site-cite.geojson',
      greenery: 'data/3d/greenery-cite.json',
      streets: 'data/3d/streets-cite.json',
      landmarks: 'data/3d/landmarks-cite.json',
      vehicles: 'data/3d/vehicles-cite.json'
    })
  })

  it('is the only place in the app that names an area file', () => {
    const dir = new URL('.', import.meta.url)
    const names = areas.flatMap((a) => Object.values(a.files).map((f) => f.slice('data/3d/'.length)))
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'areas.ts') continue
      const code = readFileSync(new URL(file, dir), 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)) // comments may name a file
        .join('\n')
      for (const name of names) expect(code.includes(name), `${file} names ${name}`).toBe(false)
    }
  })
})

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAnnotation } from '@allmaps/annotation'

const verniquet = new URL('../public/data/verniquet.json', import.meta.url)

describe.skipIf(!existsSync(verniquet))('generated Verniquet annotations', () => {
  it('parse with Allmaps and keep every control point inside its image', () => {
    const maps = parseAnnotation(JSON.parse(readFileSync(verniquet, 'utf8')))
    expect(maps.length).toBe(72)
    for (const m of maps) {
      for (const g of m.gcps) {
        expect(g.resource[0]).toBeGreaterThanOrEqual(0)
        expect(g.resource[0]).toBeLessThanOrEqual(m.resource.width!)
        expect(g.resource[1]).toBeLessThanOrEqual(m.resource.height!)
        expect(g.geo[0]).toBeGreaterThan(2.2)
        expect(g.geo[0]).toBeLessThan(2.45)
      }
    }
  })
})

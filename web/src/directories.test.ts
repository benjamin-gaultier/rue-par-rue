import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AREAS } from './areas'
import { CARD_LISTINGS, describeListings, type Directories } from './directories'
import { TRADE } from './signs'

const data = JSON.parse(readFileSync(new URL(`../public/${AREAS.cite.files.directories}`, import.meta.url), 'utf8')) as Directories
const model = JSON.parse(readFileSync(new URL(`../public/${AREAS.cite.files.model}`, import.meta.url), 'utf8')) as {
  features: { properties: { id: string } }[]
}

describe('the trade directories on the building card', () => {
  it('lists names under buildings of the model, with a source page and a year', () => {
    const ids = new Set(model.features.map((f) => f.properties.id))
    const entries = Object.entries(data.buildings)
    expect(entries.length).toBeGreaterThan(1000)
    for (const [id, list] of entries) {
      expect(ids.has(id), id).toBe(true)
      for (const l of list) {
        expect(l.name.length).toBeGreaterThan(1)
        expect(l.page).toMatch(/^https:\/\//)
        expect(l.years.every((y) => data.years.includes(y))).toBe(true)
        if (l.trade) expect(TRADE[l.trade], l.trade).toBeTypeOf('number')
      }
    }
    expect(data.licence).toContain('Etalab')
  })

  it('describes a building’s listings and says what it leaves out', () => {
    const d: Directories = {
      source: 'SoDUCo',
      licence: 'Licence Ouverte / Etalab 2.0',
      years: [1835, 1837],
      buildings: {
        'vasserot:PA1': Array.from({ length: CARD_LISTINGS + 2 }, (_, i) => ({
          name: `Rogé ${i}`,
          act: i ? 'épicier' : '',
          address: '29 Rue des Marmousets',
          years: [1835, 1837],
          page: 'https://gallica.bnf.fr/ark:/12148/bpt6k995082w/f306'
        }))
      }
    }
    const card = describeListings(d, 'vasserot:PA1')!
    expect(card.heading).toBe('In the Paris directories of 1835 and 1837')
    expect(card.rows).toHaveLength(CARD_LISTINGS)
    expect(card.rows[0].text).toBe('Rogé 0, 29 Rue des Marmousets (1835, 1837)')
    expect(card.rows[1].text).toBe('Rogé 1, épicier, 29 Rue des Marmousets (1835, 1837)')
    expect(card.more).toBe(2)
    expect(card.credit).toContain('SoDUCo')
    expect(describeListings(d, 'vasserot:PA2')).toBeNull()
    expect(describeListings(d, undefined)).toBeNull()
  })
})

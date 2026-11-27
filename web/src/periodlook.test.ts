import { describe, expect, it } from 'vitest'
import { periodLabel, periodLook } from './periodlook'

describe('periodLook', () => {
  it('follows the photographs of each period', () => {
    expect(periodLook(1836)?.id).toBe('early')
    expect(periodLook(1865)?.id).toBe('albumen')
    expect(periodLook(1898)?.id).toBe('silver')
    expect(periodLook(1914)?.id).toBe('autochrome')
    expect(periodLook(1949)?.id).toBe('film')
    expect(periodLook(1985)?.id).toBe('colour')
  })

  it('changes at the boundaries', () => {
    expect(periodLook(1889)?.id).toBe('albumen')
    expect(periodLook(1890)?.id).toBe('silver')
    expect(periodLook(1907)?.id).toBe('autochrome')
  })

  it('leaves today alone', () => {
    expect(periodLook(2000)).toBeNull()
    expect(periodLook(2026)).toBeNull()
  })

  it('only the autochromes have colour grain', () => {
    expect(periodLook(1914)?.colourGrain).toBe(true)
    expect(periodLook(1865)?.colourGrain).toBe(false)
  })

  it('says it is a display effect', () => {
    expect(periodLabel(periodLook(1865)!)).toBe('Tinted like albumen prints, as Marville’s: a display effect, not part of the data')
  })
})

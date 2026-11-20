import { describe, expect, it } from 'vitest'
import { frameBearing } from './frames3d'

describe('frameBearing', () => {
  it('faces the viewer when the heading is unknown', () => {
    expect(frameBearing(123)).toBe(123)
  })
  it('stands where the photographer looked, turning at most 60° towards the viewer', () => {
    expect(frameBearing(30, 30)).toBe(30)
    expect(frameBearing(70, 30)).toBe(70)
    expect(frameBearing(150, 30)).toBe(90)
    expect(frameBearing(200, 30)).toBe(90) // seen from behind, 170° off: turns 60° the short way round
    expect(frameBearing(240, 30)).toBe(-30)
    expect(frameBearing(350, 10)).toBe(-10)
  })
})

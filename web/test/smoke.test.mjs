// The browser-free parts of the smoke test (tools/smoke): what it counts as a failure, and its file server.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { classify, fileFor, isExternal, parseYears, serve, viewProblems } from '../../tools/smoke/lib.mjs'

const LOCAL = '127.0.0.1:5000'

describe('isExternal', () => {
  it('is true for a message about another site only', () => {
    expect(isExternal('503 https://data.geopf.fr/wmts?layer=x', LOCAL)).toBe(true)
    expect(isExternal('net::ERR_FAILED https://fonts.googleapis.com/css2?family=Barlow', LOCAL)).toBe(true)
  })
  it('is false when the site under test is named, or no site at all', () => {
    expect(isExternal(`404 http://${LOCAL}/data/3d/site-cite.geojson`, LOCAL)).toBe(false)
    expect(isExternal(`Error at http://${LOCAL}/assets/a.js while loading https://data.geopf.fr/x`, LOCAL)).toBe(false)
    expect(isExternal('Detailed 3D area cannot be drawn: the "roofs" shader did not compile', LOCAL)).toBe(false)
  })
})

describe('classify', () => {
  it('fails on console errors, uncaught errors and files of the site that do not load', () => {
    const { failures, notes } = classify(
      [
        { kind: 'error', text: 'Detailed 3D area cannot be drawn: drawing failed' },
        { kind: 'exception', text: 'TypeError: x is not a function' },
        { kind: 'request', text: `404 http://${LOCAL}/data/photos.geojson` }
      ],
      LOCAL
    )
    expect(failures).toHaveLength(3)
    expect(notes).toHaveLength(0)
  })
  it('notes trouble on other sites without failing', () => {
    const { failures, notes } = classify(
      [
        { kind: 'request', text: '503 https://data.geopf.fr/wmts?layer=x' },
        { kind: 'error', text: 'AJAXError: Service Unavailable (503): https://stacks.stanford.edu/file/x.pmtiles' }
      ],
      LOCAL
    )
    expect(failures).toHaveLength(0)
    expect(notes).toHaveLength(2)
  })
  it('fails on an uncaught error even when it names another site', () => {
    expect(classify([{ kind: 'exception', text: 'TypeError at https://cdn.example.org/x.js' }], LOCAL).failures).toHaveLength(1)
  })
  it('fails only on the warnings that mean part of the 3D view is missing', () => {
    const { failures } = classify(
      [
        { kind: 'warning', text: 'City module streets failed to build: Error: streets: 404' },
        { kind: 'warning', text: 'City module unavailable: TypeError: Failed to fetch dynamically imported module' },
        { kind: 'warning', text: 'The "walls-landmarks" shader did not compile on this device: drawing those walls plain.' },
        { kind: 'warning', text: 'Detailed 3D area unavailable: SyntaxError' },
        { kind: 'warning', text: 'WebGL: CONTEXT_LOST_WEBGL: loseContext: context lost' },
        { kind: 'warning', text: 'Image "x" could not be loaded.' }
      ],
      LOCAL
    )
    expect(failures).toHaveLength(5)
  })
  it('lets the missing favicon through', () => {
    expect(classify([{ kind: 'request', text: `404 http://${LOCAL}/favicon.ico` }], LOCAL).failures).toHaveLength(0)
  })
})

describe('viewProblems', () => {
  const ok = { app: true, city: true, frames: 5, count: 3157, failed: [], error: null, lost: false }
  it('finds nothing wrong with a drawn city, or one still loading', () => {
    expect(viewProblems(ok)).toEqual([])
    expect(viewProblems({ app: true, city: false, frames: 0, count: 0, failed: [], error: null, lost: false })).toEqual([])
    expect(viewProblems({})).toEqual([])
  })
  it('reports the fallback message, a lost context, failed modules and an empty city', () => {
    expect(viewProblems({ ...ok, error: 'The detailed island cannot be drawn on this device: x.' })[0]).toContain('cannot be drawn')
    expect(viewProblems({ ...ok, lost: true })).toEqual(['the WebGL context was lost'])
    expect(viewProblems({ ...ok, failed: ['streets'] })).toEqual(['city modules failed: streets'])
    expect(viewProblems({ ...ok, count: 0 })).toEqual(['the detailed island has no building'])
  })
})

describe('parseYears', () => {
  it('reads years and "today"', () => {
    expect(parseYears('1836,today', 2026)).toEqual([1836, 2026])
    expect(parseYears(' 1790, 1900 ')).toEqual([1790, 1900])
  })
  it('refuses anything else', () => {
    expect(() => parseYears('1836,soon')).toThrow()
    expect(() => parseYears('')).toThrow()
    expect(() => parseYears('18360')).toThrow()
  })
})

describe('the file server', () => {
  let root
  let server
  let origin
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'rpr-smoke-test-'))
    mkdirSync(join(root, 'data'))
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>x</title>')
    writeFileSync(join(root, 'data', 'île.json'), '{"a":"0123456789"}')
    writeFileSync(join(root, 'worker.mjs'), 'export {}')
    const s = await serve(root)
    server = s.server
    origin = `http://127.0.0.1:${s.port}`
  })
  afterAll(() => {
    server.close()
    server.closeAllConnections()
    rmSync(root, { recursive: true, force: true })
  })

  it('never leaves its folder', () => {
    expect(fileFor(root, '/data/%C3%AEle.json')).toBe(join(root, 'data', 'île.json'))
    expect(fileFor(root, '/')).toBe(join(root, 'index.html'))
    expect(fileFor(root, '/../' + root.split(/[\\/]/).pop() + '/index.html')).toBe(join(root, 'index.html'))
    expect(fileFor(root, '/../../etc/passwd')).toBeUndefined()
    expect(fileFor(root, '/..%2F..%2Fsecret')).toBeUndefined()
    expect(fileFor(root, '/data')).toBeUndefined()
    expect(fileFor(root, '/%E0%A4%A')).toBeUndefined()
  })
  it('serves the page, data and workers with their types', async () => {
    const page = await fetch(origin + '/?debug')
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    expect((await fetch(origin + '/data/%C3%AEle.json').then((r) => r.json())).a).toBe('0123456789')
    // A module worker only starts when its file is served as JavaScript.
    expect((await fetch(origin + '/worker.mjs')).headers.get('content-type')).toContain('text/javascript')
  })
  it('answers 404 for a missing file and serves byte ranges', async () => {
    expect((await fetch(origin + '/data/none.json')).status).toBe(404)
    const part = await fetch(origin + '/data/%C3%AEle.json', { headers: { range: 'bytes=6-9' } })
    expect(part.status).toBe(206)
    expect(await part.text()).toBe('0123')
    expect((await fetch(origin + '/data/%C3%AEle.json', { headers: { range: 'bytes=999-' } })).status).toBe(416)
  })
})

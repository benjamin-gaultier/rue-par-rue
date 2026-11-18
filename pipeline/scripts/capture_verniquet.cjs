// Screenshots of Verniquet's atlas (about 1790) as the app shows it,
// georeferenced, for `python -m rpr institutions` to trace hatched buildings.
//
// Usage: build and serve the app (cd web && npx vite build && npx vite preview --port 4173),
// then: node pipeline/scripts/capture_verniquet.cjs [http://localhost:4173/]
// Writes pipeline/cache/verniquet/<name>.png and captures.json (corner coordinates).

const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = process.argv[2] || 'http://localhost:4173/'
const OUT = path.join(__dirname, '..', 'cache', 'verniquet')
const W = 1600
const H = 1000
const ZOOM = 18.6
const VIEWS = {
  'vern-palace': [48.85262, 2.35055],
  'vern-hoteldieu': [48.8529, 2.34775],
  'vern-parvis': [48.85345, 2.3483]
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  })
  const meta = {}
  for (const [name, [lat, lon]] of Object.entries(VIEWS)) {
    const page = await browser.newPage({ viewport: { width: W, height: H } })
    await page.goto(`${BASE}?debug#y=1790&m=${ZOOM}/${lat}/${lon}`)
    await page.waitForTimeout(40000) // the atlas tiles are warped in the browser
    await page.addStyleTag({ content: '.side, .brand, #timebar, .maplibregl-ctrl, #panel { visibility: hidden !important }' })
    await page.evaluate(() => {
      const m = window.rpr.map
      for (const id of ['photos', 'selection', 'selection-cone']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', 'none')
    })
    await page.waitForTimeout(3000)
    await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 90000 })
    const info = await page.evaluate(([w, h]) => {
      const m = window.rpr.map
      const a = m.unproject([0, 0])
      const b = m.unproject([w, h])
      return { lon0: a.lng, lat0: a.lat, lon1: b.lng, lat1: b.lat, map_h: m.getContainer().clientHeight }
    }, [W, H])
    meta[`${name}.png`] = { zoom: ZOOM, w: W, h: H, ...info }
    await page.close()
  }
  fs.writeFileSync(path.join(OUT, 'captures.json'), JSON.stringify(meta, null, 2))
  await browser.close()
})()

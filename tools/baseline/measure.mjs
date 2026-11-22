// Measure what the 3D area costs in a real Chrome: buildings, GPU buffers,
// time to the first 3D frame and frame time, on a desktop-sized and a
// phone-sized viewport, for each year given.
//
//   node tools/baseline/measure.mjs [--url http://127.0.0.1:5176/] [--years 1836,2026]
//        [--frames 360] [--chrome PATH] [--headed] [--json FILE]
//
// The app must be built and served first (see README.md beside this file).
// Needs Node 22 or later (for its built-in WebSocket) and Chrome or Edge.
// No packages: it drives Chrome over the DevTools protocol.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const VIEWPORTS = [
  { name: 'desktop', width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
  { name: 'phone', width: 375, height: 812, deviceScaleFactor: 3, mobile: true }
]

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i < 0 ? fallback : process.argv[i + 1]
}
const flag = (name) => process.argv.includes(`--${name}`)

function findChrome() {
  const env = process.env
  const places = [
    option('chrome'),
    env.CHROME,
    `${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env.LocalAppData}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ]
  const found = places.find((p) => p && existsSync(p))
  if (!found) throw new Error('No Chrome or Edge found. Give one with --chrome <path>.')
  return found
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A DevTools protocol session on one page. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('Cannot reach Chrome'))
  })
  let next = 1
  const waiting = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id)
      waiting.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    } else if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = next++
      waiting.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  return { send, evaluate, errors, close: () => ws.close() }
}

/** One cold load in a fresh browser profile, then `rpr.measure()`. */
async function measureOnce(chrome, url, year, viewport, frames) {
  const profile = mkdtempSync(join(tmpdir(), 'rpr-baseline-'))
  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=d3d11',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${Math.max(viewport.width, 500)},${viewport.height}`,
    ...(flag('headed') ? [] : ['--headless=new']),
    'about:blank'
  ]
  if (process.platform !== 'win32') args.splice(args.indexOf('--use-angle=d3d11'), 1)
  const child = spawn(chrome, args, { stdio: 'ignore' })
  let page
  try {
    const portFile = join(profile, 'DevToolsActivePort')
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100)
    const port = readFileSync(portFile, 'utf8').split('\n')[0].trim()
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    page = await connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
    await page.send('Runtime.enable')
    await page.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor, mobile: viewport.mobile })
    await page.send('Page.navigate', { url: `${url}?debug#y=${year}&d=3d` })
    // Wait for the first frame with the detailed city (at most two minutes).
    let drawn = false
    for (let i = 0; i < 240 && !drawn; i++) {
      await sleep(500)
      drawn = await page.evaluate(`performance.getEntriesByName('rpr-first-3d-frame').length > 0`).catch(() => false)
    }
    if (!drawn) throw new Error(`The detailed area was not drawn within two minutes. ${page.errors.join(' | ')}`)
    const refused = await page.evaluate(`document.querySelector('.banner-3d-error')?.textContent ?? ''`)
    if (refused) throw new Error(refused)
    const result = await page.evaluate(`rpr.measure({ frames: ${frames} })`)
    return { device: viewport.name, ...result, errors: page.errors }
  } finally {
    await page?.send('Browser.close').catch(() => undefined)
    page?.close()
    child.kill()
    for (let i = 0; i < 20; i++) {
      try {
        rmSync(profile, { recursive: true, force: true })
        break
      } catch {
        await sleep(250)
      }
    }
  }
}

const url = option('url', 'http://127.0.0.1:5176/')
const years = option('years', '1836,2026').split(',').map(Number)
const frames = Number(option('frames', '360'))
const chrome = findChrome()

const results = []
for (const viewport of VIEWPORTS)
  for (const year of years) {
    process.stderr.write(`${viewport.name} ${year}… `)
    const r = await measureOnce(chrome, url, year, viewport, frames)
    results.push(r)
    process.stderr.write(`first frame ${r.firstFrameMs} ms, turn above ${r.orbit.draw.medianMs} ms, turn in the street ${r.street.draw.medianMs} ms\n`)
  }

const jsonFile = option('json')
if (jsonFile) writeFileSync(jsonFile, JSON.stringify(results, null, 2))

const n = (v) => v.toLocaleString('en-US')
const path = (p) => `${p.draw.medianMs} / ${p.draw.p95Ms} | ${p.interval.medianMs} / ${p.interval.p95Ms} | ${n(p.triangles)} | ${p.calls}`
console.log(`GPU: ${results[0].gpu}`)
console.log()
console.log('| Year | Detailed buildings, all years | Standing that year | Trees | GPU buffers MB | Meshes |')
console.log('| --- | ---: | ---: | ---: | ---: | ---: |')
for (const r of results.filter((r) => r.device === results[0].device))
  console.log(`| ${r.year} | ${n(r.buildings.all)} | ${n(r.buildings.standing)} | ${n(r.trees)} | ${r.bufferMB} | ${r.meshes} |`)
console.log()
console.log('| GPU buffers by material | MB |')
console.log('| --- | ---: |')
for (const [name, mb] of results[0].bufferParts) console.log(`| ${name} | ${mb} |`)
console.log()
console.log('| Viewport | Year | First 3D frame ms | Path | Draw ms, median / 95th | Between frames ms, median / 95th | Triangles | Draw calls |')
console.log('| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |')
for (const r of results) {
  const label = `${r.device}, ${r.viewport.width} × ${r.viewport.height} at ${r.viewport.pixelRatio}×`
  console.log(`| ${label} | ${r.year} | ${n(r.firstFrameMs)} | turn above | ${path(r.orbit)} |`)
  console.log(`| ${label} | ${r.year} | | turn in the street | ${path(r.street)} |`)
}
const errors = results.flatMap((r) => r.errors.map((e) => `${r.device} ${r.year}: ${e}`))
if (errors.length) {
  console.log()
  console.log('Console errors:')
  for (const e of errors) console.log(`- ${e}`)
  process.exitCode = 1
}

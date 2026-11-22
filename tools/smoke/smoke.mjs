#!/usr/bin/env node
/**
 * A browser smoke test of the 3D view.
 *
 *     cd web && npm run build && npm run smoke
 *
 * It serves the built site (web/dist) on a loopback port, opens it in headless Chrome with software
 * WebGL, shows the Île de la Cité in 3D at 1836 and today, and exits with 1 on a console error, an
 * uncaught error, a file of the site that does not load, a lost WebGL context, or the message that
 * the detailed island cannot be drawn. It needs Node 22 or later and Chrome, Chromium or Edge, and
 * nothing from npm. See README.md.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { classify, parseYears, serve, viewProblems } from './lib.mjs'

// Output piped to a command that stops reading (head) must not crash the run before the browser is closed.
process.stdout.on('error', () => {})

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')

const { values: args } = parseArgs({
  options: {
    dist: { type: 'string', default: join(ROOT, 'web', 'dist') },
    years: { type: 'string', default: '1836,today' },
    chrome: { type: 'string' },
    gl: { type: 'string', default: 'software' },
    timeout: { type: 'string', default: '180' },
    screenshots: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
})

if (args.help) {
  console.log(`Usage: node tools/smoke/smoke.mjs [options]

  --dist DIR          the built site (default web/dist: run "npm run build" in web/ first)
  --years LIST        years to show in 3D (default 1836,today)
  --gl software|gpu   software WebGL (SwiftShader, the default, the same everywhere) or this computer's GPU
  --chrome PATH       chrome, chromium or msedge (default: the CHROME variable, then the usual places)
  --timeout SECONDS   how long one year may take to draw (default 180)
  --screenshots DIR   save a picture of each year there`)
  process.exit(0)
}

function findBrowser() {
  const env = process.env
  const list = [args.chrome, env.CHROME]
  if (process.platform === 'win32') {
    for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LocalAppData]) if (base) list.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles]) if (base) list.push(join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  } else if (process.platform === 'darwin') {
    list.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium')
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'])
      for (const dir of (env.PATH ?? '').split(':')) if (dir) list.push(join(dir, name))
  }
  const found = list.find((p) => p && existsSync(p))
  if (!found) throw new Error('No Chrome, Chromium or Edge found. Give one with --chrome <path>.')
  return found
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A small Chrome DevTools Protocol client over Node's own WebSocket. */
class Page {
  constructor(ws) {
    this.ws = ws
    this.next = 1
    this.waiting = new Map()
    this.handlers = []
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id) {
        const w = this.waiting.get(msg.id)
        this.waiting.delete(msg.id)
        if (msg.error) w?.fail(new Error(`${w.method}: ${msg.error.message}`))
        else w?.done(msg.result)
      } else for (const h of this.handlers) h(msg.method, msg.params)
    })
  }
  static async open(url) {
    const ws = new WebSocket(url)
    await new Promise((done, fail) => {
      ws.addEventListener('open', done, { once: true })
      ws.addEventListener('error', () => fail(new Error('Could not connect to the browser')), { once: true })
    })
    return new Page(ws)
  }
  send(method, params = {}) {
    const id = this.next++
    return new Promise((done, fail) => {
      this.waiting.set(id, { done, fail, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
}

/** One snapshot of the page. `rpr` is what main.ts puts on window when the address has ?debug. */
const STATE = `(() => {
  const r = window.rpr
  const c = r && r.city()
  const err = document.querySelector('.banner-3d-error')
  if (r) r.map.triggerRepaint()
  return JSON.stringify({
    app: !!r,
    city: !!c,
    frames: c ? c.frames : 0,
    count: c ? c.count : 0,
    failed: c ? c.failed : [],
    error: err ? err.textContent : null,
    lost: r ? r.map.painter.context.gl.isContextLost() : false,
    year: r ? r.state.year : null,
    is3d: document.body.classList.contains('is-3d')
  })
})()`

const text = (o) => (o.value !== undefined ? String(o.value) : (o.description ?? o.type))

async function run() {
  const years = parseYears(args.years)
  const timeout = Number(args.timeout) * 1000
  if (!existsSync(join(args.dist, 'index.html'))) throw new Error(`No built site in ${args.dist}: run "npm run build" in web/ first.`)
  const browser = findBrowser()
  const { server, port } = await serve(args.dist)
  const localHost = `127.0.0.1:${port}`
  const profile = mkdtempSync(join(tmpdir(), 'rpr-smoke-'))
  const flags = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--window-size=1280,800',
    '--ignore-gpu-blocklist',
    ...(args.gl === 'gpu' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    // GitHub's Linux runners do not let Chrome build its sandbox.
    ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox'] : []),
    'about:blank'
  ]
  const chrome = spawn(browser, flags, { stdio: 'ignore' })
  const events = []
  const failures = []
  try {
    // Chrome writes the port it chose to this file.
    const portFile = join(profile, 'DevToolsActivePort')
    for (let i = 0; i < 150 && !existsSync(portFile); i++) await sleep(200)
    if (!existsSync(portFile)) throw new Error('The browser did not start.')
    const debugPort = readFileSync(portFile, 'utf8').split('\n')[0].trim()
    let target
    for (let i = 0; i < 50 && !target; i++) {
      const list = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((r) => r.json()).catch(() => [])
      target = list.find((t) => t.type === 'page')
      if (!target) await sleep(200)
    }
    if (!target) throw new Error('The browser opened no page.')
    const page = await Page.open(target.webSocketDebuggerUrl)

    const requests = new Map()
    page.handlers.push((method, p) => {
      if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning'))
        events.push({ kind: p.type, text: p.args.map(text).join(' ').slice(0, 600) })
      else if (method === 'Runtime.exceptionThrown')
        events.push({ kind: 'exception', text: (p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 600) })
      else if (method === 'Network.requestWillBeSent') requests.set(p.requestId, p.request.url)
      else if (method === 'Network.responseReceived' && p.response.status >= 400)
        events.push({ kind: 'request', text: `${p.response.status} ${p.response.url}` })
      else if (method === 'Network.loadingFailed' && !p.canceled)
        events.push({ kind: 'request', text: `${p.errorText} ${requests.get(p.requestId) ?? ''}` })
    })
    await page.send('Runtime.enable')
    await page.send('Network.enable')
    await page.send('Page.enable')

    const started = Date.now()
    await page.send('Page.navigate', { url: `http://${localHost}/?debug#y=${years[0]}&d=3d` })
    let frames = 0
    for (const [i, year] of years.entries()) {
      if (i > 0) await page.eval(`window.rpr.setYear(${year})`)
      const from = frames
      const end = Date.now() + timeout
      let s
      let problems = []
      // Drawn means three more frames of the detailed island, then still no complaint half a second later.
      for (;;) {
        await sleep(250)
        s = JSON.parse(await page.eval(STATE).catch(() => '{}'))
        problems = viewProblems(s)
        if (problems.length) break
        // No use waiting for a view the page has already said it cannot load.
        if (!s.city && classify(events, localHost).failures.length) {
          problems = ['the detailed island did not load']
          break
        }
        if (s.city && s.is3d && s.year === year && s.frames >= from + 3) {
          if (i === 0 && !from) console.log(`First 3D frames after ${((Date.now() - started) / 1000).toFixed(1)} s`)
          await sleep(500)
          s = JSON.parse(await page.eval(STATE))
          problems = viewProblems(s)
          break
        }
        if (Date.now() > end) {
          const where = !s.app ? 'the page did not start' : !s.is3d ? 'the 3D view did not open' : !s.city ? 'the detailed island did not load' : `the detailed island drew ${s.frames - from} frames`
          problems = [`not drawn after ${args.timeout} s: ${where}`]
          break
        }
      }
      frames = s.frames ?? frames
      if (args.screenshots) {
        mkdirSync(args.screenshots, { recursive: true })
        const shot = await page.send('Page.captureScreenshot', { format: 'png' })
        writeFileSync(join(args.screenshots, `${year}.png`), Buffer.from(shot.data, 'base64'))
      }
      if (problems.length) {
        for (const p of problems) failures.push(`${year}: ${p}`)
        console.log(`${year}: FAILED`)
        break
      }
      console.log(`${year}: drawn, ${s.count} buildings in detail`)
    }
    page.ws.close()
  } finally {
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(chrome.pid)], { stdio: 'ignore' })
    else chrome.kill('SIGKILL')
    server.close()
    server.closeAllConnections()
    for (let i = 0; i < 10; i++) {
      try {
        rmSync(profile, { recursive: true, force: true })
        break
      } catch {
        await sleep(300) // Chrome is still letting go of its files
      }
    }
  }
  const sorted = classify(events, localHost)
  failures.push(...sorted.failures)
  const notes = [...new Set(sorted.notes)]
  if (notes.length) {
    console.log(`\nNot counted, ${notes.length} messages about other sites (tiles, fonts):`)
    for (const n of notes.slice(0, 5)) console.log('  ' + n)
    if (notes.length > 5) console.log(`  and ${notes.length - 5} more`)
  }
  if (failures.length) {
    console.log('\nFAILED')
    for (const f of [...new Set(failures)]) console.log('  ' + f)
    return 1
  }
  console.log('\nThe 3D view draws with no error.')
  return 0
}

run().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err.message)
    process.exit(2)
  }
)

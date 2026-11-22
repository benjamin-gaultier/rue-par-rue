// The parts of the smoke test that need no browser: what counts as a failure, and the static file server.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

/** Console warnings that mean part of the 3D view is missing. Other warnings are let through. */
export const BAD_WARNINGS = [/City module .*(unavailable|failed)/, /did not compile/, /Detailed 3D area unavailable/, /WebGL.*context.*lost/i]

/** The hosts named in a message, lower case. */
export function hostsIn(text) {
  return [...String(text).matchAll(/https?:\/\/([^/\s"')]+)/g)].map((m) => m[1].toLowerCase())
}

/**
 * True when a message is only about another site (map tiles, fonts, the cadastre server):
 * it names at least one host and none of them is the site under test.
 * Those sites can be down or out of reach without the build being wrong.
 */
export function isExternal(text, localHost) {
  const hosts = hostsIn(text)
  return hosts.length > 0 && !hosts.includes(localHost.toLowerCase())
}

/**
 * Sort what the page said into failures and notes.
 * events: [{ kind: 'error' | 'warning' | 'exception' | 'request', text }]
 */
export function classify(events, localHost) {
  const failures = []
  const notes = []
  for (const e of events) {
    if (e.kind === 'warning') {
      if (BAD_WARNINGS.some((re) => re.test(e.text))) failures.push(`console warning: ${e.text}`)
      continue
    }
    // Browsers ask for /favicon.ico on their own; the site has none.
    if (e.kind === 'request' && /\/favicon\.ico$/.test(e.text)) continue
    if (e.kind !== 'exception' && isExternal(e.text, localHost)) {
      notes.push(`another site: ${e.text}`)
      continue
    }
    const label = { error: 'console error', exception: 'uncaught error', request: 'request failed' }[e.kind] ?? e.kind
    failures.push(`${label}: ${e.text}`)
  }
  return { failures, notes }
}

/**
 * What is wrong with the 3D view in one snapshot of the page (see STATE in smoke.mjs), as a list of reasons.
 * An empty list means the detailed island is being drawn.
 */
export function viewProblems(s) {
  const out = []
  if (s.error) out.push(`the page says: ${s.error}`)
  if (s.lost) out.push('the WebGL context was lost')
  if (s.failed?.length) out.push(`city modules failed: ${s.failed.join(', ')}`)
  if (s.city && !s.count) out.push('the detailed island has no building')
  return out
}

/** The years to open: "1836,today" gives [1836, 2026]. */
export function parseYears(text, today = new Date().getFullYear()) {
  const years = String(text)
    .split(',')
    .map((y) => (y.trim() === 'today' ? today : Number(y)))
  if (!years.length || years.some((y) => !Number.isInteger(y) || y < 1700 || y > 2100)) throw new Error(`Not a list of years: ${text}`)
  return years
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
}

/** The file a URL path names under `root`, or undefined when it leaves `root` or is not a file. */
export function fileFor(root, urlPath) {
  let path
  try {
    path = decodeURIComponent(urlPath.split(/[?#]/)[0])
  } catch {
    return undefined
  }
  if (path.endsWith('/')) path += 'index.html'
  const base = resolve(root)
  const file = normalize(join(base, path))
  if (file !== base && !file.startsWith(base + sep)) return undefined
  return existsSync(file) && statSync(file).isFile() ? file : undefined
}

/** Serve a built site from `root` on a free loopback port. Resolves to { server, port }. */
export function serve(root) {
  const server = createServer((req, res) => {
    const file = fileFor(root, req.url ?? '/')
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('Not found')
      return
    }
    const size = statSync(file).size
    const head = { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' }
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
    if (range) {
      const start = Number(range[1])
      const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1)
      if (start > end) {
        res.writeHead(416, { 'content-range': `bytes */${size}` })
        res.end()
        return
      }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 })
      createReadStream(file, { start, end }).pipe(res)
      return
    }
    res.writeHead(200, { ...head, 'content-length': size })
    if (req.method === 'HEAD') res.end()
    else createReadStream(file).pipe(res)
  })
  return new Promise((done, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => done({ server, port: server.address().port }))
  })
}

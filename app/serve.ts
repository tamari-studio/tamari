// Serves a finished build locally the way Vercel does: dist/ as static files
// with an index.html fallback, and /api/* through the bundled API. Run it
// through `bun run dev` (which builds and restarts it on changes) or
// `bun run start` (serve the last build as is). Bun loads .env from the repo root.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { publicSupabaseUrl } from './server/supabase'
import { staticFile } from './static-file'

const ROOT = join(import.meta.dir, '..')
const DIST = join(ROOT, 'dist')
const port = Number(process.env.PORT ?? 13380)

const entry = join(ROOT, 'api', '_generated', 'server-entry.js')
if (!existsSync(entry) || !existsSync(join(DIST, 'index.html'))) {
  console.error('miso: no build yet — run `bun run build` (or `bun run dev`).')
  process.exit(1)
}
const { createMisoApp } = (await import(entry)) as { createMisoApp: (root?: string) => { fetch: (r: Request) => Response | Promise<Response> } }
const app = createMisoApp(ROOT)

// The same policy as vercel.json, except that connect-src names this app's Supabase instead of any
// https host: a local Supabase is http, a hosted one https, and the origin is known here.
function connectSources(): string {
  try {
    const url = new URL(publicSupabaseUrl())
    return `${url.origin} ${url.origin.replace(/^http/, 'ws')}`
  } catch {
    return 'https: wss:'
  }
}
const CSP = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' blob: data:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ${connectSources()}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
const secure = (res: Response): Response => {
  res.headers.set('Content-Security-Policy', CSP)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  return res
}

// --reuse-port (cli/selfhost.ts only): the next server starts on this port before this one stops,
// so a rebuild drops no request. Not in dev: there a second server on the port must fail loudly.
const reusePort = process.argv.includes('--reuse-port')

const server = Bun.serve({
  port,
  hostname: process.env.HOST ?? '127.0.0.1',
  reusePort,
  idleTimeout: 120,
  fetch(req) {
    const { pathname } = new URL(req.url)
    if (pathname.startsWith('/api/')) return app.fetch(req)
    const file = staticFile(DIST, pathname)
    if (file) return secure(file)
    // A file of another build (a page older than the deploy asking for its view): a 404 the
    // stale-build check recognises, as on Vercel (vercel.json), not index.html as JavaScript.
    if (pathname.startsWith('/assets/')) return new Response('Not found', { status: 404 })
    return secure(new Response(Bun.file(join(DIST, 'index.html')), { headers: { 'Cache-Control': 'no-cache' } }))
  }
})

console.log(`miso: hosted app on http://localhost:${port}`)

if (reusePort) {
  // The next server already listens: take no new requests, finish the ones in flight, then go.
  process.on('SIGTERM', () => {
    setTimeout(() => process.exit(0), 30_000).unref()
    void server.stop().then(() => process.exit(0))
  })
}

// A file from a finished build's dist/ folder for serve.ts, or null when the
// path names none (serve.ts then answers with index.html or a 404).
import { existsSync, statSync } from 'node:fs'
import { join, normalize } from 'node:path'

export function staticFile(dist: string, pathname: string): Response | null {
  // A stray % (`/shared-data/100%`) isn't a file: index.html answers, and the router keeps it as typed.
  let rel: string
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^\/+/, '')
  } catch {
    return null
  }
  if (rel.startsWith('..')) return null
  const path = join(dist, rel)
  if (!rel || !existsSync(path) || !statSync(path).isFile()) return null
  const immutable = rel.startsWith('assets/')
  return new Response(Bun.file(path), {
    headers: { 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' }
  })
}

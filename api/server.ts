// The hosted miso API on Vercel: one Bun function behind every /api/* path
// (see the rewrite in vercel.json). `bun run build` generates
// api/_generated/ — the API plus every space's server functions — before
// Vercel packages this file.
import { join } from 'node:path'
import { createMisoApp } from './_generated/server-entry.js'

// Workspace media for /api/files: the copy the build put next to the function (vercel.json's
// includeFiles ships api/_generated/**), since a deployment has no spaces checkout.
const app = createMisoApp(join(import.meta.dir, '_generated', 'files'))

Bun.serve({
  fetch(request) {
    // Rewritten requests arrive as /api/server?__miso_path=<rest>; restore the
    // original path so the API's own routes match.
    const url = new URL(request.url)
    const rest = url.searchParams.get('__miso_path')
    if (url.pathname === '/api/server' && rest !== null) {
      url.searchParams.delete('__miso_path')
      url.pathname = `/api/${rest}`
      return app.fetch(new Request(url, request))
    }
    return app.fetch(request)
  }
})

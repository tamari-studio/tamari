// A space's media file opened at its own address: an .svg with a script must not run as the app.
import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiddlewareHandler } from 'hono'

import type { Catalog } from '../lib/types'
import { createApp } from './app'
import type { AuthEnv } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'

const root = mkdtempSync(join(tmpdir(), 'files-route-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
mkdirSync(join(root, 'workspaces', 'acme', 'media'), { recursive: true })
writeFileSync(join(root, 'workspaces', 'acme', 'media', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.cookie)</script></svg>')

const catalog: Catalog = { spaces: [{ id: 'acme', slug: 'acme', folder: 'acme', previousSlugs: [], position: 0, name: 'Acme', theme: {} }], applets: [] }
const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
  c.set('user', { id: 'u', email: 'u@example.com', name: null, avatarUrl: null, tier: 'member', status: 'active', token: 't' })
  await next()
}
const app = createApp({ catalog, modules: {}, commit: null, builtAt: '', root, requireUser: signedIn, spaceAccessStore: () => memorySpaceAccessStore() })

test('a served .svg runs no script as the app: sandboxed, no scripts, type as sent', async () => {
  const res = await app.request('/api/files/acme/media/logo.svg')
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('image/svg+xml')
  const csp = res.headers.get('content-security-policy') ?? ''
  expect(csp).toContain('sandbox')
  expect(csp).toContain("default-src 'none'")
  expect(csp).not.toContain('script-src')
  expect(res.headers.get('x-content-type-options')).toBe('nosniff')
})

test("a space's code under .miso/ is never served as a file", async () => {
  mkdirSync(join(root, 'workspaces', 'acme', '.miso', 'views'), { recursive: true })
  writeFileSync(join(root, 'workspaces', 'acme', '.miso', 'views', 'x.svg'), '<svg/>')
  expect((await app.request('/api/files/acme/.miso/views/x.svg')).status).toBe(404)
})

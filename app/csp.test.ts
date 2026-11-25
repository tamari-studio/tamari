import { expect, test } from 'bun:test'
import vercel from '../vercel.json'

test('Vercel serves every page with a Content-Security-Policy that allows only its own scripts and no framing', () => {
  const headers = vercel.headers.find(h => h.source === '/(.*)')!.headers
  const csp = headers.find(h => h.key === 'Content-Security-Policy')!.value
  expect(csp).toContain("script-src 'self'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).not.toContain('unsafe-eval')
})

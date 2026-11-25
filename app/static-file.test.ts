import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { staticFile } from './static-file'

const dist = mkdtempSync(join(tmpdir(), 'static-file-'))
mkdirSync(join(dist, 'assets'))
writeFileSync(join(dist, 'assets', 'main-abc.js'), 'export {}\n')
afterAll(() => rmSync(dist, { recursive: true, force: true }))

test('a build file is served, and cached for good under assets/', () => {
  expect(staticFile(dist, '/assets/main-abc.js')?.headers.get('Cache-Control')).toContain('immutable')
  expect(staticFile(dist, '/assets/gone.js')).toBeNull()
  expect(staticFile(dist, '/../etc/passwd')).toBeNull()
})

test('a stray % is no file, not a thrown URIError (index.html answers, and the router keeps it)', () => {
  expect(staticFile(dist, '/shared-data/100%')).toBeNull()
})

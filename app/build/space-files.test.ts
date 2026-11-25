import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serverFiles } from './space-files'

const root = mkdtempSync(join(tmpdir(), 'space-files-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function put(rel: string) {
  const path = join(root, 'workspaces', 'ops', '.miso', rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, 'export async function f() {}\n')
}

test('server files in a folder named data ship; installs, dot-folders and tests do not', () => {
  put('lib/data/rows.server.ts')
  put('data/top.server.ts')
  put('lib/items.server.ts')
  put('lib/items.server.test.ts')
  put('node_modules/pkg/x.server.ts')
  put('lib/.cache/y.server.ts')
  expect(serverFiles(root, 'ops').map(f => f.key).sort()).toEqual(['ops/data/top', 'ops/lib/data/rows', 'ops/lib/items'])
})

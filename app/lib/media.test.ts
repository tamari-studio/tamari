import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mediaFiles } from './media'

const dir = mkdtempSync(join(tmpdir(), 'media-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('lists the media /api/files serves, and nothing it refuses', () => {
  for (const file of ['logo.png', 'docs/brief.pdf', 'docs/notes.md', '.shots/deck.png', '.miso/views/a.png', 'node_modules/x/y.png']) {
    mkdirSync(join(dir, file, '..'), { recursive: true })
    writeFileSync(join(dir, file), '')
  }
  expect(mediaFiles(dir).sort()).toEqual(['docs/brief.pdf', 'logo.png'])
})

test('a missing folder has no media', () => {
  expect(mediaFiles(join(dir, 'nope'))).toEqual([])
})

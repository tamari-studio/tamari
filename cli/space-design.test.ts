// The design rules a machine can check (docs/space-design.md, app/lib/space-design.ts), over the
// spaces this repo ships. The MCP write tools run the same checks on every file they take.
// Only the shipped folders: an org's own spaces may be linked into workspaces/.
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { usesOtherIcons, widgetScrolls } from '../app/lib/space-design'

const ROOT = join(import.meta.dir, '..')
const SPACES = [
  ...['factory', 'miso', 'vault'].map(s => `workspaces/${s}`),
  ...readdirSync(join(ROOT, 'template/spaces')).map(s => `template/spaces/${s}`)
]

function tsx(dir: string): string[] {
  try {
    return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
      .filter(f => f.endsWith('.tsx') && !f.includes('node_modules'))
      .map(f => join(dir, f))
  } catch {
    return []
  }
}

const files = SPACES.flatMap(s => ['views', 'widgets', 'ui'].flatMap(d => tsx(`${s}/.miso/${d}`)))
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

test('finds the shipped spaces', () => {
  expect(files.some(f => f.includes('/widgets/'))).toBe(true)
})

test('icons come from Tabler only', () => {
  expect(files.filter(f => usesOtherIcons(f, read(f)))).toEqual([])
})

test('widgets never scroll', () => {
  expect(files.filter(f => widgetScrolls(f, read(f)))).toEqual([])
})

import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractConfig, scanCatalog } from './catalog'
import { APP_ROOT } from './roots'

test('extractConfig reads view and widget configs', () => {
  expect(extractConfig(`export const config = { title: 'Data', icon: 'database', requiredEnv: ['A'] } as const`)).toEqual({
    title: 'Data',
    icon: 'database',
    requiredEnv: ['A']
  })
  expect(extractConfig(`export const config: WidgetConfig = {\n  rowSpan: 2,\n  colSpan: 4, // wide\n}`)).toEqual({ rowSpan: 2, colSpan: 4 })
  expect(extractConfig(`export const config = { title: 'Brace } inside' } satisfies ViewConfig`)).toEqual({ title: 'Brace } inside' })
  expect(extractConfig(`export default function X() {}`)).toEqual({})
})

test('the repo catalog has every space in spaces.json and no helper files', () => {
  const catalog = scanCatalog(APP_ROOT)
  expect(catalog.spaces.length).toBeGreaterThan(0)
  expect(catalog.applets.some(a => a.name.startsWith('_'))).toBe(false)
  for (const applet of catalog.applets) expect(applet.ref).toBe(`${applet.folder}/${applet.name}`)
})

function rootWithView(source: string): string {
  const root = mkdtempSync(join(tmpdir(), 'catalog-'))
  writeFileSync(join(root, 'spaces.json'), JSON.stringify({ spaces: [{ folder: 'health', id: 'h', slug: 'health' }] }))
  mkdirSync(join(root, 'workspaces/health/.miso/views'), { recursive: true })
  writeFileSync(join(root, 'workspaces/health/.miso/views/feedback.tsx'), source)
  return root
}

test('a view can set its own minTier, and a typo in it fails the build', () => {
  const ok = rootWithView(`export const config = { title: 'Feedback', minTier: 'admin' } as const\nexport default function F() {}`)
  const bad = rootWithView(`export const config = { minTier: 'admins' } as const\nexport default function F() {}`)
  try {
    expect(scanCatalog(ok).applets[0]!.minTier).toBe('admin')
    expect(() => scanCatalog(bad)).toThrow(/isn't a tier/)
  } finally {
    rmSync(ok, { recursive: true, force: true })
    rmSync(bad, { recursive: true, force: true })
  }
})

test('a space takes its name and icon from .workspace.json', () => {
  const root = rootWithView('export default function Feedback() { return null }')
  writeFileSync(join(root, 'workspaces/health/.miso/.workspace.json'), JSON.stringify({ name: 'Health', icon: 'data:image/webp;base64,AA' }))
  const [space] = scanCatalog(root).spaces
  expect(space).toMatchObject({ name: 'Health', icon: 'data:image/webp;base64,AA' })
})

test("extractConfig reads the literal and never runs a config's code", () => {
  let ran = false
  ;(globalThis as Record<string, unknown>).__configRan = () => (ran = true)
  expect(extractConfig(`export const config = { title: (() => { globalThis.__configRan(); return 'x' })() }`)).toEqual({})
  expect(extractConfig(`export const config = { title: \`a\${globalThis.__configRan()}\` }`)).toEqual({})
  expect(extractConfig(`export const config = { ...globalThis.__configRan() }`)).toEqual({})
  expect(ran).toBe(false)
  expect(extractConfig(`export const config = { colSpan: -1, wide: true, none: null, 'quoted key': ['a', \`b\`] } as const`)).toEqual({
    colSpan: -1,
    wide: true,
    none: null,
    'quoted key': ['a', 'b']
  })
})

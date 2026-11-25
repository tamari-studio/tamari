// rootResolverPlugin against small fixture packages, built the way app/build.ts builds:
// the client as a browser bundle, the server for bun.
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appletRuntimePlugin, browserEntry, rootResolverPlugin, tablerModule, tablerNames } from './plugins'

const dirs: string[] = []
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

// A folder with an entry file and a node_modules holding the given packages
// ({ name: { 'file': contents } }), standing in for a space's own install.
function fixture(entry: string, packages: Record<string, Record<string, string>> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'plugins-test-'))
  dirs.push(dir)
  for (const [name, files] of Object.entries(packages)) {
    for (const [file, contents] of Object.entries(files)) {
      const path = join(dir, 'node_modules', name, file)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, contents)
    }
  }
  writeFileSync(join(dir, 'entry.ts'), entry)
  return join(dir, 'entry.ts')
}

async function build(entry: string, target: 'browser' | 'bun') {
  const result = await Bun.build({
    entrypoints: [entry],
    target,
    format: 'esm',
    plugins: [rootResolverPlugin({ target })],
    throw: false
  })
  const text = (await Promise.all(result.outputs.map(o => o.text()))).join('\n')
  return { ok: result.success, logs: result.logs.map(l => l.message).join('\n'), text }
}

// fflate ships exactly this split: a Node build that imports `module` and
// worker_threads under the "node" condition, a browser build under "browser".
const SPLIT_PACKAGE = {
  'package.json': JSON.stringify({
    name: 'split-build',
    type: 'module',
    exports: { '.': { node: './node.js', browser: './browser.js', default: './browser.js' } }
  }),
  'node.js': `import { createRequire } from 'module'\nexport const flavour = 'NODE_BUILD' + typeof createRequire\n`,
  'browser.js': `export const flavour = 'BROWSER_BUILD'\n`
}

describe('rootResolverPlugin', () => {
  test("a browser build gets a space package's browser entry, not its Node build", async () => {
    const entry = fixture(`import { flavour } from 'split-build'\nconsole.log(flavour)\n`, { 'split-build': SPLIT_PACKAGE })
    const { ok, logs, text } = await build(entry, 'browser')
    expect(logs).toBe('')
    expect(ok).toBe(true)
    expect(text).toContain('BROWSER_BUILD')
    expect(text).not.toContain('NODE_BUILD')
  })

  // Bun 1.3 drops such an import without an error when a resolver plugin was asked about it and
  // had no answer: the build passes and the import is undefined in the browser. react-markdown
  // and diff are packages like this.
  test("a browser build keeps a space package marked sideEffects: false", async () => {
    const entry = fixture(`import { render } from 'pure-lib'\nconsole.log(render)\n`, {
      'pure-lib': {
        'package.json': JSON.stringify({ name: 'pure-lib', type: 'module', sideEffects: false, exports: './index.js' }),
        'index.js': `export { render } from 'pure-dep'\n`
      },
      'pure-dep': {
        'package.json': JSON.stringify({ name: 'pure-dep', type: 'module', sideEffects: false, exports: './index.js' }),
        'index.js': `export const render = () => 'PURE_LIB_CODE'\n`
      }
    })
    const { ok, logs, text } = await build(entry, 'browser')
    expect(logs).toBe('')
    expect(ok).toBe(true)
    expect(text).toContain('PURE_LIB_CODE')
  })

  test('a Node built-in in a browser build is reported by the bundler, not handed back as a file path', async () => {
    const entry = fixture(`import { createRequire } from 'module'\nconsole.log(typeof createRequire)\n`)
    const { ok, logs } = await build(entry, 'browser')
    expect(ok).toBe(false)
    expect(logs).not.toContain('must be absolute')
    expect(logs).toContain('module')
  })

  // Unchanged behaviour the fix must keep: the server build resolves from the importer.
  test('a server build still takes a package from the importer when the root lacks it', async () => {
    const entry = fixture(`import { flavour } from 'split-build'\nconsole.log(flavour)\n`, { 'split-build': SPLIT_PACKAGE })
    const { ok, text } = await build(entry, 'bun')
    expect(ok).toBe(true)
    expect(text).toContain('NODE_BUILD')
  })

  test("a space's own copy of react never replaces the root's", async () => {
    const entry = fixture(`import { version } from 'react'\nconsole.log(version)\n`, {
      react: {
        'package.json': JSON.stringify({ name: 'react', version: '0.0.0', main: 'index.js' }),
        'index.js': `exports.version = 'SPACE_COPY_OF_REACT'\n`
      }
    })
    for (const target of ['browser', 'bun'] as const) {
      const { ok, text } = await build(entry, target)
      expect(ok).toBe(true)
      expect(text).not.toContain('SPACE_COPY_OF_REACT')
    }
  })

  // A bare require left in the bundle makes Bun auto-install the package at runtime, which kills
  // the Vercel function on its read-only filesystem (EROFS) even inside try/catch.
  test('a package no install provides becomes a module that throws, never a bare require', async () => {
    const entry = fixture(
      `let used = 'package'\ntry { require('not-installed-anywhere-xyz') } catch { used = 'fallback' }\nexport { used }\n`
    )
    const unresolved: string[] = []
    const result = await Bun.build({
      entrypoints: [entry],
      target: 'bun',
      format: 'esm',
      plugins: [rootResolverPlugin({ target: 'bun', onUnresolved: spec => unresolved.push(spec) })],
      throw: false
    })
    expect(result.success).toBe(true)
    expect(unresolved).toEqual(['not-installed-anywhere-xyz'])
    const text = (await Promise.all(result.outputs.map(o => o.text()))).join('\n')
    expect(text).not.toMatch(/require\(\s*["']not-installed-anywhere-xyz["']\s*\)/)
    expect(text).toContain('not-installed-anywhere-xyz is not installed in the hosted app')
    // Run in its own process: an import of the output in this one fails after a plugin build.
    const out = join(entry, '..', 'out.mjs')
    writeFileSync(out, `${text}\nconsole.log(used)\n`)
    const run = Bun.spawnSync(['bun', out], { cwd: join(entry, '..') })
    expect(run.stdout.toString().trim()).toBe('fallback')
  })
})

describe('browserEntry', () => {
  // @tabler/icons-react's shape: main is CommonJS (what Bun.resolveSync picks), module is ESM.
  test('takes the ESM build over the CommonJS main a node resolve picks', () => {
    const entry = fixture('', {
      icons: {
        'package.json': JSON.stringify({ name: 'icons', main: './cjs/index.cjs', module: './esm/index.mjs' }),
        'cjs/index.cjs': 'module.exports = {}\n',
        'esm/index.mjs': 'export {}\n'
      }
    })
    const dir = join(entry, '..', 'node_modules', 'icons')
    expect(browserEntry('icons', join(dir, 'cjs', 'index.cjs'))).toBe(join(dir, 'esm', 'index.mjs'))
  })

  test('follows the browser and import conditions of an exports map, subpaths and patterns too', () => {
    const entry = fixture('', {
      '@s/charts': {
        'package.json': JSON.stringify({
          name: '@s/charts',
          exports: {
            '.': { types: './a.d.ts', require: './lib/index.js', import: './es6/index.js' },
            './parts/*': { require: './lib/*.js', browser: './es6/*.js' }
          }
        }),
        'lib/index.js': '',
        'es6/index.js': '',
        'lib/line.js': '',
        'es6/line.js': ''
      }
    })
    const dir = join(entry, '..', 'node_modules', '@s', 'charts')
    expect(browserEntry('@s/charts', join(dir, 'lib', 'index.js'))).toBe(join(dir, 'es6', 'index.js'))
    expect(browserEntry('@s/charts/parts/line', join(dir, 'lib', 'line.js'))).toBe(join(dir, 'es6', 'line.js'))
  })

  test('keeps the resolved file when the package names nothing more specific', () => {
    const entry = fixture('', { plain: { 'package.json': JSON.stringify({ name: 'plain', main: './index.js' }), 'index.js': '' } })
    const file = join(entry, '..', 'node_modules', 'plain', 'index.js')
    expect(browserEntry('plain', file)).toBe(file)
  })
})

describe('tablerNames and tablerModule', () => {
  test('collects named imports, skips types, and gives up on a namespace import', () => {
    const a = fixture(`import { IconFile, IconUser as Person, type TablerIcon } from '@tabler/icons-react'\n`)
    const b = fixture(`import type { Icon } from '@tabler/icons-react'\nimport {\n  IconMail,\n} from "@tabler/icons-react"\n`)
    expect([...tablerNames([a, b])!].sort()).toEqual(['IconFile', 'IconMail', 'IconUser'])
    const star = fixture(`import * as Icons from '@tabler/icons-react'\n`)
    expect(tablerNames([a, star])).toBeNull()
  })

  test('re-exports each icon from its own file, aliases included, and the rest from the barrel', () => {
    const entry = fixture('', {
      tabler: {
        'tabler-icons-react.mjs': [
          "export { default as Icon123, default as IconNumber123 } from './icons/IconNumber123.mjs';",
          "export { default as IconFile } from './icons/IconFile.mjs';",
          "export { default as createReactComponent } from './createReactComponent.mjs';"
        ].join('\n')
      }
    })
    const dir = join(entry, '..', 'node_modules', 'tabler')
    const text = tablerModule(new Set(['Icon123', 'IconFile', 'useSomething']), dir)
    expect(text).toContain(`export { default as Icon123 } from ${JSON.stringify(join(dir, 'icons/IconNumber123.mjs'))}`)
    expect(text).toContain(`export { default as IconFile } from ${JSON.stringify(join(dir, 'icons/IconFile.mjs'))}`)
    expect(text).toContain(`export { useSomething } from ${JSON.stringify(join(dir, 'tabler-icons-react.mjs'))}`)
    expect(text).not.toContain('IconNumber123 }')
  })
})

describe('appletRuntimePlugin', () => {
  // Server code next to the entry, imported in ways the RPC stub doesn't rewrite.
  for (const [label, specifier] of [
    ['a .server.js import', './lib/secret.server.js'],
    ['an absolute .server.ts import', '<abs>']
  ] as const) {
    test(`${label} never puts server code in a browser bundle`, async () => {
      const entry = fixture('')
      const server = join(entry, '..', 'lib', 'secret.server.ts')
      mkdirSync(join(server, '..'), { recursive: true })
      writeFileSync(server, `export async function token() { return 'SERVER_ONLY_SECRET' }\n`)
      writeFileSync(entry, `import { token } from ${JSON.stringify(specifier === '<abs>' ? server : specifier)}\nconsole.log(token)\n`)
      const result = await Bun.build({ entrypoints: [entry], target: 'browser', format: 'esm', plugins: [appletRuntimePlugin()], throw: false })
      const text = (await Promise.all(result.outputs.map(o => o.text()))).join('\n')
      expect(text).not.toContain('SERVER_ONLY_SECRET')
      expect(result.success).toBe(false)
    })
  }
})

import { afterAll, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkTree, escapingTarget, lockProblems, packageDeps, packageJsonProblems, packagesHome, syncSpacePackages, type Deps, type Installer } from './space-packages'

const root = mkdtempSync(join(tmpdir(), 'space-packages-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const deps = (d: Record<string, unknown>) => packageJsonProblems(json({ dependencies: d }))

test('package.json: registry names and versions only', () => {
  expect(packageJsonProblems(json({ name: 'acme', private: true, dependencies: { 'date-fns': '4.1.0', '@scope/x-y.z': '1.2.3', a: '1.0.0-beta.1' } }))).toEqual([])
  expect(packageDeps(json({ dependencies: { 'date-fns': '4.1.0' } }))).toEqual({ 'date-fns': '4.1.0' })
  expect(packageDeps(json({ name: 'x' }))).toEqual({})
  for (const spec of ['^1.2.3', '~1.2.3', 'file:../x', 'link:x', 'workspace:*', 'portal:../x', 'npm:other@1.0.0', 'git+https://github.com/a/b.git', 'github:a/b', 'a/b', 'https://x.test/a.tgz', './x.tgz', 'latest', '*', '>=1.0.0', '1.x', '1.0.0 || 2.0.0', '^1.0', ' 1.0.0', '1.0.0\n']) {
    expect(deps({ x: spec }).join(' ')).toContain('exact versions from the npm registry')
  }
  expect(deps({ x: 'file:../x' }).join(' ')).toContain('a file: version')
  expect(deps({ x: 'github:a/b' }).join(' ')).toContain('git, GitHub or web address')
  for (const name of ['../x', 'X', '.x', '_x', '@a/../b', 'a b', '@scope', 'a/b', '']) expect(deps({ [name]: '1.0.0' }).join(' ')).toContain("isn't a package name")
  expect(deps({ miso: '1.0.0' }).join(' ')).toContain('part of the app')
  expect(deps({ x: 1 }).join(' ')).toContain('not text')
  expect(deps(Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`p${i}`, '1.0.0']))).join(' ')).toContain('at most 30')
})

test('package.json: only name, version, private, description and dependencies', () => {
  for (const key of ['scripts', 'overrides', 'resolutions', 'trustedDependencies', 'patchedDependencies', 'bin', 'browser', 'imports', 'exports', 'main', 'type', 'workspaces', 'peerDependencies', 'optionalDependencies', 'bundleDependencies', 'catalog']) {
    expect(packageJsonProblems(json({ [key]: {} })).join(' ')).toContain(`"${key}" isn't allowed`)
  }
  expect(packageJsonProblems(json({ devDependencies: { x: '1.0.0' } })).join(' ')).toContain('no devDependencies')
  expect(packageJsonProblems(json({ private: 'yes' })).join(' ')).toContain('true or false')
  expect(packageJsonProblems('[]')).toEqual(['package.json is one JSON object.'])
  expect(packageJsonProblems('{')).toEqual(["package.json isn't JSON."])
  // One way to write it: a key twice (JSON.parse keeps the last) or another layout is refused.
  expect(packageJsonProblems('{\n  "dependencies": {\n    "x": "file:../x",\n    "x": "1.0.0"\n  }\n}').join(' ')).toContain('JSON.stringify')
  expect(packageJsonProblems('{"dependencies":{"x":"1.0.0"}}').join(' ')).toContain('JSON.stringify')
  expect(() => packageDeps(json({ scripts: { postinstall: 'x' } }))).toThrow('"scripts"')
})

const lock = (packages: Record<string, unknown>, extra: Record<string, unknown> = {}, d: Deps = { a: '^1.0.0' }) =>
  JSON.stringify({ lockfileVersion: 1, configVersion: 1, workspaces: { '': { name: 'tamari-space-packages', dependencies: d } }, trustedDependencies: [], packages, ...extra })
const SHA = 'sha512-+1UMbeh68lH1SegH83CGWwpb6OHHbpSgr3+s5Eww5M4CAgswBpoWS0AjTOfEJ33HiYKz1hdj/KTFprzXHmq/6w=='

test('the lockfile: registry packages only', () => {
  expect(lockProblems(lock({ a: ['a@1.2.0', '', { dependencies: { b: '1' } }, SHA], b: ['b@1.0.0', '', {}, SHA], 'a/b': ['b@2.0.0', '', {}, SHA] }), { a: '^1.0.0' })).toEqual([])
  // bun's own format has trailing commas.
  expect(lockProblems(`{"lockfileVersion":1,"workspaces":{"":{"dependencies":{"a":"^1.0.0",},},},"packages":{"a":["a@1.0.0","",{},"${SHA}"],},}`, { a: '^1.0.0' })).toEqual([])
  const bad: unknown[][] = [
    ['a@git+https://github.com/a/a.git#abc', '', {}, SHA],
    ['a@github:a/a#abc', { }, 'a-abc'],
    ['a@https://x.test/a.tgz', '', {}, SHA],
    ['a@file:../a', {}],
    ['a@link:a', {}],
    ['a@1.0.0', 'https://evil.test/', {}, SHA],
    ['a@1.0.0', '', {}, 'sha1-abc'],
    ['b@1.0.0', '', {}, SHA]
  ]
  for (const entry of bad) expect(lockProblems(lock({ a: entry }), { a: '^1.0.0' }).join(' ')).toContain("doesn't come from the npm registry")
  expect(lockProblems(lock({}, { trustedDependencies: ['a'] }), { a: '^1.0.0' }).join(' ')).toContain('trusts packages')
  for (const key of ['overrides', 'patchedDependencies', 'catalog']) expect(lockProblems(lock({}, { [key]: {} }), { a: '^1.0.0' }).join(' ')).toContain(`"${key}"`)
  expect(lockProblems(lock({}), { a: '^2.0.0' }).join(' ')).toContain("not the space's")
  expect(lockProblems('nope', {})).toEqual(["the lockfile bun wrote can't be read."])
})

test("package.json paths that leave the space's packages", () => {
  const nmRoot = '/v/acme/.miso/node_modules'
  const pkgDir = `${nmRoot}/pkg/sub`
  for (const ok of ['./index.js', 'index.js', 'lib/x.js', 'node:fs', 'events', '../cjs/x.js']) expect(escapingTarget(ok, pkgDir, nmRoot)).toBe(false)
  for (const bad of ['/proc/self/environ', '../../../x.js', './a/../../../../b', 'file:///etc/passwd', 'C:\\x', '~/x', '\\\\server\\x']) expect(escapingTarget(bad, pkgDir, nmRoot)).toBe(true)
})

function tree(dir: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
}

test('an installed tree: .bin and config files go; links and escaping paths are refused', () => {
  const nm = join(root, 'tree-ok')
  tree(nm, { 'a/style.css': '@media (min-width: 1px) { .a { background: url(./i.png) } }', 'a/package.json': json({ name: 'a', main: './index.js', exports: { '.': { import: './index.mjs' } }, browser: { './x.js': false, fs: false } }), 'a/sub/package.json': json({ main: '../cjs/sub.js' }), 'a/index.js': '', 'a/tsconfig.json': '{}', '.bin/a': '', 'a/bunfig.toml': '' })
  expect(checkTree(nm)).toEqual([])
  expect(existsSync(join(nm, '.bin'))).toBe(false)
  expect(existsSync(join(nm, 'a', 'tsconfig.json'))).toBe(false)
  expect(existsSync(join(nm, 'a', 'bunfig.toml'))).toBe(false)

  const bad = join(root, 'tree-bad')
  tree(bad, {
    'a/package.json': json({ name: 'a', browser: { './x.js': '/proc/self/environ' } }),
    'b/package.json': json({ name: 'b', exports: { '.': '../../../../app/.env' } }),
    'e/sub/package.json': json({ main: '../../../views/home.tsx' }),
    'c/package.json': json({ name: 'c', main: '/etc/passwd' }),
    'd/package.json': json({ name: 'd', imports: { '#x': 'file:///etc/passwd' } }),
    'f/package.json': json({ name: 'f', browser: { './x.js': 'f/../../../../x' } }),
    'g/b.css': '@plugin "./p.js";'
  })
  symlinkSync('/etc/hosts', join(bad, 'hosts'))
  const problems = checkTree(bad).join('\n')
  for (const word of ['a/package.json', 'b/package.json', 'c/package.json', 'd/package.json', 'e/sub/package.json', 'f/package.json', 'node_modules/g/b.css: @plugin', 'node_modules/hosts is a link']) expect(problems).toContain(word)
})

let dir = ''
let n = 0
beforeEach(() => {
  dir = join(root, `v${n++}`)
  mkdirSync(join(dir, '.git'), { recursive: true })
})

const spaces = (list: object[]) => writeFileSync(join(dir, 'spaces.json'), JSON.stringify({ spaces: list }))
const pkg = (folder: string, d: Deps) => tree(join(dir, folder, '.miso'), { 'package.json': json({ dependencies: d }), 'views/home.tsx': '' })
const nm = (folder: string) => join(dir, folder, '.miso', 'node_modules')

// Stands in for bun: what a registry install leaves, and a count of the calls.
let installs: Deps[] = []
let locks: (string | undefined)[] = []
const fake = (overrides: { lock?: (d: Deps) => string; files?: Record<string, string>; fail?: boolean } = {}): Installer => async (stage, d, kept) => {
  installs.push(d)
  locks.push(kept)
  if (overrides.fail) throw new Error('bun install failed:\nerror: 404 no such package')
  const packages = Object.fromEntries(Object.keys(d).map(name => [name, [`${name}@1.0.0`, '', {}, SHA]]))
  writeFileSync(join(stage, 'bun.lock'), overrides.lock ? overrides.lock(d) : JSON.stringify({ lockfileVersion: 1, workspaces: { '': { dependencies: d } }, packages }))
  for (const name of Object.keys(d)) tree(join(stage, 'node_modules', name), { 'package.json': json({ name, version: '1.0.0', main: './index.js' }), 'index.js': `export const v = ${JSON.stringify(d[name])}` })
  tree(join(stage, 'node_modules'), overrides.files ?? {})
}
const appHas = (name: string) => name === 'react'
const sync = (install: Installer = fake()) => syncSpacePackages(dir, { install, appHas })

test('a live space gets its packages; unchanged, nothing runs again', async () => {
  installs = []
  spaces([{ folder: 'acme' }, { folder: 'plain' }])
  pkg('acme', { 'date-fns': '4.1.0' })
  tree(join(dir, 'plain', '.miso'), { 'views/home.tsx': '' })
  expect(await sync()).toEqual({ ok: true, changed: ['acme'] })
  expect(readFileSync(join(nm('acme'), 'date-fns', 'index.js'), 'utf8')).toContain('4.1.0')
  expect(existsSync(nm('plain'))).toBe(false)
  expect(await sync()).toEqual({ ok: true, changed: [] })
  expect(installs).toHaveLength(1)
  // Nothing is left half-made in .git/.
  expect(Bun.spawnSync(['ls', join(packagesHome(dir), 'stage')]).stdout.toString()).toBe('')
})

test('a failed install keeps the old packages; a put-back takes the previous install back without bun', async () => {
  installs = []
  spaces([{ folder: 'acme' }])
  pkg('acme', { a: '1.0.0' })
  await sync()
  pkg('acme', { a: '1.0.0', b: '1.0.0' })
  const failed = await sync(fake({ fail: true }))
  expect(failed.ok).toBe(false)
  expect(failed.ok ? '' : failed.errors).toContain('404 no such package')
  expect(existsSync(join(nm('acme'), 'a'))).toBe(true)
  expect(existsSync(join(nm('acme'), 'b'))).toBe(false)
  // It installs, then the build fails and the change is put back: the old install returns.
  expect((await sync()).ok).toBe(true)
  expect(existsSync(join(nm('acme'), 'b'))).toBe(true)
  pkg('acme', { a: '1.0.0' })
  installs = []
  expect(await sync()).toEqual({ ok: true, changed: ['acme'] })
  expect(installs).toEqual([])
  expect(existsSync(join(nm('acme'), 'b'))).toBe(false)
})

test("what isn't from the registry, or makes a link, is refused and never put in place", async () => {
  spaces([{ folder: 'acme' }])
  pkg('acme', { a: '1.0.0' })
  const git = await sync(fake({ lock: d => lock({ a: ['a@github:evil/a#1', {}, 'evil-a-1'] }, {}, d) }))
  expect(git.ok ? '' : git.errors).toContain("doesn't come from the npm registry")
  expect(existsSync(nm('acme'))).toBe(false)
  const escaping = await sync(fake({ files: { 'evil/package.json': json({ name: 'evil', main: '../../../../.env' }) } }))
  expect(escaping.ok ? '' : escaping.errors).toContain("points outside the space's packages")
  expect(existsSync(nm('acme'))).toBe(false)
})

test("a space's package.json that breaks the rules, or a package manager's settings, fail the build", async () => {
  spaces([{ folder: 'acme' }])
  tree(join(dir, 'acme', '.miso'), { 'package.json': json({ dependencies: { a: '1.0.0' }, scripts: { postinstall: 'curl evil' } }) })
  const scripts = await sync()
  expect(scripts.ok ? '' : scripts.errors).toContain('"scripts" isn\'t allowed')
  pkg('acme', { a: '1.0.0' })
  for (const name of ['.npmrc', 'bunfig.toml', '.yarnrc.yml']) {
    for (const where of [join(dir, 'acme', '.miso', name), join(dir, 'acme', name)]) {
      writeFileSync(where, 'registry=https://evil.test/')
      const result = await sync()
      expect(result.ok ? '' : result.errors).toContain(`${name} is a package manager's settings`)
      rmSync(where)
    }
  }
  expect((await sync()).ok).toBe(true)
})

test('the same dependencies again install from the lockfile kept the first time', async () => {
  spaces([{ folder: 'acme' }])
  pkg('acme', { a: '1.0.0' })
  locks = []
  await sync()
  rmSync(nm('acme'), { recursive: true })
  rmSync(join(packagesHome(dir), 'previous'), { recursive: true, force: true })
  await sync()
  expect(locks[0]).toBeUndefined()
  expect(locks[1]).toContain('"a@1.0.0"')
})

test('a node_modules the app never made is replaced; removing package.json removes the packages', async () => {
  spaces([{ folder: 'acme' }])
  pkg('acme', { a: '1.0.0' })
  tree(nm('acme'), { 'evil/index.js': 'planted' })
  await sync()
  expect(existsSync(join(nm('acme'), 'evil'))).toBe(false)
  rmSync(join(dir, 'acme', '.miso', 'package.json'))
  expect(await sync()).toEqual({ ok: true, changed: ['acme'] })
  expect(existsSync(nm('acme'))).toBe(false)
})

test("drafts: nothing installed; a copy gets its live space's packages, and stand-ins for what it adds", async () => {
  installs = []
  spaces([
    { folder: 'acme' },
    { folder: 'acme--draft-abc123', draft: true, draftOf: 'acme' },
    { folder: 'mine', draft: true },
    { folder: 'empty', draft: true }
  ])
  pkg('acme', { a: '1.0.0' })
  pkg('acme--draft-abc123', { a: '1.0.0', b: '2.0.0', react: '19.0.0' })
  pkg('mine', { c: '1.0.0' })
  tree(join(dir, 'empty', '.miso'), { 'views/home.tsx': '' })
  tree(nm('empty'), { 'planted/index.js': '' })
  expect((await sync()).ok).toBe(true)
  // Only the live space ran bun, and its own stamp is still its own (the copy's tree is hard links).
  expect(installs).toEqual([{ a: '1.0.0' }])
  expect(readFileSync(join(nm('acme'), '.tamari-packages'), 'utf8')).toStartWith('i:')
  expect(readFileSync(join(nm('acme--draft-abc123'), '.tamari-packages'), 'utf8')).toStartWith('d:')
  expect(readFileSync(join(nm('acme--draft-abc123'), 'a', 'index.js'), 'utf8')).toContain('1.0.0')
  expect(readFileSync(join(nm('acme--draft-abc123'), 'b', 'index.cjs'), 'utf8')).toContain('installed once an admin approves this draft')
  // A package the app has needs no stand-in.
  expect(existsSync(join(nm('acme--draft-abc123'), 'react'))).toBe(false)
  expect(readFileSync(join(nm('mine'), 'c', 'index.cjs'), 'utf8')).toContain('throw new Error')
  expect(existsSync(nm('empty'))).toBe(false)
  // The live space's packages change: the copy follows.
  pkg('acme', { a: '1.0.0', b: '2.0.0' })
  await sync()
  expect(readFileSync(join(nm('acme--draft-abc123'), 'b', 'index.js'), 'utf8')).toContain('2.0.0')
})

test("Tamari's own spaces keep the packages their image came with", async () => {
  installs = []
  spaces([{ folder: 'miso' }])
  pkg('miso', { cn: '0.2.6' })
  tree(nm('miso'), { 'cn/package.json': json({ name: 'cn' }), 'cn/index.js': 'from the image' })
  expect(await syncSpacePackages(dir, { install: fake(), appHas, shipped: ['miso'] })).toEqual({ ok: true, changed: [] })
  expect(installs).toEqual([])
  expect(readFileSync(join(nm('miso'), 'cn', 'index.js'), 'utf8')).toBe('from the image')
})

test('a draft whose package.json breaks the rules fails the build', async () => {
  spaces([{ folder: 'mine', draft: true }])
  tree(join(dir, 'mine', '.miso'), { 'package.json': json({ dependencies: { x: 'file:/etc' } }) })
  const result = await sync()
  expect(result.ok ? '' : result.errors).toContain('mine/.miso/package.json')
})

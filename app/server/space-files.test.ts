import { afterAll, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { APP_NAME } from '../lib/brand'
import type { BuildStatus } from './build-status'
import {
  applyFiles,
  authorLine,
  checkChange,
  checkPath,
  checkSummary,
  FileRefusal,
  listFiles,
  planSpace,
  readFile,
  checkDraftCap,
  removeSpace,
  runChange,
  spaceEntry,
  spaceFiles,
  spaceFolder,
  spaceTrackedFiles,
  withLock,
  writeSpace
} from './space-files'
import { commit, initRepo } from './spaces-volume'

const root = mkdtempSync(join(tmpdir(), 'space-files-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let dir = ''
let n = 0

function put(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
const git = (...args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir }).stdout.toString().trim()

beforeEach(() => {
  dir = join(root, `v${n++}`)
  mkdirSync(dir)
  put(join(dir, 'spaces.json'), JSON.stringify({ spaces: [{ folder: 'miso', id: 'miso', slug: 'miso' }, { folder: 'acme', id: 'acme-1', slug: 'acme' }] }))
  put(join(dir, 'miso', '.miso', 'views', 'home.tsx'), 'shipped')
  put(join(dir, 'acme', '.miso', 'views', 'home.tsx'), 'v1')
  put(join(dir, 'acme', '.miso', '.workspace.json'), '{"name":"Acme"}')
  put(join(dir, 'acme', '.miso', 'node_modules', 'x', 'index.js'), '')
  initRepo(dir)
  commit(dir, 'start')
})

// The exact files of a change in acme, as the tools pass them.
const files = (change: { write: { path: string }[]; delete: string[] }) => () => [...change.write.map(f => f.path), ...change.delete].map(rel => `acme/.miso/${rel}`)
const build = (ok: boolean, errors?: string) => async (after: number): Promise<BuildStatus> => ({ id: 1, startedAt: after, finishedAt: after + 1, ok, errors })
const member = { name: 'Ada Admin', email: 'ada@example.com' }

test('a member changes only their own draft space; the cap is 3 drafts', () => {
  const space = planSpace('Mo draft', undefined, { ids: new Set(), slugs: new Set() }, dir)
  writeSpace(space, dir, 'u-mo')
  expect(JSON.parse(readFileSync(join(dir, 'spaces.json'), 'utf8')).spaces.at(-1)).toMatchObject({ folder: 'mo-draft', draft: true, createdBy: 'u-mo' })
  expect(spaceFolder('mo-draft', { dir, edit: mo, shipped: [] })).toBe('mo-draft')
  expect(() => spaceFolder('mo-draft', { dir, edit: { userId: 'u-eve', admin: false }, shipped: [] })).toThrow('own draft spaces')
  expect(() => spaceFolder('acme', { dir, edit: mo, shipped: [] })).toThrow('own draft spaces')
  for (const name of ['Second', 'Third']) writeSpace(planSpace(name, undefined, { ids: new Set(), slugs: new Set() }, dir), dir, 'u-mo')
  expect(() => checkDraftCap('u-mo', dir)).toThrow('3 draft spaces')
  expect(() => checkDraftCap('u-eve', dir)).not.toThrow()
})

test('deleting a draft space removes its folder and entry in one change, and a failed build puts both back', async () => {
  const space = planSpace('Gone soon', undefined, { ids: new Set(), slugs: new Set() }, dir)
  writeSpace(space, dir, 'u-mo')
  commit(dir, 'draft')
  const entry = spaceEntry('gone-soon', { dir })
  const remove = (ok: boolean) => runChange({ dir, summary: 'Delete', author: member, touched: () => spaceTrackedFiles(entry.folder, dir), apply: () => removeSpace(entry, dir), waitForBuild: build(ok, 'x') })
  expect((await remove(false)).status).toBe('put back')
  expect(existsSync(join(dir, 'gone-soon', '.miso', '.workspace.json'))).toBe(true)
  expect(readFileSync(join(dir, 'spaces.json'), 'utf8')).toContain('gone-soon')
  expect((await remove(true)).status).toBe('saved')
  expect(existsSync(join(dir, 'gone-soon'))).toBe(false)
  expect(readFileSync(join(dir, 'spaces.json'), 'utf8')).not.toContain('gone-soon')
  expect(git('status', '--porcelain')).toBe('')
})

test('paths: only under .miso/, no dot parts, no node_modules, package.json only at the top, text files only', () => {
  expect(checkPath('views/home.tsx')).toBe('views/home.tsx')
  expect(checkPath('package.json')).toBe('package.json')
  for (const bad of ['../x.ts', 'views/../../x.ts', '.workspace.json', 'views/.hidden.tsx', 'node_modules/x/index.js', 'views/package.json', 'bun.lock', 'bunfig.toml', '.npmrc', '.yarnrc.yml', 'views/image.png', '/etc/passwd', '', 'a//b.ts']) {
    expect(() => checkPath(bad)).toThrow(FileRefusal)
  }
  expect(() => checkPath('views/package.json')).toThrow('one package.json')
})

test("a space's package.json is checked before anything is written", () => {
  const pkg = (value: unknown) => ({ write: [{ path: 'package.json', content: `${JSON.stringify(value, null, 2)}\n` }], delete: [] })
  expect(checkChange('acme', pkg({ dependencies: { 'date-fns': '4.1.0' } }), dir).write[0]!.path).toBe('package.json')
  expect(() => checkChange('acme', pkg({ dependencies: { 'date-fns': '^4.1.0' } }), dir)).toThrow('exact versions')
  // A draft may list packages too: they are installed once an admin approves it.
  expect(checkChange('acme', pkg({ dependencies: { 'date-fns': '4.1.0' } }), dir, { draft: true }).write).toHaveLength(1)
  expect(() => checkChange('acme', pkg({ dependencies: { x: 'file:../x' } }), dir)).toThrow('exact versions from the npm registry')
  expect(() => checkChange('acme', pkg({ dependencies: { x: '1.0.0' }, overrides: { y: '1.0.0' } }), dir)).toThrow('"overrides" isn\'t allowed')
})

const anAdmin = { userId: 'u-admin', admin: true }
const mo = { userId: 'u-mo', admin: false }

test('a shipped space and an unknown one are refused for changes', () => {
  expect(spaceFolder('acme', { dir, edit: anAdmin, shipped: ['miso'] })).toBe('acme')
  expect(() => spaceFolder('miso', { dir, edit: anAdmin, shipped: ['miso'] })).toThrow(`${APP_NAME}'s own spaces`)
  expect(spaceFolder('miso', { dir, shipped: ['miso'] })).toBe('miso')
  expect(() => spaceFolder('nope', { dir })).toThrow(FileRefusal)
})

test('reading lists and returns no dot files and nothing from node_modules, and follows no link', () => {
  expect(listFiles('acme', dir).map(f => f.path)).toEqual(['views/home.tsx'])
  expect(readFile('acme', 'views/home.tsx', dir)).toBe('v1')
  expect(() => readFile('acme', '.workspace.json', dir)).toThrow(FileRefusal)
  symlinkSync('/etc', join(dir, 'acme', '.miso', 'lib'))
  expect(() => readFile('acme', 'lib/hosts.txt', dir)).toThrow('link')
  expect(() => checkChange('acme', { write: [{ path: 'lib/x.ts', content: '' }], delete: [] }, dir)).toThrow('link')
})

test("a draft can't hold a stylesheet or a tsconfig.json/jsconfig.json: the build would run or follow them", () => {
  const draft = { draft: true }
  expect(() => checkChange('acme', { write: [{ path: 'views/x.css', content: '@plugin "./p.js";' }], delete: [] }, dir, draft)).toThrow('stylesheets')
  expect(() => checkChange('acme', { write: [{ path: 'tsconfig.json', content: '{}' }], delete: [] }, dir, draft)).toThrow('tsconfig.json')
  expect(() => checkChange('acme', { write: [{ path: 'lib/JSConfig.json', content: '{}' }], delete: [] }, dir, draft)).toThrow('jsconfig.json')
  // An admin's change to a company space may still hold them.
  expect(checkChange('acme', { write: [{ path: 'views/x.css', content: '.a {}' }], delete: [] }, dir).write).toHaveLength(1)
})

test('a change is checked whole before anything is written: sizes, duplicates, design rules', () => {
  expect(() => checkChange('acme', { write: [], delete: [] }, dir)).toThrow('at least one')
  expect(() => checkChange('acme', { write: [{ path: 'views/a.tsx', content: 'x' }], delete: ['views/a.tsx'] }, dir)).toThrow('Each file once')
  expect(() => checkChange('acme', { write: [{ path: 'widgets/w.tsx', content: '<div className="overflow-auto" />' }], delete: [] }, dir)).toThrow('never scrolls')
  expect(() => checkChange('acme', { write: [], delete: ['views/missing.tsx'] }, dir)).toThrow("isn't there")
  expect(() => checkChange('acme', { write: [{ path: 'views/a.tsx', content: 'x'.repeat(200_001) }], delete: [] }, dir)).toThrow('at most')
})

test('a passing build commits the whole change as the member, with the summary as one line', async () => {
  const change = checkChange('acme', { write: [{ path: 'views/home.tsx', content: 'v2' }, { path: 'lib/data.server.ts', content: 'export const x = 1' }], delete: [] }, dir)
  const result = await runChange({ dir, summary: checkSummary('Home shows data\n--author=evil'), author: member, touched: files(change), apply: () => applyFiles('acme', change, dir), waitForBuild: build(true) })
  expect(result.status).toBe('saved')
  expect(git('log', '-1', '--format=%an <%ae>|%s')).toBe('Ada Admin <ada@example.com>|Home shows data --author=evil')
  expect(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['acme/.miso/lib/data.server.ts', 'acme/.miso/views/home.tsx'])
  expect(git('status', '--porcelain')).toBe('')
})

test('a failed build puts every file back and leaves git status clean', async () => {
  const change = checkChange('acme', { write: [{ path: 'views/home.tsx', content: 'broken' }, { path: 'views/new.tsx', content: 'new' }], delete: [] }, dir)
  const result = await runChange({ dir, summary: 'Break it', author: member, touched: files(change), apply: () => applyFiles('acme', change, dir), waitForBuild: build(false, 'error: Client build failed') })
  expect(result).toEqual({ status: 'put back', errors: 'error: Client build failed' })
  expect(readFileSync(join(dir, 'acme', '.miso', 'views', 'home.tsx'), 'utf8')).toBe('v1')
  expect(existsSync(join(dir, 'acme', '.miso', 'views', 'new.tsx'))).toBe(false)
  expect(git('status', '--porcelain')).toBe('')
  expect(git('log', '--format=%s')).toBe('start')
})

test('a change into folders that did not exist asks for its build once every file is there, and waits for a build from then on', async () => {
  const change = checkChange('acme', { write: [{ path: 'lib/new/data.ts', content: 'export const x = 1' }, { path: 'views/deep/page.tsx', content: 'v' }], delete: [] }, dir)
  const events: string[] = []
  let askedAt = 0
  const result = await runChange({
    dir,
    summary: 'New folders',
    author: member,
    touched: files(change),
    apply: () => applyFiles('acme', change, dir),
    askForBuild: () => {
      askedAt = Date.now()
      events.push(`asked; files there: ${existsSync(join(dir, 'acme/.miso/lib/new/data.ts')) && existsSync(join(dir, 'acme/.miso/views/deep/page.tsx'))}`)
    },
    waitForBuild: async after => {
      events.push(`waits for a build from ${after >= askedAt - 5 && after <= askedAt ? 'the request' : after}`)
      return { id: 2, startedAt: Date.now(), finishedAt: Date.now(), ok: true }
    }
  })
  expect(result.status).toBe('saved')
  expect(events).toEqual(['asked; files there: true', 'waits for a build from the request'])
})

test('the real request writes the file the app watches, and nothing where it is missing', async () => {
  const { requestBuild } = await import('./build-status')
  const file = join(dir, 'rebuild-request')
  requestBuild(file)
  expect(existsSync(file)).toBe(false)
  writeFileSync(file, '')
  requestBuild(file)
  expect(Number(readFileSync(file, 'utf8'))).toBeGreaterThan(0)
})

test('a change that changes nothing says so at once and waits for no build', async () => {
  const change = checkChange('acme', { write: [{ path: 'views/home.tsx', content: 'v1' }], delete: [] }, dir)
  const result = await runChange({ dir, summary: 'Same', author: member, touched: files(change), apply: () => applyFiles('acme', change, dir), waitForBuild: () => Promise.reject(new Error('no build expected')) })
  expect(result).toEqual({ status: 'no change' })
})

test('an uncommitted file blocks only a change to that same file, and is never swept into a commit', async () => {
  writeFileSync(join(dir, 'acme', '.miso', 'views', 'home.tsx'), 'edited by hand')
  put(join(dir, 'acme', '.miso', 'views', 'stray.tsx'), 'untracked')
  const same = checkChange('acme', { write: [{ path: 'views/home.tsx', content: 'x' }], delete: [] }, dir)
  await expect(runChange({ dir, summary: 'X', author: member, touched: files(same), apply: () => applyFiles('acme', same, dir), waitForBuild: build(true) })).rejects.toThrow('never committed')
  const other = checkChange('acme', { write: [{ path: 'views/other.tsx', content: 'x' }], delete: [] }, dir)
  // A file that shows up while the change waits for its build is not the change's either.
  const result = await runChange({
    dir,
    summary: 'Other',
    author: member,
    touched: files(other),
    apply: () => applyFiles('acme', other, dir),
    waitForBuild: async after => (put(join(dir, 'acme', '.miso', 'views', 'late.tsx'), 'late'), { id: 1, startedAt: after, finishedAt: after, ok: true })
  })
  expect(result.status).toBe('saved')
  expect(git('show', '--name-only', '--format=', 'HEAD')).toBe('acme/.miso/views/other.tsx')
  expect(readFileSync(join(dir, 'acme', '.miso', 'views', 'home.tsx'), 'utf8')).toBe('edited by hand')
  expect(existsSync(join(dir, 'acme', '.miso', 'views', 'late.tsx'))).toBe(true)
})

test('two creates with the same name at once: one is saved, the other refused, and spaces.json has one entry', async () => {
  const create = () => {
    let space: ReturnType<typeof planSpace> | null = null
    return runChange({
      dir,
      summary: 'Create',
      author: member,
      prepare: () => void (space = planSpace('Twins', undefined, { ids: new Set(), slugs: new Set() }, dir)),
      touched: () => spaceFiles(space!),
      apply: () => writeSpace(space!, dir),
      waitForBuild: async after => (await Bun.sleep(20), { id: 1, startedAt: after, finishedAt: after, ok: true })
    })
  }
  const results = await Promise.allSettled([create(), create()])
  expect(results.filter(r => r.status === 'fulfilled').length).toBe(1)
  expect(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.message)).toContain('already')
  expect(JSON.parse(readFileSync(join(dir, 'spaces.json'), 'utf8')).spaces.filter((s: { slug: string }) => s.slug === 'twins')).toHaveLength(1)
})

test('a create whose build fails leaves no folder, so the slug can be used again', async () => {
  const create = (ok: boolean) => {
    let space: ReturnType<typeof planSpace> | null = null
    return runChange({
      dir,
      summary: 'Create',
      author: member,
      prepare: () => void (space = planSpace('Again', undefined, { ids: new Set(), slugs: new Set() }, dir)),
      touched: () => spaceFiles(space!),
      apply: () => writeSpace(space!, dir),
      waitForBuild: build(ok, 'broken')
    })
  }
  expect((await create(false)).status).toBe('put back')
  expect(existsSync(join(dir, 'again'))).toBe(false)
  expect(git('status', '--porcelain')).toBe('')
  expect((await create(true)).status).toBe('saved')
})

test('a change that built but could not be committed is put back and says so', async () => {
  const change = checkChange('acme', { write: [{ path: 'views/home.tsx', content: 'v2' }], delete: [] }, dir)
  // A hook that refuses makes git commit fail, as a full disk would; checkout still works.
  writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  const quiet = console.error
  console.error = () => {}
  const result = await runChange({ dir, summary: 'X', author: member, touched: files(change), apply: () => applyFiles('acme', change, dir), waitForBuild: build(true) })
  console.error = quiet
  expect(result.status).toBe('put back')
  expect(readFileSync(join(dir, 'acme', '.miso', 'views', 'home.tsx'), 'utf8')).toBe('v1')
})

test('the lock: a second change waits, and a stale lock is taken over', async () => {
  const order: string[] = []
  const first = withLock(dir, async () => {
    await Bun.sleep(50)
    order.push('first')
  })
  await Bun.sleep(5)
  await withLock(dir, async () => void order.push('second'))
  await first
  expect(order).toEqual(['first', 'second'])
  mkdirSync(join(dir, '.git', 'tamari-change.lock'))
  const old = new Date(Date.now() - 11 * 60_000)
  utimesSync(join(dir, '.git', 'tamari-change.lock'), old, old)
  expect(await withLock(dir, async () => 'taken')).toBe('taken')
  mkdirSync(join(dir, '.git', 'tamari-change.lock'))
  await expect(withLock(dir, async () => 'never', { waitMs: 50 })).rejects.toThrow('still being built')
})

test('a new space: slug and id checked against every space, never a reused id, and the kit is there', () => {
  const taken = { ids: new Set(['manual-1']), slugs: new Set(['manual']) }
  expect(() => planSpace('Acme', undefined, taken, dir)).toThrow('already')
  expect(() => planSpace('Manual', undefined, taken, dir)).toThrow('already')
  expect(() => planSpace('Members', undefined, taken, dir)).toThrow('page of the app')
  const space = planSpace('Sales pipeline', undefined, taken, dir)
  expect(space.slug).toBe('sales-pipeline')
  expect(space.id).toMatch(/^sales-pipeline-[0-9a-f]{6}$/)
  writeSpace(space, dir)
  expect(JSON.parse(readFileSync(join(dir, 'sales-pipeline', '.miso', '.workspace.json'), 'utf8'))).toEqual({ name: 'Sales pipeline' })
  expect(JSON.parse(readFileSync(join(dir, 'spaces.json'), 'utf8')).spaces.at(-1)).toEqual({ folder: 'sales-pipeline', id: space.id, slug: 'sales-pipeline' })
})

test('authorLine keeps the author to one line and one address', () => {
  expect(authorLine({ name: 'Eve <x@y>\nCommitter: z', email: 'eve@example.com' })).toBe('Eve x@y Committer: z <eve@example.com>')
  expect(authorLine({ name: null, email: 'not an email' })).toBe('unknown@localhost <unknown@localhost>')
})

test('a file with control characters is refused: a NUL would make the review show it as binary', () => {
  expect(() => checkChange('acme', { write: [{ path: 'views/x.tsx', content: 'ok\u0000hidden' }], delete: [] }, dir)).toThrow('control characters')
  expect(checkChange('acme', { write: [{ path: 'views/x.tsx', content: 'tabs\tand\nlines\r\n' }], delete: [] }, dir).write).toHaveLength(1)
})

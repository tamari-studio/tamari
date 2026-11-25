import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  addSeed,
  addSeedRecords,
  commit,
  ignoreInstalls,
  initRepo,
  markSeedRecordsPending,
  resolveDates,
  type SeedRecord,
  seedRecords,
  seedRecordsPending,
  shippedFolders,
  updateShipped
} from './spaces-volume'

const root = mkdtempSync(join(tmpdir(), 'spaces-volume-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function put(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
const spacesFile = (...folders: string[]) => JSON.stringify({ spaces: folders.map(folder => ({ folder, id: folder, slug: folder })) })
const log = (dir: string) => Bun.spawnSync(['git', 'log', '--format=%s'], { cwd: dir }).stdout.toString().trim().split('\n')

const shell = join(root, 'shell')
const volume = join(root, 'volume')
put(join(shell, 'workspaces', 'miso', '.miso', 'views', 'home.tsx'), 'v1')
put(join(shell, 'workspaces', 'vault', '.miso', 'views', 'notes.tsx'), 'v1')
put(join(shell, 'spaces.json'), spacesFile('miso'))
mkdirSync(volume)

test('the shipped folders are the folders in the image copy, and none without one', () => {
  expect(shippedFolders(shell)).toEqual(['miso', 'vault'])
  expect(shippedFolders(join(root, 'nowhere'))).toEqual([])
})

test('a first start fills an empty volume and commits it once', () => {
  initRepo(volume)
  updateShipped(volume, shell)
  expect(commit(volume, 'Spaces as installed')).toBe(true)
  expect(readFileSync(join(volume, 'miso', '.miso', 'views', 'home.tsx'), 'utf8')).toBe('v1')
  expect(JSON.parse(readFileSync(join(volume, 'spaces.json'), 'utf8')).spaces.map((s: { folder: string }) => s.folder)).toEqual(['miso'])
  expect(readFileSync(join(volume, '.gitignore'), 'utf8')).toContain('node_modules/')
  // Nothing changed since: no second commit.
  expect(commit(volume, 'Shell update', updateShipped(volume, shell))).toBe(false)
  expect(log(volume)).toEqual(['Spaces as installed'])
})

test('a shell update replaces shipped folders, keeps company folders and their spaces.json order', () => {
  // The company adds a space before the shipped one, and edits inside a shipped folder.
  put(join(volume, 'acme', '.miso', 'views', 'home.tsx'), 'ours')
  writeFileSync(join(volume, 'spaces.json'), spacesFile('acme', 'miso'))
  put(join(volume, 'miso', '.miso', 'views', 'extra.tsx'), 'not shipped')
  commit(volume, 'Company edits')
  // A new image: a changed shipped file and a new shipped space.
  put(join(shell, 'workspaces', 'miso', '.miso', 'views', 'home.tsx'), 'v2')
  put(join(shell, 'spaces.json'), spacesFile('miso', 'vault'))

  expect(commit(volume, 'Shell update', updateShipped(volume, shell))).toBe(true)
  expect(readFileSync(join(volume, 'miso', '.miso', 'views', 'home.tsx'), 'utf8')).toBe('v2')
  expect(() => readFileSync(join(volume, 'miso', '.miso', 'views', 'extra.tsx'))).toThrow()
  expect(readFileSync(join(volume, 'acme', '.miso', 'views', 'home.tsx'), 'utf8')).toBe('ours')
  expect(JSON.parse(readFileSync(join(volume, 'spaces.json'), 'utf8')).spaces.map((s: { folder: string }) => s.folder)).toEqual(['acme', 'miso', 'vault'])
  expect(log(volume)).toEqual(['Shell update', 'Company edits', 'Spaces as installed'])
})

test('a company change that is not committed stays out of the shell-update commit', () => {
  put(join(volume, 'acme', '.miso', 'views', 'draft.tsx'), 'work in progress')
  put(join(shell, 'workspaces', 'vault', '.miso', 'views', 'notes.tsx'), 'v2')
  expect(commit(volume, 'Shell update 2', updateShipped(volume, shell))).toBe(true)
  const files = Bun.spawnSync(['git', 'show', '--name-only', '--format=', 'HEAD'], { cwd: volume }).stdout.toString().trim()
  expect(files).toBe('vault/.miso/views/notes.tsx')
})

test('a seed adds its own folders and entries to a new volume, and never a shipped or existing one', () => {
  const seed = join(root, 'seed')
  const fresh = join(root, 'fresh')
  put(join(seed, 'workspaces', 'agency', '.miso', 'views', 'clients.tsx'), 'sample')
  put(join(seed, 'workspaces', 'miso', '.miso', 'views', 'home.tsx'), 'not the shell')
  // Not a plain folder name: never copied, its entry never added.
  put(join(seed, 'workspaces', 'bad name', '.miso', 'views', 'x.tsx'), 'x')
  put(join(seed, 'workspaces', '.hidden', '.miso', 'views', 'x.tsx'), 'x')
  put(join(seed, 'spaces.json'), spacesFile('agency', 'miso', 'bad name', '.hidden'))
  mkdirSync(fresh)
  initRepo(fresh)
  updateShipped(fresh, shell)
  expect(addSeed(fresh, seed, shell)).toEqual(['agency'])
  expect(readFileSync(join(fresh, 'agency', '.miso', 'views', 'clients.tsx'), 'utf8')).toBe('sample')
  expect(readFileSync(join(fresh, 'miso', '.miso', 'views', 'home.tsx'), 'utf8')).not.toBe('not the shell')
  const folders = JSON.parse(readFileSync(join(fresh, 'spaces.json'), 'utf8')).spaces.map((s: { folder: string }) => s.folder)
  expect(folders.filter((f: string) => f === 'agency')).toEqual(['agency'])
  // Again: the folder is there now, so nothing is added twice.
  expect(addSeed(fresh, seed, shell)).toEqual([])
})

test('no seed, or an empty one, changes nothing', () => {
  const empty = join(root, 'empty-seed')
  mkdirSync(join(empty, 'workspaces'), { recursive: true })
  put(join(empty, 'spaces.json'), spacesFile())
  const before = readFileSync(join(volume, 'spaces.json'), 'utf8')
  expect(addSeed(volume, join(root, 'no-seed'), shell)).toEqual([])
  expect(addSeed(volume, empty, shell)).toEqual([])
  expect(readFileSync(join(volume, 'spaces.json'), 'utf8')).toBe(before)
  expect(seedRecords(join(root, 'no-seed'))).toEqual([])
})

test('seed dates are offsets from the install day', () => {
  expect(resolveDates({ a: '@today', b: '@today-1', c: ['@today+30'], d: '@month-1', e: '@month', f: 'on @today', g: 3 }, '2026-03-31')).toEqual({
    a: '2026-03-31',
    b: '2026-03-30',
    c: ['2026-04-30'],
    d: '2026-02',
    e: '2026-03',
    f: 'on @today',
    g: 3
  })
  expect(resolveDates('@month+1', '2026-12-15')).toBe('2027-01')
  const seed = join(root, 'records-seed')
  put(join(seed, 'records.json'), JSON.stringify([{ collection: 'agency-clients', key: 'example-1', data: { nextDate: '@today+2' } }]))
  expect(seedRecords(seed, '2026-01-01')).toEqual([{ collection: 'agency-clients', key: 'example-1', data: { nextDate: '2026-01-03' } }])
  put(join(seed, 'records.json'), JSON.stringify([{ collection: 'x' }]))
  expect(() => seedRecords(seed)).toThrow('row 1 needs collection, key and data')
})

describe('seed records', () => {
  const seed = join(root, 'retry-seed')
  put(join(seed, 'records.json'), JSON.stringify([{ collection: 'agency-clients', key: 'example-1', data: { n: 1 } }]))
  // A records table keyed on collection and key: an insert skips keys that exist, like the upsert in cli/selfhost.ts.
  const table = () => {
    const rows = new Map<string, unknown>()
    let fail = false
    const insert = async (batch: SeedRecord[]) => {
      if (fail) throw new Error('data API unavailable')
      for (const r of batch) if (!rows.has(`${r.collection}/${r.key}`)) rows.set(`${r.collection}/${r.key}`, r.data)
    }
    return { rows, insert, failNext: (f: boolean) => (fail = f) }
  }
  const newVolume = (name: string) => {
    const dir = join(root, name)
    mkdirSync(dir)
    initRepo(dir)
    markSeedRecordsPending(dir)
    return dir
  }

  test('a first start that fails is tried again on the next start, then never again', async () => {
    const dir = newVolume('retry-fails-first')
    const db = table()
    db.failNext(true)
    await expect(addSeedRecords(dir, db.insert, seed)).rejects.toThrow('data API unavailable')
    expect(existsSync(seedRecordsPending(dir))).toBe(true)
    db.failNext(false)
    expect(await addSeedRecords(dir, db.insert, seed)).toBe(1)
    expect([...db.rows.keys()]).toEqual(['agency-clients/example-1'])
    expect(existsSync(seedRecordsPending(dir))).toBe(false)
    // The company removes the sample record: a later start doesn't bring it back.
    db.rows.clear()
    expect(await addSeedRecords(dir, db.insert, seed)).toBeNull()
    expect(db.rows.size).toBe(0)
  })

  test('a first start that succeeds never runs again', async () => {
    const dir = newVolume('retry-succeeds-first')
    const db = table()
    expect(await addSeedRecords(dir, db.insert, seed)).toBe(1)
    db.rows.clear()
    expect(await addSeedRecords(dir, db.insert, seed)).toBeNull()
    expect(db.rows.size).toBe(0)
  })

  test('a volume from before the mark never gets the records', async () => {
    const dir = join(root, 'retry-old-volume')
    mkdirSync(dir)
    initRepo(dir)
    const db = table()
    expect(await addSeedRecords(dir, db.insert, seed)).toBeNull()
    expect(db.rows.size).toBe(0)
  })

  test('the mark is never committed, and a seed without records clears it', async () => {
    const dir = newVolume('retry-no-records')
    expect(commit(dir, 'Spaces as installed')).toBe(true)
    expect(Bun.spawnSync(['git', 'ls-files'], { cwd: dir }).stdout.toString().trim()).toBe('.gitignore')
    expect(await addSeedRecords(dir, table().insert, join(root, 'no-seed'))).toBe(0)
    expect(existsSync(seedRecordsPending(dir))).toBe(false)
  })
})

test('node_modules stays out of the history, also when .gitignore lost the line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ignore-installs-'))
  expect(ignoreInstalls(dir)).toBe(true)
  expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules/\n')
  expect(ignoreInstalls(dir)).toBe(false)
  writeFileSync(join(dir, '.gitignore'), '*.log')
  expect(ignoreInstalls(dir)).toBe(true)
  expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('*.log\nnode_modules/\n')
  rmSync(dir, { recursive: true, force: true })
})

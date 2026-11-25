import { afterAll, beforeEach, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BuildStatus } from './build-status'
import { approveProposal, diffOf, rejectProposal, submitProposal, withdrawProposal, type ProposalRow } from './proposal-flow'
import { applyPublish, copyChangeFiles, findCopy, planCopy, writeCopy, type CopyEntry } from './proposals'
import { applyFiles, FileRefusal, readSpacesFile, runChange, type SpaceEntry } from './space-files'
import { commit, initRepo } from './spaces-volume'
import type { Db } from './supabase'

const root = mkdtempSync(join(tmpdir(), 'proposals-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let dir = ''
let n = 0
const put = (path: string, text: string) => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8')
const ok = async (after: number): Promise<BuildStatus> => ({ id: 1, startedAt: after, finishedAt: after + 1, ok: true })
const broken = async (after: number): Promise<BuildStatus> => ({ id: 1, startedAt: after, finishedAt: after + 1, ok: false, errors: 'boom' })
const noBuild = () => {}
const mo = { name: 'Mo Member', email: 'mo@example.com' }

// The calls proposal-flow makes on the vault account's client, over an array.
function fakeDb() {
  const rows: ProposalRow[] = []
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  let next = 0
  const query = () => {
    const filters: [string, unknown][] = []
    let insert: Partial<ProposalRow> | null = null
    let update: Partial<ProposalRow> | null = null
    const matching = () => rows.filter(r => filters.every(([k, v]) => (r as Record<string, unknown>)[k] === v))
    const run = () => {
      if (insert) {
        const row = insert as ProposalRow
        if (row.status === 'open' && rows.some(r => r.status === 'open' && r.draft_folder === row.draft_folder)) return { data: null, error: { code: '23505', message: 'dup' } }
        rows.push(row)
        return { data: row, error: null }
      }
      const found = matching()
      if (update) for (const r of found) Object.assign(r, update)
      return { data: found[0] ?? null, error: null }
    }
    const q = {
      select: () => q,
      order: () => q,
      limit: () => q,
      eq: (k: string, v: unknown) => (filters.push([k, v]), q),
      insert: (v: Partial<ProposalRow>) => ((insert = { id: `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`, status: 'open', created_at: 'now', decided_at: null, decided_by: null, reason: null, ...v }), q),
      update: (v: Partial<ProposalRow>) => ((update = v), q),
      maybeSingle: async () => run(),
      single: async () => run(),
      then: (resolve: (v: unknown) => void) => resolve(run())
    }
    return q
  }
  const db = {
    from: () => query(),
    rpc: async (fn: string, args: Record<string, unknown>) => (rpcs.push({ fn, args }), { data: fn === 'sync_spaces' ? [] : true, error: null })
  } as unknown as Db
  return { db, rows, rpcs }
}

beforeEach(() => {
  dir = join(root, `v${n++}`)
  mkdirSync(dir)
  put(join(dir, 'spaces.json'), JSON.stringify({ spaces: [{ folder: 'acme', id: 'acme-1', slug: 'acme' }] }))
  put(join(dir, 'acme', '.miso', 'views', 'home.tsx'), 'v1')
  put(join(dir, 'acme', '.miso', 'views', 'old.tsx'), 'old')
  put(join(dir, 'acme', '.miso', 'styles.css'), '@plugin "x";')
  put(join(dir, 'acme', '.miso', '.workspace.json'), '{"name":"Acme"}')
  initRepo(dir)
  commit(dir, 'start')
})

const acme = (): SpaceEntry => readSpacesFile(dir).find(s => s.folder === 'acme')!

// What change_space_files does for a member's first change to acme.
async function memberChange(write: { path: string; content: string }[], del: string[] = []): Promise<CopyEntry> {
  const live = acme()
  const plan = planCopy(live, dir)
  const result = await runChange({
    dir,
    summary: 'Mo changes acme',
    author: mo,
    touched: () => copyChangeFiles(live, plan.folder, { write, delete: del }, true, dir),
    apply: () => {
      writeCopy(live, plan, 'u-mo', dir)
      applyFiles(plan.folder, { write, delete: del }, dir)
    },
    waitForBuild: ok,
    askForBuild: noBuild
  })
  expect(result.status).toBe('saved')
  return findCopy('acme', 'u-mo', dir)!
}

test('a copy holds the live files as committed, a draft name, and its starting commit', async () => {
  const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: dir }).stdout.toString().trim()
  const copy = await memberChange([{ path: 'views/home.tsx', content: 'v2' }])
  expect(copy).toMatchObject({ draft: true, createdBy: 'u-mo', draftOf: 'acme', baseCommit: head })
  expect(copy.folder).toMatch(/^acme--draft-[0-9a-f]{6}$/)
  expect(read(`${copy.folder}/.miso/views/home.tsx`)).toBe('v2')
  expect(read(`${copy.folder}/.miso/views/old.tsx`)).toBe('old')
  expect(JSON.parse(read(`${copy.folder}/.miso/.workspace.json`)).name).toBe('Acme (your draft)')
  expect(read('acme/.miso/views/home.tsx')).toBe('v1')
})

test('a copy is refused while the live space has changes nobody committed', () => {
  put(join(dir, 'acme', '.miso', 'views', 'home.tsx'), 'dirty')
  expect(() => writeCopy(acme(), planCopy(acme(), dir), 'u-mo', dir)).toThrow(FileRefusal)
})

test('approving copies the draft over the live space, deletes what it deleted, and commits as the author', async () => {
  const copy = await memberChange([{ path: 'views/home.tsx', content: 'v2' }, { path: 'views/new.tsx', content: 'new' }], ['views/old.tsx'])
  const { db, rows, rpcs } = fakeDb()
  const sent = await submitProposal({ db, dir }, { entry: copy, userId: 'u-mo', author: mo, summary: 'Better home' })
  expect(sent).toMatchObject({ kind: 'change', space_id: 'acme-1', draft_folder: copy.folder, base_commit: copy.baseCommit })
  expect(diffOf(sent, dir).diff).toContain('+v2')
  // The copy's name is not part of the change: approving never copies .workspace.json.
  expect(diffOf(sent, dir).diff).not.toContain('your draft')

  const result = await approveProposal({ db, dir, waitForBuild: ok, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })
  expect(result.status).toBe('approved')
  expect(read('acme/.miso/views/home.tsx')).toBe('v2')
  expect(read('acme/.miso/views/new.tsx')).toBe('new')
  expect(existsSync(join(dir, 'acme/.miso/views/old.tsx'))).toBe(false)
  // Dot files and files the member couldn't write stay as the live space has them.
  expect(read('acme/.miso/.workspace.json')).toBe('{"name":"Acme"}')
  expect(read('acme/.miso/styles.css')).toBe('@plugin "x";')
  expect(existsSync(join(dir, copy.folder))).toBe(false)
  expect(readSpacesFile(dir).map(s => s.folder)).toEqual(['acme'])
  expect(Bun.spawnSync(['git', 'log', '-1', '--format=%an <%ae>|%s'], { cwd: dir }).stdout.toString().trim()).toBe('Mo Member <mo@example.com>|Better home')
  expect(Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: dir }).stdout.toString()).toBe('')
  expect(rpcs.map(r => r.fn)).toEqual(['sync_spaces', 'delete_draft_space'])
  expect(rpcs[0].args.p_spaces).toEqual([expect.objectContaining({ id: copy.id, folder: copy.folder, draft: true, created_by: 'u-mo', parent_id: 'acme-1', name: 'Acme (your draft)' })])
  expect(rpcs.slice(1)).toEqual([{ fn: 'delete_draft_space', args: { p_space: copy.id, p_user: 'u-mo' } }])
  expect(rows[0]).toMatchObject({ status: 'approved', decided_by: 'u-admin' })
  // The review still shows what was approved, from the history.
  expect(diffOf(rows[0], dir).diff).toContain('+v2')
})

test('a live space that changed since the copy makes the proposal out of date, and nothing is copied', async () => {
  const copy = await memberChange([{ path: 'views/home.tsx', content: 'v2' }])
  const { db, rows } = fakeDb()
  const sent = await submitProposal({ db, dir }, { entry: copy, userId: 'u-mo', author: mo, summary: 'Better home' })
  put(join(dir, 'acme', '.miso', 'views', 'home.tsx'), 'admin edit')
  commit(dir, 'admin edit', ['acme'])
  expect(await approveProposal({ db, dir, waitForBuild: ok, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })).toEqual({ status: 'out of date' })
  expect(read('acme/.miso/views/home.tsx')).toBe('admin edit')
  expect(rows[0].status).toBe('out_of_date')
})

test('a draft changed after it was sent is not approved', async () => {
  const copy = await memberChange([{ path: 'views/home.tsx', content: 'v2' }])
  const { db } = fakeDb()
  const sent = await submitProposal({ db, dir }, { entry: copy, userId: 'u-mo', author: mo, summary: 'Better home' })
  put(join(dir, copy.folder, '.miso', 'views', 'home.tsx'), 'sneaky')
  commit(dir, 'sneaky', [copy.folder])
  await expect(approveProposal({ db, dir, waitForBuild: ok, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })).rejects.toThrow('changed after it was sent')
  expect(read('acme/.miso/views/home.tsx')).toBe('v1')
})

test('a failed build puts everything back and the proposal stays open', async () => {
  const copy = await memberChange([{ path: 'views/home.tsx', content: 'v2' }])
  const { db, rows, rpcs } = fakeDb()
  const sent = await submitProposal({ db, dir }, { entry: copy, userId: 'u-mo', author: mo, summary: 'Better home' })
  expect(await approveProposal({ db, dir, waitForBuild: broken, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })).toEqual({ status: 'put back', errors: 'boom' })
  expect(read('acme/.miso/views/home.tsx')).toBe('v1')
  expect(read(`${copy.folder}/.miso/views/home.tsx`)).toBe('v2')
  expect(rows[0].status).toBe('open')
  expect(rpcs.map(r => r.fn)).toEqual(['sync_spaces'])
})

test('one open proposal per draft; reject needs a reason; only the author withdraws', async () => {
  const copy = await memberChange([{ path: 'views/home.tsx', content: 'v2' }])
  const { db, rows } = fakeDb()
  const sent = await submitProposal({ db, dir }, { entry: copy, userId: 'u-mo', author: mo, summary: 'Better home' })
  await expect(submitProposal({ db, dir }, { entry: copy, userId: 'u-mo', author: mo, summary: 'Again' })).rejects.toThrow('sent already')
  await expect(submitProposal({ db, dir }, { entry: copy, userId: 'u-other', author: mo, summary: 'Mine' })).rejects.toThrow('your own drafts')
  await expect(rejectProposal({ db }, { id: sent.id, adminId: 'u-admin', reason: '  ' })).rejects.toThrow('why')
  await expect(withdrawProposal({ db }, { id: sent.id, userId: 'u-admin' })).rejects.toThrow('Only the author')
  await rejectProposal({ db }, { id: sent.id, adminId: 'u-admin', reason: 'Use the kit' })
  expect(rows[0]).toMatchObject({ status: 'rejected', reason: 'Use the kit' })
  await expect(approveProposal({ db, dir, waitForBuild: ok, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })).rejects.toThrow('decided or withdrawn')
})

test('publishing a draft space drops its draft mark and asks the database for its visibility', async () => {
  const file = JSON.parse(read('spaces.json'))
  file.spaces.push({ folder: 'mine', id: 'mine-1', slug: 'mine', draft: true, createdBy: 'u-mo' })
  put(join(dir, 'spaces.json'), JSON.stringify(file))
  put(join(dir, 'mine', '.miso', 'views', 'a.tsx'), 'a')
  commit(dir, 'mine')
  const { db, rpcs } = fakeDb()
  const entry = readSpacesFile(dir).find(s => s.folder === 'mine')!
  await expect(submitProposal({ db, dir }, { entry, userId: 'u-mo', author: mo, summary: 'Share' })).rejects.toThrow('who should see')
  const sent = await submitProposal({ db, dir }, { entry, userId: 'u-mo', author: mo, summary: 'Share', visibility: 'team' })
  expect(diffOf(sent, dir).diff).toContain('+a')
  expect((await approveProposal({ db, dir, waitForBuild: ok, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })).status).toBe('approved')
  expect(readSpacesFile(dir).find(s => s.folder === 'mine')!.draft).toBeUndefined()
  expect(rpcs.filter(r => r.fn !== 'sync_spaces')).toEqual([{ fn: 'publish_space', args: { p_space: 'mine-1', p_visibility: 'team', p_author: 'u-mo' } }])
  expect(() => applyPublish('acme', dir)).toThrow(FileRefusal)
})

test('a proposal too long to show in full is not approved', async () => {
  const big = (c: string) => `${c.repeat(150_000)}\n`
  const copy = await memberChange([{ path: 'views/a.tsx', content: big('a') }, { path: 'views/b.tsx', content: big('b') }])
  const { db } = fakeDb()
  const sent = await submitProposal({ db, dir }, { entry: copy, userId: 'u-mo', author: mo, summary: 'Huge' })
  expect(diffOf(sent, dir).cut).toBe(true)
  await expect(approveProposal({ db, dir, waitForBuild: ok, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })).rejects.toThrow("can't be approved")
  expect(existsSync(join(dir, 'acme/.miso/views/a.tsx'))).toBe(false)
})

test('a publication is not approved with files nobody committed, and a retry after a failed database step finishes it', async () => {
  const file = JSON.parse(read('spaces.json'))
  file.spaces.push({ folder: 'mine', id: 'mine-1', slug: 'mine', draft: true, createdBy: 'u-mo' })
  put(join(dir, 'spaces.json'), JSON.stringify(file))
  put(join(dir, 'mine', '.miso', 'views', 'a.tsx'), 'a')
  commit(dir, 'mine')
  const { db, rows } = fakeDb()
  const entry = readSpacesFile(dir).find(s => s.folder === 'mine')!
  const sent = await submitProposal({ db, dir }, { entry, userId: 'u-mo', author: mo, summary: 'Share', visibility: 'everyone' })
  put(join(dir, 'mine', '.miso', 'views', 'unseen.tsx'), 'never reviewed')
  await expect(approveProposal({ db, dir, waitForBuild: ok, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })).rejects.toThrow('changed after it was sent')
  rmSync(join(dir, 'mine', '.miso', 'views', 'unseen.tsx'))
  // An earlier try committed the spaces.json step, then the database step failed.
  applyPublish('mine', dir)
  commit(dir, 'published', ['spaces.json'])
  expect((await approveProposal({ db, dir, waitForBuild: ok, askForBuild: noBuild }, { id: sent.id, adminId: 'u-admin' })).status).toBe('approved')
  expect(rows[0].status).toBe('approved')
})

import { expect, test } from 'bun:test'

import type { Catalog } from '../lib/types'
import { BorrowRefused, createBorrowGate, readCallerShows, type CallerShows } from './borrow'
import type { Db } from './supabase'

const catalog: Catalog = {
  spaces: [
    {
      id: 'sp-ops',
      slug: 'ops',
      folder: 'ops',
      previousSlugs: [],
      position: 0,
      name: 'ops',
      theme: {}
    },
    {
      id: 'sp-data',
      slug: 'data',
      folder: 'dto',
      previousSlugs: [],
      position: 1,
      name: 'data',
      theme: {}
    }
  ],
  applets: [
    {
      ref: 'ops/invites',
      folder: 'ops',
      name: 'invites',
      kind: 'view',
      file: '',
      title: 'Invites',
      requiredEnv: []
    },
    {
      ref: 'ops/pace',
      folder: 'ops',
      name: 'pace',
      kind: 'widget',
      file: '',
      title: 'Pace',
      requiredEnv: []
    },
    {
      ref: 'dto/explorer',
      folder: 'dto',
      name: 'explorer',
      kind: 'view',
      file: '',
      title: 'Explorer',
      requiredEnv: []
    }
  ]
}

function spaces(rows: Record<string, CallerShows>) {
  const reads: string[] = []
  return {
    reads,
    read: async (id: string) => {
      reads.push(id)
      return rows[id] ?? null
    }
  }
}

test('a space with a tab showing the folder’s view borrows it', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({
    'sp-data': { tabRefs: ['view:dto/explorer', 'view:ops/invites'], widgetRefs: [] }
  })
  expect(await gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-data')
})

test('a widget placed on the space’s grid counts as showing the folder', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({ 'sp-data': { tabRefs: ['widgets'], widgetRefs: ['ops/pace'] } })
  expect(await gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-data')
})

test('a space with no tab from the folder is refused with 404', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({ 'sp-data': { tabRefs: ['view:dto/explorer'], widgetRefs: ['dto/other'] } })
  const refused = gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })
  await expect(refused).rejects.toBeInstanceOf(BorrowRefused)
  await expect(refused).rejects.toMatchObject({ status: 404 })
})

test('a tab naming a view the build doesn’t have grants nothing', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({ 'sp-data': { tabRefs: ['view:ops/removed'], widgetRefs: [] } })
  await expect(gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })).rejects.toBeInstanceOf(BorrowRefused)
})

test('a header naming a space that doesn’t exist is refused', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({})
  await expect(gate({ header: 'sp-nope', folder: 'ops', userId: 'u1', read: db.read })).rejects.toMatchObject({ status: 404 })
  expect(db.reads).toEqual(['sp-nope'])
})

test('the folder’s own space, or no header, runs as the own space without a lookup', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({})
  expect(await gate({ header: 'sp-ops', folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-ops')
  expect(await gate({ header: undefined, folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-ops')
  expect(await gate({ header: '  ', folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-ops')
  expect(db.reads).toEqual([])
})

test('an allowed borrow is cached briefly; a refusal is not', async () => {
  let clock = 0
  const gate = createBorrowGate(catalog, { now: () => clock })
  const rows: Record<string, CallerShows> = { 'sp-data': { tabRefs: [], widgetRefs: [] } }
  const db = spaces(rows)

  await expect(gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })).rejects.toBeInstanceOf(BorrowRefused)
  rows['sp-data'] = { tabRefs: ['view:ops/invites'], widgetRefs: [] }
  expect(await gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-data') // the new tab counts at once
  expect(await gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-data')
  expect(db.reads.length).toBe(2)

  rows['sp-data'] = { tabRefs: [], widgetRefs: [] }
  clock += 31_000
  await expect(gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })).rejects.toBeInstanceOf(BorrowRefused)
})

test('readCallerShows maps the embedded tabs and layout, and a missing space to null', async () => {
  const calls: unknown[][] = []
  const fakeDb = (row: unknown): Db => {
    const query = {
      select: (...a: unknown[]) => (calls.push(['select', ...a]), query),
      eq: (...a: unknown[]) => (calls.push(['eq', ...a]), query),
      maybeSingle: async () => ({ data: row, error: null })
    }
    // Only the query-builder calls readCallerShows makes are faked.
    return { from: (table: string) => (calls.push(['from', table]), query) } as unknown as Db
  }

  const read = readCallerShows(
    fakeDb({
      id: 'sp-data',
      tabs: [{ ref: 'view:ops/invites' }],
      space_layouts: { widgets: [{ ref: 'ops/pace' }] }
    })
  )
  expect(await read('sp-data')).toEqual({
    tabRefs: ['view:ops/invites'],
    widgetRefs: ['ops/pace']
  })
  expect(calls).toEqual([
    ['from', 'spaces'],
    ['select', 'id, parent_id, tabs(ref), space_layouts(widgets)'],
    ['eq', 'id', 'sp-data']
  ])
  expect(
    await readCallerShows(fakeDb({ id: 'sp-x', tabs: null, space_layouts: null }))('sp-x')
  ).toEqual({
    tabRefs: [],
    widgetRefs: []
  })
  expect(await readCallerShows(fakeDb(null))('sp-nope')).toBeNull()
  // A subspace names its parent.
  expect(await readCallerShows(fakeDb({ id: 'sub-1', parent_id: 'sp-data', tabs: [], space_layouts: null }))('sub-1')).toEqual({
    tabRefs: [],
    widgetRefs: [],
    parentId: 'sp-data'
  })
})

test('placed widgets only count while the widgets tab is open', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({ 'sp-data': { tabRefs: ['view:dto/explorer'], widgetRefs: ['ops/pace'] } })
  await expect(gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })).rejects.toBeInstanceOf(
    BorrowRefused
  )
})

test('an allowance is cached per person', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({ 'sp-data': { tabRefs: ['view:ops/invites'], widgetRefs: [] } })
  await gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })
  await gate({ header: 'sp-data', folder: 'ops', userId: 'u1', read: db.read })
  await gate({ header: 'sp-data', folder: 'ops', userId: 'u2', read: db.read })
  expect(db.reads).toEqual(['sp-data', 'sp-data'])
})

test('malformed layout and tab entries are skipped, not a failure', async () => {
  const row = {
    id: 'sp-data',
    tabs: [{ ref: 'widgets' }, { ref: 7 }, null],
    space_layouts: { widgets: [null, 'ops/pace', { ref: 3 }, {}, { ref: 'ops/pace' }] }
  }
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: row, error: null }) }
  // Only the query-builder calls readCallerShows makes are faked.
  const db = { from: () => query } as unknown as Db
  expect(await readCallerShows(db)('sp-data')).toEqual({ tabRefs: ['widgets'], widgetRefs: ['ops/pace'] })

  const notAList = { ...row, space_layouts: { widgets: { ref: 'ops/pace' } } }
  const query2 = { select: () => query2, eq: () => query2, maybeSingle: async () => ({ data: notAList, error: null }) }
  expect(await readCallerShows({ from: () => query2 } as unknown as Db)('sp-data')).toEqual({
    tabRefs: ['widgets'],
    widgetRefs: []
  })
})

test('a subspace that shows the folder runs as its parent, cached too', async () => {
  const gate = createBorrowGate(catalog)
  const db = spaces({ 'sub-1': { tabRefs: ['view:ops/invites'], widgetRefs: [], parentId: 'sp-data' } })
  expect(await gate({ header: 'sub-1', folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-data')
  expect(await gate({ header: 'sub-1', folder: 'ops', userId: 'u1', read: db.read })).toBe('sp-data')
  expect(db.reads).toEqual(['sub-1'])
  // Its parent's own code too.
  const own = spaces({ 'sub-1': { tabRefs: ['view:dto/explorer'], widgetRefs: [], parentId: 'sp-data' } })
  expect(await gate({ header: 'sub-1', folder: 'dto', userId: 'u1', read: own.read })).toBe('sp-data')
})

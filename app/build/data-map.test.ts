import { afterAll, beforeEach, afterEach, expect, spyOn, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { MiddlewareHandler } from 'hono'
import type { Catalog, CatalogApplet, DataUse, MemberTier } from '../lib/types'
import { createApp } from '../server/app'
import type { AuthEnv } from '../server/auth'
import { memorySpaceAccessStore } from '../server/space-access-testing'
import { scanDataMap, scanSource } from './data-map'

const names = (source: string) => scanSource(source).map(s => `${s.kind}:${s.name}`).sort()

test('finds tables, functions, collections and env names written as literals', () => {
  expect(
    names(`
      const { data } = await supabase.schema('core').from('person').select('id')
      const rows = await client
        .schema('app')
        .from("invite_partner")
        .select('*')
      await db.from(\`event\`).select()
      await supabase.schema('app').rpc('airtable_rows', { p_base: base })
      const runs = collection<Partial<Run>>('invite-button-runs')
      const briefs = () => collection('fondenradar-briefs')
      const token = process.env.TITO_TOKEN
    `)
  ).toEqual([
    'collection:fondenradar-briefs',
    'collection:invite-button-runs',
    'env:TITO_TOKEN',
    'function:airtable_rows',
    'table:event',
    'table:invite_partner',
    'table:person'
  ])
})

test('leaves out what is not a table read, and what it cannot know', () => {
  expect(
    names(`
      // old: supabase.from('legacy_table').select()
      /* collection('gone') */
      const url = 'https://example.org' // .from('in_a_comment')
      const bytes = Buffer.from('abc')
      const letters = Array.from('abc')
      await supabase.storage.from('invitations').download(path)
      await client.schema('miso').from('records').select('data')
      await db.schema('app').from(table).insert(row)
      const attendees = collection<Row>(ATTENDEE_COLLECTION)
      const key = process.env[name]
    `)
  ).toEqual([])
})

const applet = (folder: string, name: string, kind: 'view' | 'widget', extra: Partial<CatalogApplet> = {}): CatalogApplet => ({
  ref: `${folder}/${name}`,
  folder,
  name,
  kind,
  file: '',
  title: name,
  requiredEnv: [],
  ...extra
})

const catalog: Catalog = {
  spaces: [
    { id: 'sp-data', slug: 'data', folder: 'dto', previousSlugs: [], position: 0, name: 'Data', theme: {} },
    { id: 'sp-kpis', slug: 'kpis', folder: 'management', previousSlugs: [], position: 1, name: 'KPIs', theme: {}, minTier: 'manager' }
  ],
  applets: [
    applet('dto', 'people', 'view'),
    applet('dto', 'audit', 'view', { minTier: 'admin' }),
    applet('management', 'scoreboard', 'widget', { requiredEnv: ['TITO_TOKEN'] })
  ]
}

const root = mkdtempSync(join(tmpdir(), 'data-map-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function put(folder: string, rel: string, source: string) {
  const path = join(root, 'workspaces', folder, '.miso', rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, source)
}

put('dto', 'views/people.server.ts', `await db.schema('core').from('person').select()`)
put('dto', 'views/audit.server.ts', `await db.from('person').select(); await db.rpc('audit_log_list')`)
put('dto', 'views/people.server.test.ts', `await db.from('only_in_a_test').select()`)
put('management', 'lib/store.ts', `const s = collection('kpi-snapshots'); await db.from('person').select()`)
put('management', 'widgets/scoreboard.server.ts', `const s = collection('kpi-snapshots'); const hosted = process.env.MISO_HOSTED`)
const dataMap = scanDataMap(root, catalog)

test('one entry per source and space, with the views and widgets that name it', () => {
  expect(dataMap).toEqual([
    { kind: 'collection', name: 'kpi-snapshots', folder: 'management', applets: ['widget:management/scoreboard'] },
    { kind: 'env', name: 'TITO_TOKEN', folder: 'management', applets: ['widget:management/scoreboard'] },
    { kind: 'function', name: 'audit_log_list', folder: 'dto', applets: ['view:dto/audit'] },
    { kind: 'table', name: 'person', folder: 'dto', applets: ['view:dto/audit', 'view:dto/people'] },
    { kind: 'table', name: 'person', folder: 'management', applets: [] }
  ])
})

// The route: what a tier doesn't see never leaves the server.
const saved = { ...process.env }
let fetchSpy: ReturnType<typeof spyOn>
beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.test'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch)
})
afterEach(() => {
  fetchSpy.mockRestore()
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

async function mapAs(tier: MemberTier): Promise<DataUse[]> {
  const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('user', { id: 'u1', email: null, name: null, avatarUrl: null, tier, status: 'active', token: 'tok' })
    await next()
  }
  const store = memorySpaceAccessStore([])
  const app = createApp({ catalog, dataMap, modules: {}, commit: null, builtAt: '', requireUser: signedIn, spaceAccessStore: () => store })
  return (await (await app.request('/api/data-map')).json()) as DataUse[]
}

test('the map leaves out spaces and views the viewer does not see', async () => {
  expect(await mapAs('owner')).toEqual(dataMap)
  expect(await mapAs('member')).toEqual([
    { kind: 'function', name: 'audit_log_list', folder: 'dto', applets: [] },
    { kind: 'table', name: 'person', folder: 'dto', applets: ['view:dto/people'] }
  ])
})

// The hosted miso API. One Hono app, served by api/server.ts on Vercel and by
// app/dev.ts locally. Everything it stores lives in the `miso` schema of the
// shared Supabase project; the only thing baked in at build time is the
// catalog of views/widgets and the server functions they call.
import { Hono, type MiddlewareHandler } from 'hono'
import { existsSync } from 'node:fs'
import { join, normalize } from 'node:path'
import type {
  Catalog,
  ClientConfig,
  ConnectorInput,
  ConnectorPatch,
  DataUse,
  Invitation,
  MemberChange,
  MemberTier,
  RecordCollection,
  SharedRecord,
  Space,
  SpaceLayout,
  SpaceTheme,
  OrgSettings,
  Tab,
  TabRef,
  WidgetPlacement,
  Workspace
} from '../lib/types'
import { catalogWorkspace, hiddenFor, visibleCatalog, visibleWorkspace, type Hidden } from '../lib/access'
import { hasAtLeast } from '../vendor/dto-core/tier'
import { MEDIA, MEDIA_TYPES } from '../lib/media'
import { isSymbol } from '../lib/symbols'
import { forgetVerified, requireUser, type AuthEnv, type AuthedUser } from './auth'
import {
  BORROW_REFUSED_HEADER,
  BorrowRefused,
  createBorrowGate,
  readCallerShows,
  type ReadCallerShows
} from './borrow'
import { normalizeDomain, parseDomain } from './allowed-domains'
import { createConnector, deleteConnector, InputError, listConnectors, updateConnector } from './connectors'
import {
  listAllFeedback,
  listOwnFeedback,
  sendFeedback,
  setFeedbackCompleted,
  supabaseFeedbackStore,
  type FeedbackStore
} from './feedback'
import { parseInvite, parseInviteId } from './invitations'
import { assignableTiers, changeMember, deleteMember, ForbiddenError, loadMembers, supabaseMembersStore, type MembersStore } from './members'
import { hasRepairs, planRefRepairs } from './moved-refs'
import { DRAFT_ELSEWHERE, draftCall, draftRefElsewhere, NOT_YET } from './drafts'
import { registerMcp } from './mcp'
import { searchRecords, supabaseToolData } from './mcp-tools'
import { registerProposalRoutes, type ProposalRouteOptions } from './proposal-routes'
import { FileRefusal, hasSpacesVolume } from './space-files'
import { callServerFunction, RpcError, type ServerModules } from './rpc'
import { recordUsage, supabaseUsageStore, usageReport, type UsageStore } from './usage'
import { historyFeed, historyStoreFor } from './history'
import { parseDepartmentName, supabaseDepartmentsStore, type DepartmentsStore } from './departments'
import { adminsSee, createRuleCache, parseAccess, spaceAccessEntries, supabaseSpaceAccessStore, type SpaceAccessStore } from './space-access'
import { publicSupabaseUrl, publishableKey, userClient, vaultClient, type Db } from './supabase'
import { parseOrgName } from './org-name'
import { mayMakeTeam, NAME_MAX, needsWelcome, parseWelcome, selectableDepartments, supabaseWelcomeStore, type WelcomeStore } from './welcome'
import { addSamples, parseSamples, sampleImage, sampleSpaces, type SamplesOptions } from './samples'

export type AppOptions = {
  catalog: Catalog
  // The build's scan of what each space's code reads (app/build/data-map.ts).
  dataMap?: DataUse[]
  modules: ServerModules
  commit: string | null
  builtAt: string
  // A folder holding workspaces/<folder>/<media>, for streaming workspace media (fileUrl): the
  // spaces checkout locally, the copy the build ships with the function on Vercel.
  root?: string
  // Test seams: sign-in and the borrow lookup, which otherwise reach Supabase.
  requireUser?: MiddlewareHandler<AuthEnv>
  readCallerShows?: (user: AuthedUser) => ReadCallerShows
  membersStore?: (user: AuthedUser) => MembersStore
  feedbackStore?: (user: AuthedUser) => FeedbackStore
  spaceAccessStore?: (user: AuthedUser) => SpaceAccessStore
  departmentsStore?: (user: AuthedUser) => DepartmentsStore
  welcomeStore?: (user: AuthedUser) => WelcomeStore
  usageStore?: (user: AuthedUser) => UsageStore
  // GET /api/health's check; by default the database as the API itself reaches it.
  checkHealth?: () => Promise<void>
  // The Proposals routes: on where the spaces are a volume with git; test seams.
  proposals?: Omit<ProposalRouteOptions, 'catalog'> & { enabled?: boolean }
  // Sample spaces (server/samples.ts): on where the spaces are a volume with git; test seams.
  samples?: SamplesOptions & { enabled?: boolean }
}

export const HEALTH_TTL_MS = 5000

// Keys that work and a database with the shell's schema: the vault account signs in (secret and
// publishable key) and reads miso.spaces (the schema is there).
async function checkDatabase(): Promise<void> {
  const { error } = await (await vaultClient()).from('spaces').select('id').limit(1)
  if (error) throw new Error(`reading miso.spaces: ${error.message}`)
}

type SpaceRow = {
  id: string
  slug: string
  name: string
  folder: string | null
  previous_slugs: string[] | null
  position: number
  theme: Space['theme'] | null
  icon: string | null
  symbol?: string | null
  parent_id?: string | null
}
type TabRow = { id: string; space_id: string; ref: TabRef; position: number; params: Record<string, unknown> | null }
type LayoutRow = { space_id: string; widgets: WidgetPlacement[] | null; active_tab: string | null }

const toSpace = (r: SpaceRow): Space => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  folder: r.folder,
  previousSlugs: r.previous_slugs ?? [],
  position: r.position,
  theme: r.theme ?? {},
  icon: r.icon,
  symbol: r.symbol ?? null,
  parentId: r.parent_id ?? null
})
const toTab = (r: TabRow): Tab => ({ id: r.id, spaceId: r.space_id, ref: r.ref, position: r.position, params: r.params })
const toLayout = (r: LayoutRow): SpaceLayout => ({
  spaceId: r.space_id,
  widgets: r.widgets ?? [],
  activeTab: r.active_tab
})

export const SERVER_ERROR = 'Something went wrong on our side. Try again in a moment, and tell us through Feedback if it keeps happening.'

// A request body that isn't a JSON object is the caller's mistake (400), not ours (500).
async function jsonBody<T>(c: { req: { json: () => Promise<unknown> } }): Promise<Partial<T>> {
  const body = await c.req.json().catch(() => null)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new InputError('Send a JSON object.')
  return body as Partial<T>
}

// A malformed %-escape in a path is a bad address, not a server error.
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    throw new InputError('That address is not valid.')
  }
}

// More than any space holds: a tab per view in the build plus the widgets tab, or a grid's widgets.
const TABS_MAX = 500

const isString = (v: unknown): v is string => typeof v === 'string' && v.length > 0

// Font, color and corners, each a preset name (app/client/lib/theme.ts); an unknown name falls back
// to the default there, so only the shape is checked here.
function parseTheme(body: Partial<SpaceTheme>): SpaceTheme {
  const theme: SpaceTheme = {}
  for (const key of ['font', 'color', 'radius'] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !/^[a-z][a-z-]{0,23}$/.test(value)) throw new InputError(`That ${key} isn't one of the presets.`)
    theme[key] = value
  }
  return theme
}

function fail(message: string): never {
  throw new Error(message)
}

export function createApp(options: AppOptions): Hono<AuthEnv> {
  const { catalog, modules } = options
  const viewRefs = new Set(catalog.applets.filter(a => a.kind === 'view').map(a => `view:${a.ref}`))
  const widgetRefs = new Set(catalog.applets.filter(a => a.kind === 'widget').map(a => a.ref))
  const folders = new Set(catalog.spaces.map(s => s.folder))
  const callSpace = createBorrowGate(catalog)
  const callerShowsFor = options.readCallerShows ?? ((user: AuthedUser) => readCallerShows(userClient(user.token)))
  const membersFor = options.membersStore ?? ((user: AuthedUser) => supabaseMembersStore(userClient(user.token)))
  const feedbackFor = options.feedbackStore ?? ((user: AuthedUser) => supabaseFeedbackStore(userClient(user.token)))
  const spaceAccessFor = options.spaceAccessStore ?? ((user: AuthedUser) => supabaseSpaceAccessStore(userClient(user.token)))
  const departmentsFor = options.departmentsStore ?? ((user: AuthedUser) => supabaseDepartmentsStore(userClient(user.token)))
  const welcomeFor = options.welcomeStore ?? ((user: AuthedUser) => supabaseWelcomeStore(userClient(user.token), user.token, user.id))
  const usageFor = options.usageStore ?? ((user: AuthedUser) => supabaseUsageStore(userClient(user.token)))
  const ruleCache = createRuleCache()

  const app = new Hono<AuthEnv>()
  const db = (c: { get: (k: 'user') => { token: string } }): Db => userClient(c.get('user').token)

  // Spaces someone's tier doesn't see (spaces.json `minTier`, or a rule from the
  // Space access page) are left out of what they read and refused when they
  // write to them or run their code. See app/lib/access.ts.
  const rulesOf = (user: AuthedUser) => ruleCache.get(() => spaceAccessFor(user).list())
  const hiddenOf = async (user: AuthedUser) => hiddenFor(catalog, user, await rulesOf(user))
  async function guardSpace(user: AuthedUser, ...spaceIds: string[]) {
    const hidden = await hiddenOf(user)
    if (spaceIds.some(id => hidden.spaceIds.has(id))) throw new ForbiddenError("You don't have access to that space.")
  }
  // The space a tab is on. A tab that isn't there is left to the route's own 404.
  async function guardTab(user: AuthedUser, client: Db, tabId: string) {
    const { data, error } = await client.from('tabs').select('space_id').eq('id', tabId).maybeSingle<{ space_id: string }>()
    if (error) fail(error.message)
    if (data) await guardSpace(user, data.space_id)
  }
  function guardAdmin(user: AuthedUser, message = 'Only admins and owners can change who sees a space.') {
    if (!hasAtLeast(user.tier, user.status, 'admin')) throw new ForbiddenError(message)
  }

  app.onError((err, c) => {
    if (err instanceof InputError) return c.json({ error: err.message }, 400)
    if (err instanceof ForbiddenError) return c.json({ error: err.message }, 403)
    // Said to the caller as it is (space-files.ts): what to do so it works.
    if (err instanceof FileRefusal) return c.json({ error: err.message }, 409)
    if (err instanceof BorrowRefused) c.header(BORROW_REFUSED_HEADER, 'refused')
    if (err instanceof RpcError) return c.text(err.message, err.status as 400)
    // The detail (Postgres, an upstream API, a space function) can name tables or quote a token: it
    // stays in the server log, and the browser gets a sentence it can act on.
    console.error(`${c.req.method} ${c.req.path} failed:`, err)
    return c.json({ error: SERVER_ERROR }, 500)
  })

  // Public: what the browser needs to start a Supabase sign-in.
  app.get('/api/config', c => {
    const config: ClientConfig = {
      supabaseUrl: publicSupabaseUrl(),
      supabasePublishableKey: publishableKey(),
      commit: options.commit,
      builtAt: options.builtAt
    }
    // Fixed for a deployment (Vercel's CDN cache is per deployment): the edge answers it, and a
    // browser reuses it for five minutes.
    return c.json(config, 200, { 'Cache-Control': 'public, max-age=300, s-maxage=86400' })
  })

  // Public: whether this instance can serve, for `miso update` and container health checks. Only
  // ok or not: the reason goes to the server log.
  // It is public, so its answer is kept for 5 s per instance: a loop of requests costs at most one
  // database read per 5 s (callers asking at once share the one in flight).
  let health: { at: number; ok: Promise<boolean> } | null = null
  app.get('/api/health', async c => {
    if (!health || Date.now() - health.at >= HEALTH_TTL_MS) {
      const ok = (options.checkHealth ?? checkDatabase)().then(
        () => true,
        err => {
          console.error('health check failed:', err)
          return false
        }
      )
      health = { at: Date.now(), ok }
    }
    const ok = await health.ok
    return c.json({ ok }, ok ? 200 : 503, { 'Cache-Control': 'no-store' })
  })

  // Public: a sample space's picture (server/samples.ts). It ships with the shell, and an <img> sends no token.
  app.get('/api/samples/:type/image', c => {
    const image = /^[a-z0-9][a-z0-9-]{0,39}$/.test(c.req.param('type')) ? sampleImage(c.req.param('type'), options.samples?.templates) : null
    if (!image) return c.json({ error: 'No such picture.' }, 404)
    return new Response(Bun.file(image.path), { headers: { 'Content-Type': image.contentType, 'Cache-Control': 'public, max-age=3600' } })
  })

  // Connect your AI (server/mcp.ts): /api/mcp takes a member's connection token, so it goes before
  // the sign-in every other route asks for; the member is then checked the same way (verifyToken).
  registerMcp(app, { catalog, modules, hiddenOf, requireUser: options.requireUser ?? requireUser })

  app.use('/api/*', options.requireUser ?? requireUser)

  // The spaces, views and widgets this person sees. Signed-in only, and per person, so no shared
  // cache may keep it.
  app.get('/api/catalog', async c => {
    const user = c.get('user')
    return c.json(visibleCatalog(catalog, user, await rulesOf(user)), 200, { 'Cache-Control': 'private, no-store' })
  })

  app.get('/api/me', c => {
    const { token: _token, ...me } = c.get('user')
    return c.json(me)
  })

  // --- Spaces, tabs, layouts ----------------------------------------------------

  // spaces.json decides which spaces exist and their slug, folder, icon and
  // minTier (row level security reads min_tier), so the vault account writes
  // them (miso.sync_spaces): a member may not. A new space gets a widgets tab if
  // it has widgets, and its first view. Once per instance, and again when a
  // space the caller should see is missing (a reset database): a new folder in
  // spaces.json shows up after the next deploy without running the seed script.
  let synced: Promise<void> | null = null
  async function syncCatalogSpaces(): Promise<void> {
    const service = await vaultClient()
    const { data, error } = await service.rpc('sync_spaces', {
      p_spaces: catalog.spaces.map(s => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        folder: s.folder,
        previous_slugs: s.previousSlugs,
        position: s.position,
        theme: s.theme,
        icon: s.icon ?? null,
        min_tier: s.minTier ?? null,
        // Only taken when the row is new (miso.sync_spaces): a draft starts as its creator's alone.
        draft: s.draft === true,
        created_by: s.createdBy ?? null,
        // A draft copy (a proposal) is a subspace of the space it copies, shown to its author only.
        parent_id: s.draftOf ? (catalog.spaces.find(p => p.folder === s.draftOf)?.id ?? null) : null
      }))
    })
    if (error) fail(`adding spaces: ${error.message}`)
    for (const id of (data ?? []) as string[]) {
      const folder = catalog.spaces.find(s => s.id === id)?.folder
      const firstView = catalog.applets.find(a => a.folder === folder && a.kind === 'view')
      const widgets = catalog.applets.filter(a => a.folder === folder && a.kind === 'widget')
      const refs = [...(widgets.length ? ['widgets'] : []), ...(firstView ? [`view:${firstView.ref}`] : [])]
      if (refs.length) {
        const { error: tabsError } = await service
          .from('tabs')
          .upsert(refs.map((ref, position) => ({ space_id: id, ref, position })), { onConflict: 'space_id,ref', ignoreDuplicates: true })
        if (tabsError) fail(`adding tabs for ${id}: ${tabsError.message}`)
      }
      // The Widgets tab it opens on shows the space's own widgets, not an empty grid. No x/y: the
      // grid gives each the first free spot (client/lib/widget-grid.ts). A layout already there stays.
      if (widgets.length) {
        const { error: layoutError } = await service
          .from('space_layouts')
          .upsert({ space_id: id, widgets: widgets.map(w => ({ ref: w.ref })) }, { onConflict: 'space_id', ignoreDuplicates: true })
        if (layoutError) fail(`adding the widgets of ${id}: ${layoutError.message}`)
      }
    }
  }

  async function ensureCatalogSpaces(known: SpaceRow[], hidden: Hidden): Promise<boolean> {
    const have = new Set(known.map(s => s.id))
    if (synced && catalog.spaces.every(s => have.has(s.id) || hidden.spaceIds.has(s.id))) return false
    const run = (synced = syncCatalogSpaces())
    try {
      await run
    } catch (err) {
      if (synced === run) synced = null
      throw err
    }
    return true
  }

  // Tabs and widgets still pointing at a view or widget this build moved to
  // another space get the new ref (server/moved-refs.ts). Once per deploy in
  // practice: after the first pass nothing is stale. A failure only logs, so a
  // repair that loses a race never blocks the workspace from loading.
  async function repairMovedRefs(client: Db, spaces: SpaceRow[], tabs: TabRow[], layouts: LayoutRow[]): Promise<boolean> {
    const repairs = planRefRepairs(catalog.applets, spaces, tabs, layouts)
    if (!hasRepairs(repairs)) return false
    const results = await Promise.all([
      ...repairs.deleteTabs.map(id => client.from('tabs').delete().eq('id', id)),
      ...repairs.tabs.map(t => client.from('tabs').update({ ref: t.ref, space_id: t.spaceId, position: t.position }).eq('id', t.id)),
      ...repairs.layouts.map(l =>
        client.from('space_layouts').upsert({ space_id: l.spaceId, widgets: l.widgets, active_tab: l.activeTab }, { onConflict: 'space_id' })
      ),
      ...repairs.widgetTabs.map(spaceId =>
        client.from('tabs').upsert({ space_id: spaceId, ref: 'widgets', position: -1 }, { onConflict: 'space_id,ref', ignoreDuplicates: true })
      )
    ])
    for (const r of results) if (r.error) console.error(`repairing moved tabs and widgets: ${r.error.message}`)
    return true
  }

  async function loadWorkspace(client: Db, hidden: Hidden): Promise<Workspace> {
    const read = () =>
      Promise.all([
        client.from('spaces').select('*').order('position').order('name'),
        client.from('tabs').select('id, space_id, ref, position, params').order('position'),
        client.from('space_layouts').select('space_id, widgets, active_tab')
      ])
    let [spaces, tabs, layouts] = await read()
    for (const r of [spaces, tabs, layouts]) if (r.error) fail(r.error.message)
    if (await ensureCatalogSpaces((spaces.data ?? []) as SpaceRow[], hidden)) {
      ;[spaces, tabs, layouts] = await read()
    }
    const rows = [spaces.data ?? [], tabs.data ?? [], layouts.data ?? []] as [SpaceRow[], TabRow[], LayoutRow[]]
    if (await repairMovedRefs(client, ...rows)) {
      ;[spaces, tabs, layouts] = await read()
    }
    return catalogWorkspace(
      {
        spaces: ((spaces.data ?? []) as SpaceRow[]).map(toSpace),
        tabs: ((tabs.data ?? []) as TabRow[]).map(toTab),
        layouts: ((layouts.data ?? []) as LayoutRow[]).map(toLayout)
      },
      catalog
    )
  }

  app.get('/api/workspace', async c => {
    const hidden = await hiddenOf(c.get('user'))
    return c.json(visibleWorkspace(await loadWorkspace(db(c), hidden), hidden))
  })

  // A space's name and symbol are organisation settings (Settings page): admins and owners only.
  // Either or both in one call; `symbol: null` goes back to the default icon. The look is the
  // organisation's (PUT /api/settings/theme), not a space's.
  app.patch('/api/spaces/:id', async c => {
    guardAdmin(c.get('user'), 'Only admins and owners can edit a space.')
    await guardSpace(c.get('user'), c.req.param('id'))
    const body = await jsonBody<{ name?: unknown; symbol?: unknown }>(c)
    const hasName = body.name !== undefined
    const hasSymbol = body.symbol !== undefined
    if (!hasName && !hasSymbol) throw new InputError('Send a name, a symbol or both.')
    if (hasName && (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(body.name))) {
      throw new InputError(`A space needs a name of 1 to ${NAME_MAX} characters, on one line.`)
    }
    if (hasSymbol && body.symbol !== null && !isSymbol(body.symbol)) throw new InputError('Pick a symbol from the list.')
    // miso.edit_space checks the caller again; members have no direct update on miso.spaces.
    const { data, error } = await db(c).rpc('edit_space', {
      p_space: c.req.param('id'),
      p_name: hasName ? (body.name as string).trim() : null,
      p_symbol: hasSymbol ? (body.symbol ?? '') : null
    })
    if (error?.code === 'P0002') return c.json({ error: 'No such space.' }, 404)
    if (error?.code === '42501') throw new ForbiddenError('Only admins and owners can edit a space.')
    if (error) fail(error.message)
    return data ? c.json(toSpace(data as SpaceRow)) : c.json({ error: 'No such space.' }, 404)
  })

  // A new top-level space with no folder (Settings → Organisation), admins and owners only. The
  // database checks the caller again and picks the id and slug (miso.create_space). It has no tabs
  // until someone opens a view in it.
  app.post('/api/spaces', async c => {
    guardAdmin(c.get('user'), 'Only admins and owners can add a space.')
    const { name, symbol } = await jsonBody<{ name: unknown; symbol: unknown }>(c)
    if (typeof name !== 'string' || !name.trim() || name.trim().length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new InputError(`A space needs a name of 1 to ${NAME_MAX} characters, on one line.`)
    }
    if (symbol != null && !isSymbol(symbol)) throw new InputError('Pick a symbol from the list.')
    const { data, error } = await db(c).rpc('create_space', { p_name: name.trim(), p_symbol: symbol ?? null })
    if (error?.code === '42501') throw new ForbiddenError('Only admins and owners can add a space.')
    if (error?.code === '22023') throw new InputError(`A space needs a name of 1 to ${NAME_MAX} characters, on one line.`)
    if (error) fail(error.message)
    return c.json(toSpace(data as SpaceRow))
  })

  // --- Organisation settings ---------------------------------------------------

  // The organisation's look and workspace name, for everyone signed in: the app applies them on every page.
  app.get('/api/settings', async c => {
    const { data, error } = await db(c).from('org_settings').select('theme, name').maybeSingle<{ theme: SpaceTheme | null; name: string | null }>()
    if (error) fail(`reading settings: ${error.message}`)
    return c.json({ theme: data?.theme ?? {}, name: data?.name ?? null } satisfies OrgSettings)
  })

  app.put('/api/settings/theme', async c => {
    guardAdmin(c.get('user'), 'Only admins and owners can change the look of the app.')
    const theme = parseTheme(await jsonBody<SpaceTheme>(c))
    const { data, error } = await db(c).from('org_settings').update({ theme }).eq('id', true).select('theme, name').maybeSingle<OrgSettings>()
    if (error) fail(`saving the theme: ${error.message}`)
    if (!data) throw new ForbiddenError('Only admins and owners can change the look of the app.')
    return c.json({ theme: data.theme, name: data.name } satisfies OrgSettings)
  })

  // The name at the top of the sidebar; null shows the product name.
  app.put('/api/settings/name', async c => {
    guardAdmin(c.get('user'), 'Only admins and owners can change the workspace name.')
    const name = parseOrgName(await jsonBody<{ name: string | null }>(c))
    const { data, error } = await db(c).from('org_settings').update({ name }).eq('id', true).select('theme, name').maybeSingle<OrgSettings>()
    if (error) fail(`saving the workspace name: ${error.message}`)
    if (!data) throw new ForbiddenError('Only admins and owners can change the workspace name.')
    return c.json({ theme: data.theme, name: data.name } satisfies OrgSettings)
  })

  // Subspaces (a top-level space's child spaces), owners only for now. The database checks it again
  // (miso.create_subspace, miso.delete_subspace) and hides them from everyone else (miso.sees_space).
  const guardOwner = (user: AuthedUser) => {
    if (!hasAtLeast(user.tier, user.status, 'owner')) throw new ForbiddenError('Only owners can make or delete subspaces.')
  }
  const subspaceFailure = (error: { code?: string; message: string }): never => {
    if (error.code === '42501') throw new ForbiddenError('Only owners can make or delete subspaces.')
    if (error.code === 'P0002') throw new InputError('There is no such space, or it is a subspace itself.')
    if (error.code === '22023') throw new InputError(`A subspace needs a name of 1 to ${NAME_MAX} characters.`)
    fail(error.message)
  }

  app.post('/api/spaces/:id/subspaces', async c => {
    const user = c.get('user')
    guardOwner(user)
    const { name } = await jsonBody<{ name: string }>(c)
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (!trimmed || trimmed.length > NAME_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new InputError(`A subspace needs a name of 1 to ${NAME_MAX} characters, on one line.`)
    await guardSpace(user, c.req.param('id'))
    const { data, error } = await db(c).rpc('create_subspace', { p_parent: c.req.param('id'), p_name: trimmed })
    if (error) subspaceFailure(error)
    return c.json(toSpace(data as SpaceRow))
  })

  app.delete('/api/spaces/:id', async c => {
    guardOwner(c.get('user'))
    const { error } = await db(c).rpc('delete_subspace', { p_space: c.req.param('id') })
    if (error) subspaceFailure(error)
    return c.json({ ok: true })
  })

  app.post('/api/spaces/:id/tabs', async c => {
    const spaceId = c.req.param('id')
    const { ref, params } = await jsonBody<{ ref: TabRef; params?: Record<string, unknown> }>(c)
    if (!isString(ref) || (ref !== 'widgets' && !viewRefs.has(ref))) throw new InputError(`There's no view ${ref} in this build.`)
    if (draftRefElsewhere(catalog, ref, spaceId)) throw new ForbiddenError(DRAFT_ELSEWHERE)
    await guardSpace(c.get('user'), spaceId)
    if ((await hiddenOf(c.get('user'))).viewRefs.has(ref)) throw new ForbiddenError("Your role doesn't include that view.")
    const client = db(c)
    const findTab = () => client.from('tabs').select('*').eq('space_id', spaceId).eq('ref', ref).maybeSingle<TabRow>()
    const { data: existing } = await findTab()
    if (existing) {
      if (params !== undefined) {
        const { error } = await client.from('tabs').update({ params }).eq('id', existing.id)
        if (error) fail(error.message)
      }
      return c.json(toTab({ ...existing, params: params ?? existing.params }))
    }
    const { data: last } = await client
      .from('tabs')
      .select('position')
      .eq('space_id', spaceId)
      .order('position', { ascending: false })
      .limit(1)
    const position = ((last?.[0]?.position as number | undefined) ?? -1) + 1
    const { data, error } = await client
      .from('tabs')
      .insert({ space_id: spaceId, ref, position, params: params ?? null })
      .select('*')
      .single<TabRow>()
    // Opened twice at once (a double click, two windows): the other request made the tab.
    if (error?.code === '23505') {
      const { data: made, error: findError } = await findTab()
      if (findError || !made) fail(findError?.message ?? error.message)
      return c.json(toTab(made))
    }
    if (error) fail(error.message)
    return c.json(toTab(data))
  })

  app.patch('/api/tabs/:id', async c => {
    const body = await jsonBody<{ params?: Record<string, unknown> | null }>(c)
    const client = db(c)
    await guardTab(c.get('user'), client, c.req.param('id'))
    const { data, error } = await client
      .from('tabs')
      .update({ params: body.params ?? null })
      .eq('id', c.req.param('id'))
      .select('*')
      .maybeSingle<TabRow>()
    if (error) fail(error.message)
    return data ? c.json(toTab(data)) : c.json({ error: 'No such tab.' }, 404)
  })

  app.delete('/api/tabs/:id', async c => {
    const client = db(c)
    await guardTab(c.get('user'), client, c.req.param('id'))
    const { error } = await client.from('tabs').delete().eq('id', c.req.param('id'))
    if (error) fail(error.message)
    return c.json({ ok: true })
  })

  app.post('/api/tabs/:id/move', async c => {
    const { spaceId } = await jsonBody<{ spaceId: string }>(c)
    if (!isString(spaceId)) throw new InputError('Say which space to move the tab to.')
    const client = db(c)
    await guardSpace(c.get('user'), spaceId)
    await guardTab(c.get('user'), client, c.req.param('id'))
    const { data: tab, error: tabError } = await client.from('tabs').select('ref').eq('id', c.req.param('id')).maybeSingle<{ ref: string }>()
    if (tabError) fail(tabError.message)
    if (tab && draftRefElsewhere(catalog, tab.ref, spaceId)) throw new ForbiddenError(DRAFT_ELSEWHERE)
    const { data, error } = await client.rpc('move_tab', { p_tab: c.req.param('id'), p_space: spaceId })
    if (error) fail(error.message)
    return c.json(toTab(data as TabRow))
  })

  app.put('/api/spaces/:id/tabs/order', async c => {
    const { ids } = await jsonBody<{ ids: string[] }>(c)
    if (!Array.isArray(ids) || ids.length > TABS_MAX || !ids.every(isString) || new Set(ids).size !== ids.length) {
      throw new InputError('Send the tab ids of this space in their new order.')
    }
    const client = db(c)
    const spaceId = c.req.param('id')
    await guardSpace(c.get('user'), spaceId)
    // Only this space's tabs, and only those that move: an id the browser holds for a tab still on
    // its way, or one a teammate just closed, is skipped rather than failing the whole order.
    const { data: current, error: readError } = await client.from('tabs').select('id, position').eq('space_id', spaceId)
    if (readError) fail(`reordering tabs: ${readError.message}`)
    const positions = new Map(((current ?? []) as { id: string; position: number }[]).map(t => [t.id, t.position]))
    const moves = ids.map((id, position) => ({ id, position })).filter(m => positions.has(m.id) && positions.get(m.id) !== m.position)
    const results = await Promise.all(
      moves.map(({ id, position }) => client.from('tabs').update({ position }).eq('id', id).eq('space_id', spaceId))
    )
    for (const r of results) if (r.error) fail(`reordering tabs: ${r.error.message}`)
    return c.json({ ok: true })
  })

  app.put('/api/spaces/:id/layout', async c => {
    const body = await jsonBody<{ widgets?: WidgetPlacement[]; activeTab?: string | null }>(c)
    const spaceId = c.req.param('id')
    await guardSpace(c.get('user'), spaceId)
    const row: Record<string, unknown> = { space_id: spaceId }
    if (body.widgets !== undefined) {
      // A widget whose file was deleted stays on saved grids; drop it, or every later save of this grid fails.
      if (!Array.isArray(body.widgets) || body.widgets.length > TABS_MAX) throw new InputError('Send the widgets as a list.')
      const widgets = (body.widgets as unknown[]).filter(
        (w): w is WidgetPlacement => typeof w === 'object' && w !== null && widgetRefs.has((w as WidgetPlacement).ref)
      )
      if (widgets.some(w => draftRefElsewhere(catalog, w.ref, spaceId))) throw new ForbiddenError(DRAFT_ELSEWHERE)
      const hidden = (await hiddenOf(c.get('user'))).widgetRefs
      if (widgets.some(w => hidden.has(w.ref))) throw new ForbiddenError("Your role doesn't include one of those widgets.")
      // The viewer was never sent widgets above their tier, so keep the ones
      // already on this grid rather than letting their save drop them.
      let kept: WidgetPlacement[] = []
      if (hidden.size) {
        const { data: current, error } = await db(c).from('space_layouts').select('widgets').eq('space_id', spaceId).maybeSingle<{ widgets: WidgetPlacement[] | null }>()
        if (error) fail(error.message)
        kept = (current?.widgets ?? []).filter(w => hidden.has(w.ref))
      }
      const int = (n: unknown, min: number) => (typeof n === 'number' && Number.isInteger(n) && n >= min && n < 1000 ? n : undefined)
      row.widgets = [...kept, ...widgets.map(w => {
        const x = int(w.x, 0)
        const y = int(w.y, 0)
        if (x === undefined || y === undefined) return { ref: w.ref }
        const grid = int(w.grid, 1)
        return { ref: w.ref, x, y, w: int(w.w, 1) ?? 1, h: int(w.h, 1) ?? 1, ...(grid ? { grid } : {}) }
      })]
    }
    if (body.activeTab !== undefined) row.active_tab = body.activeTab
    const { data, error } = await db(c).from('space_layouts').upsert(row, { onConflict: 'space_id' }).select('*').single<LayoutRow>()
    if (error) fail(error.message)
    return c.json(toLayout(data))
  })

  // Take a widget off one space's grid and put it at the end of another's.
  app.post('/api/spaces/:id/widgets/move', async c => {
    const from = c.req.param('id')
    const { ref, spaceId: to } = await jsonBody<{ ref: string; spaceId: string }>(c)
    if (!isString(ref) || !widgetRefs.has(ref)) throw new InputError(`Unknown widget ${ref}.`)
    if (!isString(to)) throw new InputError('Say which space to move the widget to.')
    if (draftRefElsewhere(catalog, ref, to)) throw new ForbiddenError(DRAFT_ELSEWHERE)
    await guardSpace(c.get('user'), from, to)
    if ((await hiddenOf(c.get('user'))).widgetRefs.has(ref)) throw new ForbiddenError("Your role doesn't include that widget.")
    // One transaction that locks both layouts and gives the target a widgets tab.
    const { error } = await db(c).rpc('move_widget', { p_from: from, p_to: to, p_ref: ref })
    if (error) fail(error.message)
    return c.json({ ok: true })
  })

  // --- Space access -------------------------------------------------------------

  // The rules themselves, for everyone: the browser keeps hidden spaces' views
  // and widgets out of its add menus with them (app/client/lib/queries.ts).
  app.get('/api/space-access', async c => c.json(await rulesOf(c.get('user'))))

  // The Space access page: every space for owners; for admins, the spaces admins see (the only
  // ones they may change; row level security hides the rest).
  app.get('/api/space-access/spaces', async c => {
    const user = c.get('user')
    guardAdmin(user)
    ruleCache.forget()
    const rules = await rulesOf(user)
    // By tier only: an admin named on an owners-only space still can't change it.
    const workspace = await loadWorkspace(db(c), hiddenFor(catalog, { tier: user.tier, status: user.status }, rules))
    // Subspaces are owners-only for now, and a draft is its author's until it is published, so
    // neither has a rule to set.
    const drafts = new Set(catalog.spaces.filter(s => s.draft).map(s => s.id))
    return c.json(spaceAccessEntries(workspace.spaces.filter(s => !s.parentId && !drafts.has(s.id)), catalog, rules))
  })

  // { tiers, departments, people } sets who sees the space; { tiers: null } goes back to its default.
  app.put('/api/space-access/:spaceId', async c => {
    const user = c.get('user')
    guardAdmin(user)
    const access = parseAccess(await c.req.json<unknown>().catch(() => null))
    if (catalog.spaces.some(s => s.id === c.req.param('spaceId') && s.draft)) {
      throw new ForbiddenError("A draft is its author's until it is published, so it has no access rule to set.")
    }
    const tiers = access?.tiers ?? null
    if (user.tier !== 'owner' && !adminsSee(catalog, await rulesOf(user), c.req.param('spaceId'))) {
      throw new ForbiddenError("Only an owner can change who sees a space admins don't see.")
    }
    if (user.tier !== 'owner' && tiers && !tiers.includes('admin')) {
      throw new ForbiddenError('Only an owner can take admins off a space.')
    }
    const store = spaceAccessFor(user)
    if (access === null) await store.reset(c.req.param('spaceId'))
    else await store.set(c.req.param('spaceId'), access)
    ruleCache.forget()
    return c.json({ ok: true })
  })

  // --- Departments --------------------------------------------------------------

  // Admins and owners keep departments on the Members page. A change can change
  // who a rule reaches, so each one drops the cached rules.
  const DEPARTMENTS_ADMIN = 'Only admins and owners can change departments.'
  // Only an owner changes who is in, or deletes, a department that a rule leaving admins out names:
  // otherwise an admin could join it and see the space (the departments migration says the same).
  const changeDepartments = async (
    c: { get: (k: 'user') => AuthedUser },
    id: string,
    change: (store: DepartmentsStore) => Promise<void>
  ) => {
    const user = c.get('user')
    guardAdmin(user, DEPARTMENTS_ADMIN)
    if (user.tier !== 'owner' && (await rulesOf(user)).some(r => r.departments?.includes(id) && !r.tiers.includes('admin'))) {
      throw new ForbiddenError("Only an owner can change a department that opens a space admins don't see.")
    }
    await change(departmentsFor(user))
    ruleCache.forget()
  }

  app.get('/api/departments', async c => {
    guardAdmin(c.get('user'), DEPARTMENTS_ADMIN)
    return c.json(await departmentsFor(c.get('user')).list())
  })

  app.post('/api/departments', async c => {
    const user = c.get('user')
    guardAdmin(user, DEPARTMENTS_ADMIN)
    const name = parseDepartmentName(await c.req.json<unknown>().catch(() => null))
    return c.json(await departmentsFor(user).create(name), 201)
  })

  app.patch('/api/departments/:id', async c => {
    const user = c.get('user')
    guardAdmin(user, DEPARTMENTS_ADMIN)
    // A name opens nothing, so any admin renames any department.
    const name = parseDepartmentName(await c.req.json<unknown>().catch(() => null))
    await departmentsFor(user).rename(c.req.param('id'), name)
    return c.json({ ok: true })
  })

  app.delete('/api/departments/:id', async c => {
    await changeDepartments(c, c.req.param('id'), store => store.remove(c.req.param('id')))
    return c.json({ ok: true })
  })

  app.put('/api/departments/:id/members/:userId', async c => {
    await changeDepartments(c, c.req.param('id'), store => store.addMember(c.req.param('id'), c.req.param('userId')))
    return c.json({ ok: true })
  })

  app.delete('/api/departments/:id/members/:userId', async c => {
    await changeDepartments(c, c.req.param('id'), store => store.removeMember(c.req.param('id'), c.req.param('userId')))
    return c.json({ ok: true })
  })

  // --- Welcome ------------------------------------------------------------------

  // First sign-in: a name and department(s) (server/welcome.ts). Everyone reads departments;
  // the ones a person may put themself in leave out those that open a space admins don't see.
  app.get('/api/welcome', async c => {
    const user = c.get('user')
    const store = welcomeFor(user)
    const [departments, rules, welcomed] = await Promise.all([departmentsFor(user).list(), rulesOf(user), store.welcomed()])
    const needed = needsWelcome(user, departments, welcomed)
    // The first owner: an owner at their own first sign-in.
    const samples = needed && user.tier === 'owner' && samplesOn && sampleSpaces(options.samples).some(s => !s.added)
    const position = needed && (await store.hasPosition())
    return c.json({ needed, name: user.name, departments: selectableDepartments(departments, rules), newTeam: mayMakeTeam(user), samples, position })
  })

  app.post('/api/welcome', async c => {
    const user = c.get('user')
    if (user.status !== 'active' || user.tier === null) throw new ForbiddenError('Your account needs to be active first. Ask an admin.')
    const [departments, rules] = await Promise.all([departmentsFor(user).list(), rulesOf(user)])
    const selectable = new Set(selectableDepartments(departments, rules).map(d => d.id))
    const { name, departmentIds, position, newTeam } = parseWelcome(await c.req.json<unknown>().catch(() => null), selectable)
    if (newTeam && !mayMakeTeam(user)) throw new ForbiddenError('Only admins and owners can make a team. Pick yours from the list.')
    const store = welcomeFor(user)
    // Departments are picked once, at first sign-in; welcome_self refuses later joins too.
    if ((departmentIds.length || newTeam) && (await store.welcomed())) throw new ForbiddenError('Ask an admin to change your departments.')
    await store.saveName(name)
    if (position && (await store.hasPosition())) await store.savePosition(position)
    forgetVerified(user.token)
    if (newTeam) {
      // A team of that name already there is joined, not made twice.
      const same = departments.find(d => d.name.toLowerCase() === newTeam.toLowerCase())
      const team = same ?? (await departmentsFor(user).create(newTeam))
      if (!departmentIds.includes(team.id)) departmentIds.push(team.id)
    }
    const joined = (await store.join(name, departmentIds)) === true
    // Joining changes who a rule reaches.
    if (joined) ruleCache.forget()
    return c.json({ name, joined })
  })

  // --- Sample spaces --------------------------------------------------------------

  // Starter templates an admin adds as the company's spaces (server/samples.ts). Off where the
  // spaces aren't a volume: there a build can't take a new space, so the app never offers it.
  const samplesOn = options.samples?.enabled ?? hasSpacesVolume()
  const SAMPLES_ADMIN = 'Only admins and owners can add sample spaces.'

  app.get('/api/samples', c => {
    guardAdmin(c.get('user'), SAMPLES_ADMIN)
    return c.json({ available: samplesOn, spaces: samplesOn ? sampleSpaces(options.samples) : [] })
  })

  app.post('/api/samples', async c => {
    const user = c.get('user')
    guardAdmin(user, SAMPLES_ADMIN)
    if (!samplesOn) throw new ForbiddenError("This install can't add spaces from the app. Add them with `miso template add`.")
    const types = parseSamples(await c.req.json<unknown>().catch(() => null), sampleSpaces(options.samples))
    const result = await addSamples(types, { name: user.name, email: user.email }, options.samples)
    if (result.status === 'put back') return c.json({ error: `The sample spaces didn't build, so nothing was added. ${result.errors}`.slice(0, 2000) }, 409)
    return c.json({ added: types })
  })


  // --- Connectors -------------------------------------------------------------

  // Everyone sees which connectors there are (never their values); only admins
  // and owners change them (row level security says the same).
  const CONNECTORS_ADMIN = 'Only admins and owners can change connectors.'

  app.get('/api/connectors', async c => c.json(await listConnectors(db(c))))

  app.post('/api/connectors', async c => {
    guardAdmin(c.get('user'), CONNECTORS_ADMIN)
    const input = (await jsonBody<ConnectorInput>(c)) as ConnectorInput
    return c.json(await createConnector(db(c), input), 201)
  })

  app.patch('/api/connectors/:id', async c => {
    guardAdmin(c.get('user'), CONNECTORS_ADMIN)
    const patch = (await jsonBody<ConnectorPatch>(c)) as ConnectorPatch
    const connector = await updateConnector(db(c), c.req.param('id'), patch)
    return connector ? c.json(connector) : c.json({ error: 'No such connector.' }, 404)
  })

  app.delete('/api/connectors/:id', async c => {
    guardAdmin(c.get('user'), CONNECTORS_ADMIN)
    const deleted = await deleteConnector(db(c), c.req.param('id'))
    return deleted ? c.json({ ok: true }) : c.json({ error: 'No such connector.' }, 404)
  })

  // --- Allowed domains ----------------------------------------------------------

  // New sign-ups with these email domains get in as members (server/allowed-domains.ts). Everyone
  // reads the list; only admins and owners change it (row level security says the same).
  const DOMAINS_ADMIN = 'Only admins and owners can change which domains get in.'

  app.get('/api/allowed-domains', async c => {
    const { data, error } = await db(c).from('allowed_domains').select('domain').order('domain')
    if (error) fail(`reading allowed domains: ${error.message}`)
    return c.json((data as { domain: string }[]).map(r => r.domain))
  })

  app.post('/api/allowed-domains', async c => {
    guardAdmin(c.get('user'), DOMAINS_ADMIN)
    const domain = parseDomain((await jsonBody<{ domain: string }>(c)).domain)
    const { error } = await db(c).from('allowed_domains').insert({ domain })
    if (error?.code === '23505') throw new InputError(`${domain} is already on the list.`)
    if (error?.code === '42501') throw new ForbiddenError(DOMAINS_ADMIN)
    if (error) fail(`adding an allowed domain: ${error.message}`)
    return c.json({ domain }, 201)
  })

  app.delete('/api/allowed-domains/:domain', async c => {
    guardAdmin(c.get('user'), DOMAINS_ADMIN)
    const domain = normalizeDomain(c.req.param('domain'))
    const { data, error } = await db(c).from('allowed_domains').delete().eq('domain', domain).select('domain')
    if (error) fail(`removing an allowed domain: ${error.message}`)
    return data?.length ? c.json({ ok: true }) : c.json({ error: `${domain} isn't on the list.` }, 404)
  })

  // --- Invites --------------------------------------------------------------------

  // Admins and owners invite an address at a role (server/invitations.ts); the sign-up trigger lets
  // it in at that role. The list holds email addresses, so only admins and owners read it (row
  // level security says the same).
  const INVITES_ADMIN = 'Only admins and owners can invite people.'
  type InviteRow = { id: string; email: string; tier: MemberTier; created_at: string; expires_at: string }
  const INVITE_COLUMNS = 'id, email, tier, created_at, expires_at'
  const toInvitation = (r: InviteRow): Invitation => ({ id: r.id, email: r.email, tier: r.tier, createdAt: r.created_at, expiresAt: r.expires_at })

  app.get('/api/invitations', async c => {
    guardAdmin(c.get('user'), INVITES_ADMIN)
    const { data, error } = await db(c)
      .from('invitations')
      .select(INVITE_COLUMNS)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    if (error) fail(`reading invites: ${error.message}`)
    return c.json((data as InviteRow[]).map(toInvitation))
  })

  app.post('/api/invitations', async c => {
    const user = c.get('user')
    guardAdmin(user, INVITES_ADMIN)
    const { email, tier } = parseInvite(await jsonBody(c), assignableTiers(user))
    // The sign-up trigger only sees new accounts: someone already here gets a role in the list.
    const { data: existing, error: readError } = await db(c)
      .schema('app')
      .from('app_user')
      .select('user_id')
      .ilike('email', email.replace(/[\\%_]/g, '\\$&'))
      .limit(1)
    if (readError) fail(`checking for an account: ${readError.message}`)
    if (existing?.length) throw new InputError(`${email} already has an account. Give them a role in the list below.`)
    // Inviting again replaces the old invite, expired or not, with a fresh 14 days.
    const { error: revokeError } = await db(c)
      .from('invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('email', email)
      .is('accepted_at', null)
      .is('revoked_at', null)
    if (revokeError) fail(`replacing an invite: ${revokeError.message}`)
    const { data, error } = await db(c).from('invitations').insert({ email, tier }).select(INVITE_COLUMNS).single<InviteRow>()
    if (error?.code === '23505') throw new InputError(`${email} was just invited by someone else.`)
    if (error?.code === '42501') throw new ForbiddenError(INVITES_ADMIN)
    if (error) fail(`inviting: ${error.message}`)
    return c.json(toInvitation(data), 201)
  })

  app.delete('/api/invitations/:id', async c => {
    guardAdmin(c.get('user'), INVITES_ADMIN)
    const id = parseInviteId(c.req.param('id'))
    const { data, error } = await db(c)
      .from('invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .select('id')
    if (error) fail(`revoking an invite: ${error.message}`)
    return data?.length ? c.json({ ok: true }) : c.json({ error: 'That invite is already used or revoked.' }, 404)
  })

  // --- Members and activity -------------------------------------------------------

  app.get('/api/members', async c => c.json(await loadMembers(membersFor(c.get('user')), c.get('user').id)))

  app.patch('/api/members/:id', async c => {
    const user = c.get('user')
    const change = (await jsonBody<MemberChange>(c)) as MemberChange
    return c.json(await changeMember(membersFor(user), user.id, c.req.param('id'), change))
  })

  // Deletes their account for good (app.member_erase); the page asks first.
  app.delete('/api/members/:id', async c => {
    const user = c.get('user')
    await deleteMember(membersFor(user), user.id, c.req.param('id'))
    return c.json({ ok: true })
  })

  // Called by every signed-in browser; the database keeps one timestamp per person.
  app.post('/api/activity', async c => {
    await membersFor(c.get('user')).recordActivity()
    return c.body(null, 204)
  })

  // --- Usage analytics ------------------------------------------------------------

  // Every signed-in browser reports what it opens and does, in batches (client/lib/usage.ts).
  // Events this build doesn't know, or in spaces the sender doesn't see, are dropped.
  app.post('/api/usage', async c => {
    const user = c.get('user')
    const body = await c.req.json<unknown>().catch(() => null)
    await recordUsage(usageFor(user), body, catalog, await hiddenOf(user))
    return c.body(null, 204)
  })

  // The Usage page: admins and owners, counting only the spaces and views they see.
  app.get('/api/usage/report', async c => {
    const user = c.get('user')
    const query = { days: c.req.query('days'), tz: c.req.query('tz') }
    return c.json(await usageReport(usageFor(user), user, await hiddenOf(user), query), 200, { 'Cache-Control': 'no-store' })
  })

  // --- Version history and activity -----------------------------------------------

  // The activity feed: changes to shared data, tabs and spaces, newest first, only in spaces the
  // caller sees (server/history.ts). ?space= one space, ?before= the next page, ?limit= up to 100.
  app.get('/api/history', async c => {
    const user = c.get('user')
    const query = { space: c.req.query('space'), before: c.req.query('before'), limit: c.req.query('limit') }
    return c.json(await historyFeed(historyStoreFor(user), catalog, await hiddenOf(user), query), 200, { 'Cache-Control': 'no-store' })
  })

  // --- Feedback -------------------------------------------------------------------

  // Anyone signed in sends feedback and reads back their own; owners and admins
  // read all of it and tick issues off (server/feedback.ts, RLS in miso 0065).
  app.post('/api/feedback', async c => {
    const body = await c.req.json<unknown>().catch(() => null)
    return c.json(await sendFeedback(feedbackFor(c.get('user')), body), 201)
  })

  app.get('/api/feedback/mine', async c => {
    const user = c.get('user')
    return c.json(await listOwnFeedback(feedbackFor(user), user.id))
  })

  app.get('/api/feedback', async c => {
    const user = c.get('user')
    return c.json(await listAllFeedback(feedbackFor(user), user))
  })

  app.patch('/api/feedback/:id', async c => {
    const user = c.get('user')
    const body = await c.req.json<unknown>().catch(() => null)
    return c.json(await setFeedbackCompleted(feedbackFor(user), user, c.req.param('id'), body))
  })

  // --- Shared records -----------------------------------------------------------

  // Records of a space the caller doesn't see are left out: here, and by row
  // level security (miso.sees_space), which also covers the counts.
  app.get('/api/records', async c => {
    // Counted in the database: a plain select stops at PostgREST's max_rows (1000).
    const { data, error } = await db(c).rpc('record_collections')
    if (error) fail(error.message)
    const rows = (data ?? []) as { name: string; count: number; updated_at: string }[]
    return c.json(rows.map((r): RecordCollection => ({ name: r.name, count: Number(r.count), updatedAt: r.updated_at })))
  })

  // Full-text search over the records the caller sees: the search_records tool, for views. Not
  // under /api/records/, where it would hide a collection named "search".
  app.get('/api/search/records', async c => {
    const q = (c.req.query('q') ?? '').trim()
    const limit = Number(c.req.query('limit') ?? 20)
    if (!q || q.length > 200) throw new InputError('Search for 1 to 200 characters.')
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new InputError('Ask for 1 to 50 records.')
    return c.json(await searchRecords(supabaseToolData(db(c)), await hiddenOf(c.get('user')), q, limit))
  })

  app.get('/api/records/:collection', async c => {
    const limit = Math.min(Number(c.req.query('limit') ?? 200) || 200, 1000)
    const hidden = [...(await hiddenOf(c.get('user'))).spaceIds]
    let query = db(c).from('records').select('collection, key, data, space_id, updated_at').eq('collection', c.req.param('collection'))
    if (hidden.length) query = query.or(`space_id.is.null,space_id.not.in.(${hidden.map(id => JSON.stringify(id)).join(',')})`)
    const { data, error } = await query.order('updated_at', { ascending: false }).limit(limit)
    if (error) fail(error.message)
    const records: SharedRecord[] = ((data ?? []) as { collection: string; key: string; data: unknown; space_id: string | null; updated_at: string }[]).map(r => ({
      collection: r.collection,
      key: r.key,
      data: r.data,
      spaceId: r.space_id,
      updatedAt: r.updated_at
    }))
    return c.json(records)
  })

  // What each space's code reads, for the Data map page. Spaces the caller
  // doesn't see are left out here, so their names never reach the browser.
  app.get('/api/data-map', async c => {
    const hidden = await hiddenOf(c.get('user'))
    const hiddenApplet = (key: string) =>
      key.startsWith('widget:') ? hidden.widgetRefs.has(key.slice('widget:'.length)) : hidden.viewRefs.has(key)
    return c.json(
      (options.dataMap ?? [])
        .filter(use => !hidden.folders.has(use.folder))
        .map((use): DataUse => ({ ...use, applets: use.applets.filter(key => !hiddenApplet(key)) }))
    )
  })

  // --- Server functions ---------------------------------------------------------

  app.post('/api/rpc/:folder/*', async c => {
    const folder = c.req.param('folder')
    if (!folders.has(folder)) return c.text(`No space folder "${folder}".`, 404)
    const rest = c.req.path.slice(`/api/rpc/${folder}/`.length).split('/').map(decodeSegment)
    const fn = rest.pop()
    const moduleKey = rest.join('/')
    if (!fn || !moduleKey) return c.text('Expected /api/rpc/<folder>/<module>/<function>.', 400)
    const user = c.get('user')
    // Neither a hidden space's code nor another folder's code running as that
    // space (which would get its connectors).
    const hidden = await hiddenOf(user)
    const header = c.req.header('x-miso-space')?.trim()
    if (hidden.folders.has(folder) || (header && hidden.spaceIds.has(header))) {
      return c.text("You don't have access to this space.", 403)
    }
    // A draft's own server code doesn't run (drafts.ts); an unchanged module runs as the live space.
    const draft = draftCall(catalog, folder, moduleKey)
    if (draft === 'refuse') return c.text(NOT_YET, 403)
    if (draft && hidden.folders.has(draft.folder)) return c.text("You don't have access to this space.", 403)
    if (draft) {
      const text = await callServerFunction({ modules, folder: draft.folder, moduleKey, fn, spaceId: draft.spaceId, body: await c.req.text(), caller: user })
      return c.body(text, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    }
    // The space displaying the applet, if it may run this folder's code (a subspace runs as its
    // parent); see borrow.ts.
    const spaceId = await callSpace({
      header,
      folder,
      userId: user.id,
      // Built only when the gate needs a lookup.
      read: spaceId => callerShowsFor(user)(spaceId)
    })
    const text = await callServerFunction({ modules, folder, moduleKey, fn, spaceId, body: await c.req.text(), caller: user })
    return c.body(text, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  })

  // --- Workspace media (fileUrl) --------------------------------------------------

  app.get('/api/files/:folder/*', async c => {
    const folder = c.req.param('folder')
    if (!options.root || !folders.has(folder) || (await hiddenOf(c.get('user'))).folders.has(folder)) return c.text('Not found', 404)
    const rel = normalize(c.req.path.slice(`/api/files/${folder}/`.length).split('/').map(decodeSegment).join('/'))
    if (rel.startsWith('..') || rel.split('/').some(p => p.startsWith('.')) || !MEDIA.test(rel)) {
      return c.text('Not found', 404)
    }
    const path = join(options.root, 'workspaces', folder, rel)
    if (!existsSync(path)) return c.text('Not found', 404)
    const ext = rel.split('.').pop()!.toLowerCase()
    return new Response(Bun.file(path), {
      headers: {
        'Content-Type': MEDIA_TYPES[ext] ?? 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        // An .svg (or anything else) opened at its own address runs no script as the app: a sandbox
        // with no scripts, and the type as sent.
        'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
        'X-Content-Type-Options': 'nosniff'
      }
    })
  })

  // --- Proposals (the Compose install only) ----------------------------------------

  if (options.proposals?.enabled ?? hasSpacesVolume()) registerProposalRoutes(app, { catalog, ...options.proposals })

  app.all('/api/*', c => c.json({ error: 'Not found' }, 404))

  return app
}

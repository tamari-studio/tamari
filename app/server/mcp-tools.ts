// The tools a member's AI gets on /api/mcp (server/mcp.ts). Every tool runs as the member behind
// the connection token: the same space access as the app (lib/access.ts), the same row level
// security, and for a space's own data the space's server functions, called as that member.
//
// Rules for a tool:
//   • It reads, and none of these reads sync or repair anything. The one exception here is
//     propose_note_change (`writes: true`): it makes a proposal that a person reviews in the Vault
//     space, and changes no note. The tools that change spaces are in server/mcp-space-tools.ts,
//     only in the Compose install, and only for a token made to change spaces.
//   • Its result is bounded: a capped list, a capped text, and `bounded()` as the last stop.
//   • It never returns a connector value, a secret, or more about other people than the app shows
//     this member.
//   • Its result is content from the team's files and records: data for the AI, not instructions.
//
// To add a tool: one `tool({ … })` entry in TOOLS. A vault tool is a few lines around `notes()`.
import { z } from 'zod'
import { isHiddenSpace, isManualSpace, type Hidden } from '../lib/access'
import { APP_NAME } from '../lib/brand'
import type { Catalog, CatalogApplet, RecordCollection, SharedRecord } from '../lib/types'
import type { AuthedUser } from './auth'
import { readCallerShows } from './borrow'
import type { Db } from './supabase'

// Said to the AI as the tool's error: a refusal or a "not found", in words the member can act on.
export class ToolRefusal extends Error {}
// The space is there, but its code in this build has no such server function (an older space).
export class SpaceMissing extends ToolRefusal {}

export type SpaceRow = { id: string; slug: string; name: string; folder: string | null; parent_id: string | null }

// What the tools read from the database, as the member (row level security applies).
export type ToolData = {
  spaces(): Promise<SpaceRow[]>
  // The company's name (Settings → Organisation), or null when unset.
  company(): Promise<string | null>
  shows(spaceId: string): Promise<{ tabRefs: string[]; widgetRefs: string[] }>
  collections(): Promise<RecordCollection[]>
  records(collection: string, hiddenSpaceIds: string[], limit: number): Promise<SharedRecord[]>
  record(collection: string, key: string): Promise<SharedRecord | null>
  // Records whose values hold the words of `query` (full-text, miso.records.search), newest first.
  searchRecords(query: string, hiddenSpaceIds: string[], limit: number): Promise<SharedRecord[]>
}

export type ToolContext = {
  user: AuthedUser
  catalog: Catalog
  hidden(): Promise<Hidden>
  data: ToolData
  // A space's server function, run as this member in the space's own environment (server/rpc.ts).
  // Refuses when this build has no such space or the member doesn't see it, and with SpaceMissing
  // when the space has no such function.
  callSpace(folder: string, moduleKey: string, fn: string, args: unknown[]): Promise<unknown>
  // The connection token may change spaces (server/mcp-space-tools.ts). Unset: it may not.
  editsSpaces?: boolean
  // The member's tier read now, past the sign-in cache: the changing tools check it on every call.
  currentTier?(): Promise<string | null>
  // The app's own API, as this member, for the tab and layout writes: the same checks as a click.
  api?(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<unknown>
}

export const RESULT_MAX_CHARS = 60_000
const RECORD_PREVIEW_CHARS = 2_000
const RECORD_MAX_CHARS = 40_000
const RECORDS_MAX = 50
const SEARCH_QUERY_MAX = 200
const EXCERPT_CHARS = 200
const NOTES_MAX = 500
// One page of a note's text, and the most it may take up once it is JSON (escapes make it longer).
const NOTE_PAGE_CHARS = 30_000
const NOTE_PAGE_JSON_CHARS = 50_000
const MATCHES_MAX = 50
// The vault's own limits (workspaces/vault/.miso/lib/paths.ts); the vault checks them again.
const NOTE_PATH_MAX = 200
const NOTE_MAX_CHARS = 200_000
const REASON_MAX = 200

export function bounded(text: string, max = RESULT_MAX_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… cut off: ${text.length - max} more characters. Ask for less at a time.`
}

// A record's data as it is when small, and as the start of its JSON when not.
export function boundedData(data: unknown, max: number): { data: unknown } | { dataCutOff: true; dataStart: string } {
  const json = JSON.stringify(data) ?? 'null'
  return json.length <= max ? { data } : { dataCutOff: true, dataStart: json.slice(0, max) }
}

// A short piece of a record's data around the first word of `query` it holds, or its start. The
// search operators `or` and `-word` are not words to look for.
export function recordExcerpt(data: unknown, query: string): string {
  const text = JSON.stringify(data) ?? 'null'
  const lower = text.toLowerCase()
  const words = (query.toLowerCase().match(/-?[\p{L}\p{N}]+/gu) ?? []).filter(w => w !== 'or' && !w.startsWith('-'))
  const at = words.map(w => lower.indexOf(w)).find(i => i >= 0) ?? 0
  const start = Math.max(0, at - EXCERPT_CHARS / 4)
  const end = start + EXCERPT_CHARS
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

export type RecordHit = { collection: string; key: string; spaceId: string | null; updatedAt: string; excerpt: string }

// Shared records that match `query`, without those of spaces this member doesn't see (on top of
// row level security, as for list_records). Used by search_records and GET /api/search/records.
export async function searchRecords(data: ToolData, hidden: Hidden, query: string, limit: number): Promise<RecordHit[]> {
  const found = await data.searchRecords(query, [...hidden.spaceIds], limit)
  return found.map(r => ({ collection: r.collection, key: r.key.slice(0, 500), spaceId: r.spaceId, updatedAt: r.updatedAt, excerpt: recordExcerpt(r.data, query) }))
}

// --- Spaces -----------------------------------------------------------------------

type AppletInfo = { ref: string; title: string }
export type SpaceInfo = { id: string; name: string; slug: string; parentId: string | null; views: AppletInfo[]; widgets: AppletInfo[] }

const viewRef = (a: CatalogApplet) => `view:${a.ref}`

// The spaces this member sees: the database's rows (names an admin changed, spaces and subspaces
// made in the app) without the hidden ones, plus spaces.json spaces the database has no row for
// yet. A space lists its own folder's views and widgets, minus those above the member's tier.
export function spacesFor(catalog: Catalog, hidden: Hidden, rows: SpaceRow[]): SpaceInfo[] {
  const listed = new Set([...catalog.spaces.map(s => s.id), ...rows.filter(isManualSpace).map(r => r.id)])
  const applets = (folder: string | null, kind: 'view' | 'widget'): AppletInfo[] =>
    folder === null
      ? []
      : catalog.applets
          .filter(a => a.folder === folder && a.kind === kind && !(kind === 'view' ? hidden.viewRefs.has(viewRef(a)) : hidden.widgetRefs.has(a.ref)))
          .map(a => ({ ref: kind === 'view' ? viewRef(a) : a.ref, title: a.title }))
  const info = (s: SpaceRow): SpaceInfo => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    parentId: s.parent_id,
    views: applets(s.folder, 'view'),
    widgets: applets(s.folder, 'widget')
  })
  const shown = rows
    .filter(r => listed.has(r.id) || (r.parent_id !== null && listed.has(r.parent_id)))
    .filter(r => !isHiddenSpace(hidden, { id: r.id, folder: r.folder, parentId: r.parent_id }))
  const have = new Set(shown.map(r => r.id))
  const missing = catalog.spaces
    .filter(s => !have.has(s.id) && !hidden.spaceIds.has(s.id) && !hidden.folders.has(s.folder))
    .map(s => ({ id: s.id, slug: s.slug, name: s.name, folder: s.folder, parent_id: null }))
  return [...shown, ...missing].map(info)
}

async function visibleSpaces(ctx: ToolContext): Promise<SpaceInfo[]> {
  const [hidden, rows] = await Promise.all([ctx.hidden(), ctx.data.spaces()])
  return spacesFor(ctx.catalog, hidden, rows)
}

// --- Vault ------------------------------------------------------------------------

// The vault's connector (which repo, its token) lives with the space, so the shell reaches notes
// only through the space's server functions, as the member (lib/notes.server.ts in the Vault
// space). What comes back is checked and picked from here, never passed on whole: it is another
// codebase's shape, and it knows more (the repo, the proposer's email) than a tool should say.
const notes = (ctx: ToolContext, fn: string, ...args: unknown[]) => ctx.callSpace('vault', 'lib/notes', fn, args)

const NO_VAULT = 'No vault is connected to this workspace yet. An admin connects one on the Connectors page.'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '')

// Every note path. A Vault space from before listNotes() still has getVault(), which lists paths.
async function notePaths(ctx: ToolContext): Promise<{ paths: string[]; truncated: boolean }> {
  let data: unknown
  try {
    data = await notes(ctx, 'listNotes')
  } catch (err) {
    if (!(err instanceof SpaceMissing)) throw err
    data = await ctx.callSpace('vault', 'lib/vault', 'getVault', [])
  }
  if (!isObject(data) || data.configured !== true) throw new ToolRefusal(NO_VAULT)
  const paths = (Array.isArray(data.notes) ? data.notes : []).flatMap(n => (typeof n === 'string' ? [n] : isObject(n) && typeof n.path === 'string' ? [n.path] : []))
  return { paths, truncated: data.truncated === true }
}

// The part of `text` from `offset` that fits one result: at most NOTE_PAGE_CHARS, less when its
// JSON form would be cut by bounded(), and never half of a two-unit character.
export function notePage(text: string, offset: number): string {
  let size = NOTE_PAGE_CHARS
  let page = text.slice(offset, offset + size)
  while (size > 1 && JSON.stringify(page).length > NOTE_PAGE_JSON_CHARS) {
    size = Math.floor(size / 2)
    page = text.slice(offset, offset + size)
  }
  const last = page.charCodeAt(page.length - 1)
  return page.length > 1 && last >= 0xd800 && last <= 0xdbff ? page.slice(0, -1) : page
}

const notePath = z.string().min(1).max(NOTE_PATH_MAX).describe('The path of the note in the vault, from list_notes or search_notes, for example "Projects/launch.md".')

// --- The tools --------------------------------------------------------------------

export type Tool<Shape extends z.ZodRawShape = z.ZodRawShape> = {
  name: string
  title: string
  description: string
  input: Shape
  // Only for a tool that makes something a person then reviews. Everything else reads.
  writes?: true
  run(ctx: ToolContext, args: z.infer<z.ZodObject<Shape>>): Promise<unknown>
}
export const tool = <Shape extends z.ZodRawShape>(t: Tool<Shape>): Tool => t as unknown as Tool

const collectionName = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, 'A collection name is lowercase letters, digits, dots, dashes and underscores.')
  .describe('The collection name, from list_collections.')

export const TOOLS: Tool[] = [
  tool({
    name: 'list_spaces',
    title: 'List spaces',
    description:
      'The spaces of this workspace that you have access to. Each has an id, a name, a slug (its address in the app), and the views (pages) and widgets (dashboard cards) its code provides. A subspace names its parent in parentId.',
    input: {},
    run: async ctx => ({ spaces: await visibleSpaces(ctx) })
  }),
  tool({
    name: 'whoami',
    title: 'Who am I',
    description:
      `Checks the connection: who this token signs in as, their company, and the spaces they can see in ${APP_NAME}. Call it first to confirm the connection works.`,
    input: {},
    run: async ctx => {
      const [company, spaces] = await Promise.all([ctx.data.company(), visibleSpaces(ctx)])
      return { name: ctx.user.name, email: ctx.user.email, company, spaces: spaces.map(s => ({ name: s.name, slug: s.slug })) }
    }
  }),
  tool({
    name: 'get_space',
    title: 'Get a space',
    description:
      'One space you have access to: its views and widgets, the tabs open in it for the team, the widgets on its dashboard, and its subspaces.',
    input: { space: z.string().min(1).max(200).describe('The id or slug of the space, from list_spaces.') },
    run: async (ctx, { space }) => {
      const spaces = await visibleSpaces(ctx)
      const found = spaces.find(s => s.id === space) ?? spaces.find(s => s.slug === space)
      if (!found) throw new ToolRefusal(`There is no space "${space.slice(0, 80)}" that you have access to. Use list_spaces to see yours.`)
      const [hidden, shows] = await Promise.all([ctx.hidden(), ctx.data.shows(found.id)])
      const titles = new Map(ctx.catalog.applets.map(a => [a.kind === 'view' ? viewRef(a) : a.ref, a.title]))
      return {
        ...found,
        openTabs: shows.tabRefs
          .filter(ref => ref === 'widgets' || (titles.has(ref) && !hidden.viewRefs.has(ref)))
          .map(ref => ({ ref, title: ref === 'widgets' ? 'Widgets' : titles.get(ref) })),
        dashboardWidgets: shows.widgetRefs.filter(ref => titles.has(ref) && !hidden.widgetRefs.has(ref)).map(ref => ({ ref, title: titles.get(ref) })),
        subspaces: spaces.filter(s => s.parentId === found.id).map(s => ({ id: s.id, name: s.name, slug: s.slug }))
      }
    }
  }),
  tool({
    name: 'list_collections',
    title: 'List shared record collections',
    description:
      'The collections of shared records that spaces saved (the Data page in the app), with how many records you can see in each and when one last changed.',
    input: {},
    run: async ctx => ({ collections: (await ctx.data.collections()).slice(0, 500) })
  }),
  tool({
    name: 'list_records',
    title: 'List shared records',
    description: `The newest records of one collection that you can see, at most ${RECORDS_MAX}. A record's data is included when it is small; for a large one you get the start of it, and get_record returns more.`,
    input: {
      collection: collectionName,
      limit: z.number().int().min(1).max(RECORDS_MAX).optional().describe(`How many records, 1 to ${RECORDS_MAX}. Default 20.`)
    },
    run: async (ctx, { collection, limit }) => {
      const hidden = await ctx.hidden()
      const records = await ctx.data.records(collection, [...hidden.spaceIds], limit ?? 20)
      return {
        collection,
        records: records.map(r => ({ key: r.key.slice(0, 500), spaceId: r.spaceId, updatedAt: r.updatedAt, ...boundedData(r.data, RECORD_PREVIEW_CHARS) }))
      }
    }
  }),
  tool({
    name: 'get_record',
    title: 'Get a shared record',
    description: 'One shared record by collection and key, with its data (cut off when it is very large).',
    input: { collection: collectionName, key: z.string().min(1).max(500).describe('The record key, from list_records.') },
    run: async (ctx, { collection, key }) => {
      const [hidden, record] = await Promise.all([ctx.hidden(), ctx.data.record(collection, key)])
      // The same answer for a record of a space this member doesn't see as for one that isn't there.
      if (!record || (record.spaceId !== null && hidden.spaceIds.has(record.spaceId))) {
        throw new ToolRefusal(`There is no record "${key.slice(0, 80)}" in ${collection} that you can see.`)
      }
      return { collection, key: record.key, spaceId: record.spaceId, updatedAt: record.updatedAt, ...boundedData(record.data, RECORD_MAX_CHARS) }
    }
  }),
  tool({
    name: 'search_records',
    title: 'Search shared records',
    description: `Shared records, in every collection you can see, whose text or numbers hold the words of the query, newest first, at most ${RECORDS_MAX}. Each comes with a short excerpt; get_record returns the whole record. The query takes words, "a phrase" in quotes, or between two words, and -word to leave a word out. Words match whole, not as prefixes.`,
    input: {
      query: z.string().max(SEARCH_QUERY_MAX).regex(/\S/, 'Give at least one word to search for.').describe(`What to look for, 1 to ${SEARCH_QUERY_MAX} characters.`),
      limit: z.number().int().min(1).max(RECORDS_MAX).optional().describe(`How many records, 1 to ${RECORDS_MAX}. Default 20.`)
    },
    run: async (ctx, { query, limit }) => ({ query, records: await searchRecords(ctx.data, await ctx.hidden(), query.trim(), limit ?? 20) })
  }),
  tool({
    name: 'list_notes',
    title: 'List vault notes',
    description: `The paths of the Markdown notes in the team's vault (the Vault space), at most ${NOTES_MAX} at a time. Give a folder to list only the notes under it.`,
    input: {
      folder: z.string().max(300).optional().describe('Only notes whose path starts with this folder, for example "Projects/".'),
      offset: z.number().int().min(0).max(1_000_000).optional().describe('Skip this many notes, to read on after a full page.'),
      limit: z.number().int().min(1).max(NOTES_MAX).optional().describe(`How many paths, 1 to ${NOTES_MAX}. Default 200.`)
    },
    run: async (ctx, { folder, offset = 0, limit = 200 }) => {
      const { paths, truncated } = await notePaths(ctx)
      const prefix = (folder ?? '').replace(/^\/+/, '')
      const all = paths.filter(p => p.startsWith(prefix))
      const page = all.slice(offset, offset + limit).map(p => p.slice(0, 500))
      return {
        total: all.length,
        offset,
        notes: page,
        more: offset + page.length < all.length,
        // GitHub cut the file list of a very large repo short.
        ...(truncated ? { incomplete: true } : {})
      }
    }
  }),
  tool({
    name: 'read_note',
    title: 'Read a vault note',
    description: `The text of one note in the team's vault, as Markdown with its frontmatter. A long note comes in pages of at most ${NOTE_PAGE_CHARS} characters: while "more" is true, call again with offset set to nextOffset. "sha" is the version of the note; propose_note_change needs it.`,
    input: {
      path: notePath,
      offset: z.number().int().min(0).max(50_000_000).optional().describe('Start at this character, to read on in a long note. Default 0.')
    },
    run: async (ctx, { path, offset = 0 }) => {
      const note = await notes(ctx, 'readNote', path)
      if (!isObject(note) || typeof note.content !== 'string') throw new Error('readNote returned no note')
      const content = notePage(note.content, offset)
      const end = offset + content.length
      const more = end < note.content.length
      // Version and position first: whatever cuts a result short cuts the text, not these.
      return {
        path: str(note.path, 500),
        title: str(note.title, 300),
        sha: str(note.sha, 64),
        length: note.content.length,
        offset,
        more,
        ...(more ? { nextOffset: end } : {}),
        content
      }
    }
  }),
  tool({
    name: 'search_notes',
    title: 'Search vault notes',
    description: `Notes in the team's vault whose name or path holds every word of the query, then notes whose text holds the phrase, at most ${MATCHES_MAX}. "searchedText" is false when only names could be searched.`,
    input: { query: z.string().min(2).max(100).describe('What to look for: a few words, 2 to 100 characters.') },
    run: async (ctx, { query }) => {
      const found = await notes(ctx, 'searchNotes', query)
      if (!isObject(found) || !Array.isArray(found.matches)) throw new Error('searchNotes returned no matches')
      return {
        query: str(found.query, 100),
        searchedText: found.searchedText === true,
        matches: found.matches
          .filter(isObject)
          .slice(0, MATCHES_MAX)
          .map(m => ({ path: str(m.path, 500), match: m.match === 'text' ? 'text' : 'name', ...(typeof m.snippet === 'string' ? { snippet: m.snippet.slice(0, 300) } : {}) }))
      }
    }
  }),
  tool({
    name: 'propose_note_change',
    title: 'Propose a change to a vault note',
    writes: true,
    description:
      'Propose new text for a note in the team\'s vault, or a new note. This changes no note: it opens a pull request in your name on the vault\'s GitHub repo, and the note changes only when a developer merges it there. "content" replaces the whole note, so read the whole note first (every page of read_note) and send its complete new text. Send the "sha" from read_note as baseSha; leave baseSha out only for a note that does not exist yet.',
    input: {
      path: notePath,
      content: z.string().min(1).max(NOTE_MAX_CHARS).describe('The whole new text of the note, as Markdown. Not a part of it and not a diff.'),
      reason: z.string().min(1).max(REASON_MAX).describe('One line for the reviewer: why this change.'),
      baseSha: z
        .string()
        .regex(/^[0-9a-f]{40,64}$/, 'baseSha is the "sha" that read_note returned for this note.')
        .optional()
        .describe('The "sha" read_note returned for this note. Leave out to propose a new note.')
    },
    run: async (ctx, { path, content, reason, baseSha }) => {
      const made = await notes(ctx, 'proposeChange', { path, content, reason, baseSha: baseSha ?? null })
      if (!isObject(made)) throw new Error('proposeChange returned no proposal')
      return {
        proposal: {
          id: str(made.id, 40),
          path: str(made.path, 500),
          kind: str(made.kind, 20),
          status: str(made.status, 20),
          reason: str(made.reason, REASON_MAX),
          createdAt: str(made.createdAt, 40),
          ...(typeof made.number === 'number' ? { pullRequest: made.number } : {})
        },
        next: 'Nothing changed in the vault yet. It is now a pull request that developers review and merge on GitHub.'
      }
    }
  })
]

// --- Reads, as the member ----------------------------------------------------------

type RecordRow = { collection: string; key: string; data: unknown; space_id: string | null; updated_at: string }
const toRecord = (r: RecordRow): SharedRecord => ({ collection: r.collection, key: r.key, data: r.data, spaceId: r.space_id, updatedAt: r.updated_at })

export function supabaseToolData(client: Db): ToolData {
  const columns = 'collection, key, data, space_id, updated_at'
  const fail = (what: string, message: string): never => {
    throw new Error(`${what}: ${message}`)
  }
  return {
    async company() {
      const { data, error } = await client.from('org_settings').select('name').maybeSingle<{ name: string | null }>()
      if (error) fail('reading the company name', error.message)
      return data?.name ?? null
    },
    async spaces() {
      const { data, error } = await client.from('spaces').select('id, slug, name, folder, parent_id').order('position').order('name').limit(500)
      if (error) fail('reading spaces', error.message)
      return (data ?? []) as SpaceRow[]
    },
    async shows(spaceId) {
      const shown = await readCallerShows(client)(spaceId)
      return { tabRefs: shown?.tabRefs ?? [], widgetRefs: shown?.widgetRefs ?? [] }
    },
    async collections() {
      const { data, error } = await client.rpc('record_collections')
      if (error) fail('reading collections', error.message)
      return ((data ?? []) as { name: string; count: number; updated_at: string }[]).map(r => ({ name: r.name, count: Number(r.count), updatedAt: r.updated_at }))
    },
    // The same filter as GET /api/records/:collection, on top of row level security.
    async records(collection, hiddenSpaceIds, limit) {
      let query = client.from('records').select(columns).eq('collection', collection)
      if (hiddenSpaceIds.length) query = query.or(`space_id.is.null,space_id.not.in.(${hiddenSpaceIds.map(id => JSON.stringify(id)).join(',')})`)
      const { data, error } = await query.order('updated_at', { ascending: false }).limit(limit)
      if (error) fail('reading records', error.message)
      return ((data ?? []) as RecordRow[]).map(toRecord)
    },
    async record(collection, key) {
      const { data, error } = await client.from('records').select(columns).eq('collection', collection).eq('key', key).maybeSingle<RecordRow>()
      if (error) fail('reading a record', error.message)
      return data ? toRecord(data) : null
    },
    async searchRecords(text, hiddenSpaceIds, limit) {
      let query = client.from('records').select(columns).textSearch('search', text, { type: 'websearch', config: 'simple' })
      if (hiddenSpaceIds.length) query = query.or(`space_id.is.null,space_id.not.in.(${hiddenSpaceIds.map(id => JSON.stringify(id)).join(',')})`)
      const { data, error } = await query.order('updated_at', { ascending: false }).limit(limit)
      if (error) fail('searching records', error.message)
      return ((data ?? []) as RecordRow[]).map(toRecord)
    }
  }
}

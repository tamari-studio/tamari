// The Proposals page's API (Tamari 5b, server/proposal-flow.ts). Only where the spaces are a volume
// with git (the Compose install). Deciding is a browser action, so these are /api routes, not MCP
// tools. Approving runs a member's code on the server next to the database's secret key, so the
// role is read fresh on every deciding call, not taken from the sign-in cache (auth.ts keeps a role
// for up to a minute).
import type { Hono } from 'hono'
import type { Catalog, Proposal } from '../lib/types'
import type { AuthEnv, AuthedUser } from './auth'
import { ForbiddenError } from './members'
import { readTier } from './mcp'
import { approveProposal, diffOf, loadProposal, rejectProposal, withdrawProposal, type Flow, type ProposalRow } from './proposal-flow'
import { userClient, vaultClient, type Db } from './supabase'

export type ProposalRouteOptions = {
  catalog: Catalog
  // Test seams: the vault account's flow, the role as the database has it now, the caller's client.
  flow?: () => Promise<Flow>
  currentTier?: (user: AuthedUser) => Promise<string | null>
  userDb?: (user: AuthedUser) => Db
}

const DECIDERS = 'Only admins and owners decide proposals.'
const COLUMNS = 'id, kind, space_id, draft_space_id, draft_folder, summary, visibility, author, author_line, status, base_commit, reviewed_commit, decided_by, reason, created_at, decided_at'

// "Name <email>" → "Name".
const authorName = (line: string) => line.replace(/\s*<[^>]*>\s*$/, '').trim() || line

export function toProposal(row: ProposalRow, catalog: Catalog, meId: string): Proposal {
  return {
    id: row.id,
    kind: row.kind,
    spaceId: row.space_id,
    spaceName: catalog.spaces.find(s => s.id === row.space_id)?.name ?? row.space_id,
    summary: row.summary,
    visibility: row.visibility,
    authorId: row.author,
    author: authorName(row.author_line),
    mine: row.author === meId,
    status: row.status,
    reason: row.reason,
    createdAt: row.created_at,
    decidedAt: row.decided_at
  }
}

export function registerProposalRoutes(app: Hono<AuthEnv>, options: ProposalRouteOptions): void {
  const { catalog } = options
  const flow = options.flow ?? (async () => ({ db: await vaultClient() }))
  const currentTier = options.currentTier ?? readTier
  const userDb = options.userDb ?? ((user: AuthedUser) => userClient(user.token))

  const decider = async (user: AuthedUser) => {
    const tier = await currentTier(user)
    if (tier !== 'admin' && tier !== 'owner') throw new ForbiddenError(DECIDERS)
  }
  app.get('/api/proposals', async c => {
    const user = c.get('user')
    const { data, error } = await userDb(user).from('space_proposals').select(COLUMNS).order('created_at', { ascending: false }).limit(200)
    if (error) throw new Error(`reading proposals: ${error.message}`)
    return c.json(((data ?? []) as ProposalRow[]).map(r => toProposal(r, catalog, user.id)))
  })

  app.get('/api/proposals/:id/diff', async c => {
    const user = c.get('user')
    // Read as the caller: row level security lets the author, admins and owners see it.
    const row = await loadProposal(userDb(user), c.req.param('id'))
    // Plain text, never HTML: the browser shows it in a <pre>.
    return c.json(diffOf(row))
  })

  app.post('/api/proposals/:id/approve', async c => {
    const user = c.get('user')
    await decider(user)
    return c.json(await approveProposal(await flow(), { id: c.req.param('id'), adminId: user.id }))
  })

  app.post('/api/proposals/:id/reject', async c => {
    const user = c.get('user')
    await decider(user)
    const body = (await c.req.json<unknown>().catch(() => null)) as { reason?: unknown } | null
    const row = await rejectProposal(await flow(), { id: c.req.param('id'), adminId: user.id, reason: body?.reason })
    return c.json(toProposal(row, catalog, user.id))
  })

  app.post('/api/proposals/:id/withdraw', async c => {
    const user = c.get('user')
    if (!(await currentTier(user))) throw new ForbiddenError('This account is not an active member of this workspace any more.')
    const row = await withdrawProposal(await flow(), { id: c.req.param('id'), userId: user.id })
    return c.json(toProposal(row, catalog, user.id))
  })
}

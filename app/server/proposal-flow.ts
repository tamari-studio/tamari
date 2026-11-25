// Proposals (Tamari 5b): sending, deciding and withdrawing, over the spaces volume (proposals.ts)
// and the miso.space_proposals table (migration 20261124000200), which only the vault account
// writes. Used by the MCP tools (submit_proposal, delete_draft_space) and the Proposals page's /api
// routes (app.ts). The callers check who is asking: an admin or owner (read fresh, not from the
// sign-in cache) decides, the author withdraws.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { listApplets } from '../lib/catalog'
import { waitForBuild as defaultWait, type BuildStatus } from './build-status'
import {
  applyApproval,
  applyPublish,
  approveFiles,
  changedSince,
  checkApprovable,
  committedFiles,
  DRAFT_CHANGED,
  head,
  OutOfDate,
  proposalDiff,
  type CopyEntry
} from './proposals'
import { authorLine, FileRefusal, readSpacesFile, runChange, SPACES_DIR, type Author, type ChangeResult, type SpaceEntry } from './space-files'
import { spacesGit } from './spaces-volume'
import type { Db } from './supabase'

export type ProposalRow = {
  id: string
  kind: 'change' | 'publish'
  space_id: string
  draft_space_id: string | null
  draft_folder: string
  summary: string
  visibility: 'team' | 'everyone' | null
  author: string
  author_line: string
  status: 'open' | 'approved' | 'rejected' | 'withdrawn' | 'out_of_date'
  base_commit: string | null
  reviewed_commit: string
  decided_by: string | null
  reason: string | null
  created_at: string
  decided_at: string | null
}

export type Flow = {
  db: Db
  dir?: string
  waitForBuild?: (after: number) => Promise<BuildStatus | null>
  askForBuild?: () => void
}

const COLUMNS = 'id, kind, space_id, draft_space_id, draft_folder, summary, visibility, author, author_line, status, base_commit, reviewed_commit, decided_by, reason, created_at, decided_at'
export const REASON_MAX = 500
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const failed = (what: string, error: { message: string } | null) => {
  if (error) throw new Error(`${what}: ${error.message}`)
}

/** The open proposal of a draft folder, if any. */
export async function openProposal(db: Db, folder: string): Promise<ProposalRow | null> {
  const { data, error } = await db.from('space_proposals').select(COLUMNS).eq('draft_folder', folder).eq('status', 'open').maybeSingle<ProposalRow>()
  failed('reading proposals', error)
  return data
}

export const FROZEN = 'This draft is waiting for an admin to look at it, so it stays as it was sent. Withdraw the proposal on the Proposals page to change it again.'

/** Refuses a change to a draft whose proposal is open: the admin approves what they saw. */
export async function refuseIfSent(db: Db, folder: string): Promise<void> {
  if (await openProposal(db, folder)) throw new FileRefusal(FROZEN)
}

export async function loadProposal(db: Db, id: unknown): Promise<ProposalRow> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new FileRefusal('There is no such proposal.')
  const { data, error } = await db.from('space_proposals').select(COLUMNS).eq('id', id).maybeSingle<ProposalRow>()
  failed('reading the proposal', error)
  if (!data) throw new FileRefusal('There is no such proposal.')
  return data
}

/**
 * Sends a member's own draft: a copy of a live space becomes a change proposal; a draft space of
 * their own becomes a proposal to publish it to `visibility`.
 */
export async function submitProposal(
  { db, dir = SPACES_DIR }: Flow,
  { entry, userId, author, summary, visibility }: { entry: SpaceEntry; userId: string; author: Author; summary: string; visibility?: 'team' | 'everyone' }
): Promise<ProposalRow> {
  if (entry.draft !== true || entry.createdBy !== userId) throw new FileRefusal('Only your own drafts are sent as proposals.')
  const copy = entry as Partial<CopyEntry>
  const live = copy.draftOf ? readSpacesFile(dir).find(s => s.folder === copy.draftOf && !s.draft) : undefined
  if (copy.draftOf && (!live || !copy.baseCommit)) throw new FileRefusal('The space this draft was copied from is gone, so there is nothing to change. Delete the draft.')
  if (!copy.draftOf && !visibility) throw new FileRefusal('Say who should see the space once it is approved: team (your teams) or everyone.')
  if (!committedFiles(entry.folder, dir).length) throw new FileRefusal('The draft has no files yet.')
  if (spacesGit(dir, 'status', '--porcelain', '--', `${entry.folder}/`).trim()) throw new FileRefusal('The draft has files that were never saved. Change it with change_space_files first.')
  await ensureDraftRow(db, entry, live?.id ?? null, dir)
  const { data, error } = await db
    .from('space_proposals')
    .insert({
      kind: copy.draftOf ? 'change' : 'publish',
      space_id: live ? live.id : entry.id,
      draft_space_id: entry.id,
      draft_folder: entry.folder,
      summary,
      visibility: copy.draftOf ? null : visibility,
      author: userId,
      author_line: authorLine(author),
      base_commit: copy.draftOf ? copy.baseCommit : null,
      reviewed_commit: head(dir)
    })
    .select(COLUMNS)
    .single<ProposalRow>()
  if (error?.code === '23505') throw new FileRefusal('This draft is sent already and waits for an admin.')
  failed('saving the proposal', error)
  return data!
}

/**
 * The draft's row in miso.spaces. The app adds a new spaces.json entry's row when it first loads a
 * workspace after the build that has it (app.ts, syncCatalogSpaces), which a member working only
 * through MCP may not have caused yet, and the instance answering may still be the one from before
 * the build. The proposal points at the row, and approving a publication changes it, so it is made
 * here the same way (miso.sync_spaces: only a missing row is added; an existing one keeps its own).
 */
async function ensureDraftRow(db: Db, entry: SpaceEntry, parentId: string | null, dir: string): Promise<void> {
  const ws = join(dir, entry.folder, '.miso', '.workspace.json')
  const meta = existsSync(ws) ? (JSON.parse(readFileSync(ws, 'utf8')) as { name?: string; icon?: string }) : {}
  const { data, error } = await db.rpc('sync_spaces', {
    p_spaces: [
      {
        id: entry.id,
        slug: entry.slug,
        name: meta.name ?? entry.slug,
        folder: entry.folder,
        previous_slugs: [],
        position: 0,
        theme: {},
        icon: meta.icon ?? null,
        min_tier: null,
        draft: true,
        created_by: entry.createdBy ?? null,
        parent_id: parentId
      }
    ]
  })
  failed("adding the draft's row", error)
  // A row made here opens like one the app makes: its widgets tab if it has widgets, and its first view.
  if (!((data ?? []) as string[]).includes(entry.id)) return
  const root = dirname(dir)
  const firstView = listApplets(root, entry.folder, 'view')[0]
  const widgets = listApplets(root, entry.folder, 'widget')
  const refs = [...(widgets.length ? ['widgets'] : []), ...(firstView ? [`view:${firstView.ref}`] : [])]
  if (!refs.length) return
  const tabs = await db.from('tabs').upsert(refs.map((ref, position) => ({ space_id: entry.id, ref, position })), { onConflict: 'space_id,ref', ignoreDuplicates: true })
  failed("adding the draft's tabs", tabs.error)
}

async function decide(db: Db, id: string, fields: Partial<ProposalRow>): Promise<ProposalRow> {
  const { data, error } = await db
    .from('space_proposals')
    .update({ ...fields, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'open')
    .select(COLUMNS)
    .maybeSingle<ProposalRow>()
  failed('saving the decision', error)
  if (!data) throw new FileRefusal('That proposal was decided or withdrawn already.')
  return data
}

const mustBeOpen = (p: ProposalRow) => {
  if (p.status !== 'open') throw new FileRefusal('That proposal was decided or withdrawn already.')
}

export type ApproveResult = { status: 'approved'; commit: string } | { status: 'out of date' } | { status: 'put back'; errors: string } | { status: 'no change' }

/**
 * Approves: in one change under the lock, a change proposal's draft goes over the live space (or a
 * publication's entry stops being a draft), then the build, then one commit naming the author. The
 * database follows only after the commit: the copy's row goes, a publication gets its visibility.
 */
export const TOO_LONG_TO_REVIEW = 'This proposal changes more than the review screen can show, so it can\'t be approved here. Reject it and ask for smaller proposals.'

export async function approveProposal(flow: Flow, { id, adminId }: { id: string; adminId: string }): Promise<ApproveResult> {
  const { db, dir = SPACES_DIR, waitForBuild = defaultWait, askForBuild } = flow
  const p = await loadProposal(db, id)
  mustBeOpen(p)
  const entry = readSpacesFile(dir).find(s => s.folder === p.draft_folder) as (SpaceEntry & Partial<CopyEntry>) | undefined
  if (!entry || entry.createdBy !== p.author) throw new FileRefusal('The draft of this proposal is gone. Reject it, or ask the author to send it again.')
  // Only what the admin could read in full is approved: never a cut comparison.
  if (diffOf(p, dir).cut) throw new FileRefusal(TOO_LONG_TO_REVIEW)
  // A publication whose spaces.json change was committed by an earlier try that then failed at the
  // database: only the database step is left.
  const publishedBefore = p.kind === 'publish' && !entry.draft
  if (!entry.draft && !publishedBefore) throw new FileRefusal('The draft of this proposal is gone. Reject it, or ask the author to send it again.')
  let commit: string | null = null
  if (!publishedBefore) {
    let result: ChangeResult
    try {
      result = await runChange({
        dir,
        summary: p.summary,
        author: p.author_line,
        prepare: () => {
          if (p.kind === 'change') checkApprovable(entry as CopyEntry, p.reviewed_commit, dir)
          else if (changedSince(p.reviewed_commit, entry.folder, dir) || spacesGit(dir, 'status', '--porcelain', '--', `${entry.folder}/`).trim()) throw new FileRefusal(DRAFT_CHANGED)
        },
        touched: () => (p.kind === 'change' ? approveFiles(entry as CopyEntry, dir) : ['spaces.json']),
        apply: () => (p.kind === 'change' ? applyApproval(entry as CopyEntry, dir) : applyPublish(entry.folder, dir)),
        waitForBuild,
        ...(askForBuild ? { askForBuild } : {})
      })
    } catch (err) {
      if (!(err instanceof OutOfDate)) throw err
      await decide(db, p.id, { status: 'out_of_date', decided_by: adminId, reason: err.message })
      return { status: 'out of date' }
    }
    if (result.status === 'put back') return result
    if (result.status === 'no change') return result
    commit = result.commit
  }
  if (p.kind === 'change') {
    const { error } = await db.rpc('delete_draft_space', { p_space: entry.id, p_user: p.author })
    failed("deleting the draft's row", error)
  } else {
    const { data, error } = await db.rpc('publish_space', { p_space: entry.id, p_visibility: p.visibility, p_author: p.author })
    failed('publishing the space', error)
    if (data !== true && !publishedBefore) throw new Error(`publishing ${entry.id}: the space row was not a draft of its author`)
  }
  await decide(db, p.id, { status: 'approved', decided_by: adminId })
  return { status: 'approved', commit: commit ?? head(dir).slice(0, 7) }
}

export function checkReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  if (!reason || reason.length > REASON_MAX) throw new FileRefusal(`Say in 1 to ${REASON_MAX} characters why, so the author knows what to change.`)
  return reason
}

/** Rejects with a reason the author sees. The draft stays theirs to change and send again. */
export async function rejectProposal({ db }: Flow, { id, adminId, reason }: { id: string; adminId: string; reason: unknown }): Promise<ProposalRow> {
  const why = checkReason(reason)
  const p = await loadProposal(db, id)
  mustBeOpen(p)
  return decide(db, p.id, { status: 'rejected', decided_by: adminId, reason: why })
}

/** The author takes their proposal back; the draft stays. */
export async function withdrawProposal({ db }: Flow, { id, userId }: { id: string; userId: string }): Promise<ProposalRow> {
  const p = await loadProposal(db, id)
  if (p.author !== userId) throw new FileRefusal('Only the author withdraws a proposal.')
  mustBeOpen(p)
  return decide(db, p.id, { status: 'withdrawn', decided_by: userId })
}

/** A deleted draft takes its open proposal with it. */
export async function withdrawForFolder(db: Db, folder: string, userId: string): Promise<void> {
  const { error } = await db
    .from('space_proposals')
    .update({ status: 'withdrawn', decided_by: userId, decided_at: new Date().toISOString() })
    .eq('draft_folder', folder)
    .eq('status', 'open')
  failed('withdrawing the proposal', error)
}

/** What the review screen shows for one proposal: its changes as plain text. */
export function diffOf(p: ProposalRow, dir = SPACES_DIR): { diff: string; cut: boolean } {
  const live = p.kind === 'change' ? readSpacesFile(dir).find(s => s.id === p.space_id) : undefined
  // A change whose live space is gone has nothing to compare with: show the draft whole.
  return proposalDiff({ draftFolder: p.draft_folder, liveFolder: live?.folder ?? null, baseCommit: live ? p.base_commit : null, reviewedCommit: p.reviewed_commit }, dir)
}

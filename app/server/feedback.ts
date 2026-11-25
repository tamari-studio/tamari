// Feedback: what people send from the rail's Feedback button, and the issue
// list owners and admins work through in the health space's feedback view.
//
// Row level security on miso.feedback (migration 0065 in the miso repo) is the
// real gate, and every query here runs as the signed-in person: anyone who can
// use the app inserts and reads back their own rows; admin+ read all of them and
// set completed_at. The database stamps who sent an issue and who completed it
// from the session, so nothing the browser says about identity is stored. The
// rules below repeat the tier check so a refusal reads as a 403 with a reason
// rather than an empty list, and they check input before the database does.
import { hasAtLeast } from '../vendor/dto-core/tier'
import { FEEDBACK_PRIORITIES, type FeedbackInput, type FeedbackItem, type FeedbackPriority } from '../lib/types'
import { InputError } from './connectors'
import { ForbiddenError } from './members'
import type { Viewer } from '../lib/access'
import type { Db } from './supabase'

export const TITLE_MAX = 200
export const DESCRIPTION_MAX = 5000
const PAGE_MAX = 500

export type FeedbackRow = {
  id: number
  title: string
  description: string
  priority: FeedbackPriority
  page: string | null
  submitted_by: string | null
  submitter_email: string | null
  submitter_name: string | null
  created_at: string
  completed_at: string | null
  completed_by_email: string | null
}

// Everything the rules need from the database, so they can be tested without one.
export type FeedbackStore = {
  insert(input: Required<FeedbackInput>): Promise<FeedbackRow>
  listOwn(userId: string): Promise<FeedbackRow[]>
  listAll(): Promise<FeedbackRow[]>
  // Null when no row was changed: it doesn't exist, or the database refused.
  setCompleted(id: number, completed: boolean): Promise<FeedbackRow | null>
}

export function canTriage(viewer: Viewer): boolean {
  return hasAtLeast(viewer.tier, viewer.status, 'admin')
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export function checkInput(body: unknown): Required<FeedbackInput> {
  const input = (body ?? {}) as Partial<Record<keyof FeedbackInput, unknown>>
  const title = text(input.title)
  const description = text(input.description)
  if (!title) throw new InputError('Give your feedback a title.')
  if (title.length > TITLE_MAX) throw new InputError(`Keep the title under ${TITLE_MAX} characters.`)
  if (!description) throw new InputError('Describe the issue.')
  if (description.length > DESCRIPTION_MAX) throw new InputError(`Keep the description under ${DESCRIPTION_MAX} characters.`)
  if (!FEEDBACK_PRIORITIES.includes(input.priority as FeedbackPriority)) {
    throw new InputError(`Priority is one of ${FEEDBACK_PRIORITIES.join(', ')}.`)
  }
  // Only an app path is kept; anything else is dropped rather than refused.
  const page = text(input.page)
  return {
    title,
    description,
    priority: input.priority as FeedbackPriority,
    page: page.startsWith('/') && page.length <= PAGE_MAX ? page : null
  }
}

export function toItem(row: FeedbackRow): FeedbackItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    priority: row.priority,
    page: row.page,
    submittedBy: row.submitted_by,
    submitterEmail: row.submitter_email,
    submitterName: row.submitter_name,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    completedByEmail: row.completed_by_email
  }
}

export async function sendFeedback(store: FeedbackStore, body: unknown): Promise<FeedbackItem> {
  return toItem(await store.insert(checkInput(body)))
}

export async function listOwnFeedback(store: FeedbackStore, userId: string): Promise<FeedbackItem[]> {
  return (await store.listOwn(userId)).map(toItem)
}

export async function listAllFeedback(store: FeedbackStore, viewer: Viewer): Promise<FeedbackItem[]> {
  if (!canTriage(viewer)) throw new ForbiddenError('Only owners and admins see the issue list.')
  return (await store.listAll()).map(toItem)
}

export async function setFeedbackCompleted(store: FeedbackStore, viewer: Viewer, id: unknown, body: unknown): Promise<FeedbackItem> {
  if (!canTriage(viewer)) throw new ForbiddenError('Only owners and admins tick issues off.')
  const issue = Number(id)
  if (!Number.isSafeInteger(issue) || issue <= 0) throw new InputError('There is no such issue.')
  const completed = (body as { completed?: unknown } | null)?.completed
  if (typeof completed !== 'boolean') throw new InputError('Send { completed: true } or { completed: false }.')
  const row = await store.setCompleted(issue, completed)
  if (!row) throw new InputError('There is no such issue.')
  return toItem(row)
}

const COLUMNS =
  'id, title, description, priority, page, submitted_by, submitter_email, submitter_name, created_at, completed_at, completed_by_email'

export function supabaseFeedbackStore(client: Db): FeedbackStore {
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message)
  }
  return {
    async insert(input) {
      const { data, error } = await client.from('feedback').insert(input).select(COLUMNS).single<FeedbackRow>()
      check(error)
      return data!
    },
    async listOwn(userId) {
      const { data, error } = await client
        .from('feedback')
        .select(COLUMNS)
        .eq('submitted_by', userId)
        .order('created_at', { ascending: false })
        .limit(200)
      check(error)
      return (data ?? []) as FeedbackRow[]
    },
    async listAll() {
      const { data, error } = await client.from('feedback').select(COLUMNS).order('created_at', { ascending: false }).limit(2000)
      check(error)
      return (data ?? []) as FeedbackRow[]
    },
    async setCompleted(id, completed) {
      // Any timestamp means "completed now": the database stamps the real time and who.
      const { data, error } = await client
        .from('feedback')
        .update({ completed_at: completed ? new Date().toISOString() : null })
        .eq('id', id)
        .select(COLUMNS)
        .maybeSingle<FeedbackRow>()
      check(error)
      return data
    }
  }
}

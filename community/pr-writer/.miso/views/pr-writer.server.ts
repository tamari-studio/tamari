// PR writer's server calls: the style guides to pick from (and to add, change and remove), one
// draft written, and the caller's recent drafts.
//
// Guides live in the shared `pr-writer-guides` collection, keyed by a short random id. Drafts
// are kept in the shared `pr-writer-drafts` collection, keyed `<caller id>/<time>`. The caller
// comes from the signed-in session (@miso/caller), never from the browser, and is read inside
// each function. Filtering drafts by caller is a convenience, not privacy: any member's server
// code can read the collection, and the view says so. Everyone who can open the space can
// change its guides; the Space access page limits who that is.
//
// Only async functions are exported (the RPC layer requires it); types are erased.
import { requireCaller } from '@miso/caller'
import { collection } from '@miso/store'

import { completeDraft, DRAFT_MODEL } from './_llm'
import {
  defaultGuideId,
  draftKey,
  guideKey,
  MAX_GUIDES,
  parseGuide,
  RECENT_DRAFTS,
  writeDraft as writeDraftWith,
  type DraftRecord,
  type StyleGuide
} from './_pr-writer'

export type GuideChoice = { id: string; name: string }

export type GuideList = { guides: GuideChoice[]; defaultId: string | null }

export type SavedDraft = DraftRecord & { key: string }

export type DraftOutcome =
  | { ok: true; draft: string; saved: SavedDraft | null }
  | { ok: false; error: string }

export type GuideOutcome = { ok: true; guides: GuideList } | { ok: false; error: string }

type GuideRecord = { name: string; guide: string; updated_at: string; by: string }

const guideStore = () => collection<GuideRecord>('pr-writer-guides')
const drafts = () => collection<DraftRecord>('pr-writer-drafts')

async function readGuides(): Promise<GuideList> {
  const records = await guideStore().list({ limit: MAX_GUIDES })
  const guides = records
    .map(record => ({ id: record.key, name: String(record.data?.name ?? '') }))
    .filter(g => g.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return { guides, defaultId: defaultGuideId(guides) }
}

/** The guides to pick from, by name. The guide text stays on the server until a draft or an edit needs it. */
export async function listGuides(): Promise<GuideList> {
  requireCaller()
  return readGuides()
}

/** One guide with its text, for the editor. Null when it is gone. */
export async function getGuide(id: unknown): Promise<(GuideChoice & { guide: string }) | null> {
  requireCaller()
  if (typeof id !== 'string' || id.length > 40) return null
  const record = await guideStore().get(id)
  return record ? { id: record.key, name: record.data.name, guide: record.data.guide } : null
}

/** Adds a guide, or changes the one with `id`. Expected failures come back as text. */
export async function saveGuide(id: unknown, name: unknown, guide: unknown): Promise<GuideOutcome> {
  const { email } = requireCaller()
  const parsed = parseGuide(name, guide)
  if (!parsed.ok) return parsed
  let key: string
  if (id === null || id === undefined || id === '') {
    if ((await readGuides()).guides.length >= MAX_GUIDES) return { ok: false, error: `At most ${MAX_GUIDES} style guides. Remove one first.` }
    key = guideKey(crypto.randomUUID())
  } else {
    if (typeof id !== 'string' || id.length > 40 || !(await guideStore().get(id))) return { ok: false, error: 'That style guide is gone. Reload the tab.' }
    key = id
  }
  await guideStore().put(key, { ...parsed.value, updated_at: new Date().toISOString(), by: email })
  return { ok: true, guides: await readGuides() }
}

export async function removeGuide(id: unknown): Promise<GuideList> {
  requireCaller()
  if (typeof id === 'string' && id.length <= 40) await guideStore().remove(id)
  return readGuides()
}

/** The caller's own recent drafts, newest first. */
export async function listMyDrafts(): Promise<SavedDraft[]> {
  const { id } = requireCaller()
  const records = await drafts().list({ prefix: `${id}/`, order: 'key-desc', limit: RECENT_DRAFTS })
  return records.map(record => ({ ...record.data, key: record.key }))
}

/** Writes one draft in the chosen guide's voice and keeps it. Expected failures come back as text. */
export async function writeDraft(input: string, guideId: string): Promise<DraftOutcome> {
  const { id: callerId } = requireCaller()
  if (typeof input !== 'string' || typeof guideId !== 'string' || guideId.length > 40)
    return { ok: false, error: 'Paste a transcript, outline, or draft first.' }

  let guide: StyleGuide | null
  try {
    const record = await guideStore().get(guideId)
    guide = record ? { id: record.key, name: record.data.name, guide: record.data.guide } : null
  } catch {
    return { ok: false, error: "Couldn't load the style guide. Try again." }
  }

  const result = await writeDraftWith({ input, guide, complete: completeDraft })
  if (!result.ok) return result
  // writeDraftWith refuses a missing guide, so this only narrows the type.
  if (!guide) return { ok: false, error: 'There is no style guide to write in yet. Add one first.' }

  // The draft is paid for and is what the member asked for: a failed save must not cost them it.
  const record: DraftRecord = {
    input: input.trim(),
    output: result.draft,
    guide_id: guide.id,
    guide_name: guide.name,
    model: DRAFT_MODEL,
    created_at: new Date().toISOString()
  }
  const key = draftKey(callerId, new Date(record.created_at))
  try {
    await drafts().put(key, record)
    return { ok: true, draft: result.draft, saved: { ...record, key } }
  } catch {
    return { ok: true, draft: result.draft, saved: null }
  }
}

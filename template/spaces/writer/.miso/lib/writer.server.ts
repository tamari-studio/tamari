// Server functions for Writer. Guides and drafts live in the shared-records collections
// `writer-guides` and `writer-drafts` (no table of its own). Every argument comes from the
// browser, so each one is checked in lib/check.ts, lib/guides.ts or lib/drafts.ts before anything
// is saved. The AI key is read in lib/ai.ts, here on the server, and never sent to the browser.
import { requireCaller } from '@miso/caller'
import { collection } from '@miso/store'
import { aiConfigured, writeArticle, type Reply } from './ai'
import { day, fields, longText, rowKey } from './check'
import { MAX_DRAFTS, MAX_NOTES, exampleDrafts, parseDraft, type Draft } from './drafts'
import { MAX_GUIDES, exampleGuides, parseGuide, type Guide } from './guides'
import { buildSystemPrompt } from './prompt'
import { rows, type Saved } from './rows'

const guides = () =>
  rows(collection<Guide>('writer-guides'), {
    parse: parseGuide,
    examples: exampleGuides,
    // A draft names its guide, so two guides with one name would be a puzzle.
    unique: { of: guide => guide.name.toLowerCase(), taken: guide => `There is already a style guide called ${guide.name}. Pick another name, or change that one.` }
  })
const drafts = () => rows(collection<Draft>('writer-drafts'), { parse: parseDraft, examples: exampleDrafts })

const isNew = (raw: Record<string, unknown>) => raw.key === undefined || raw.key === null || raw.key === ''

const sentence = (err: unknown) => (err instanceof Error ? err.message : 'That could not be read. Reload the page and try again.')

/** Whether the AI key is set, so the page can say so before anyone presses Write draft. The key itself never leaves the server. */
export async function aiReady(): Promise<boolean> {
  requireCaller()
  return aiConfigured()
}

export async function listGuides(): Promise<Saved<Guide>[]> {
  requireCaller()
  return (await guides().list()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Saves a new style guide, or the guide with `input.key` again. */
export async function saveGuide(input: unknown): Promise<Saved<Guide>> {
  requireCaller()
  const raw = fields(input)
  parseGuide(raw)
  if (isNew(raw) && (await guides().list()).length >= MAX_GUIDES) throw new Error(`You can keep ${MAX_GUIDES} style guides at most. Remove one first.`)
  return guides().save(raw)
}

export async function removeGuide(key: unknown): Promise<void> {
  requireCaller()
  await guides().remove(key)
}

export async function listDrafts(): Promise<Saved<Draft>[]> {
  requireCaller()
  return drafts().list()
}

/** Saves a new draft, or the draft with `input.key` again. The time of the change is the server's, whatever the browser sends. */
export async function saveDraft(input: unknown): Promise<Saved<Draft>> {
  requireCaller()
  const raw = { ...fields(input), updatedAt: new Date().toISOString() }
  parseDraft(raw)
  if (isNew(raw) && (await drafts().list()).length >= MAX_DRAFTS) throw new Error(`You can keep ${MAX_DRAFTS} drafts at most. Remove some first.`)
  return drafts().save(raw)
}

export async function removeDraft(key: unknown): Promise<void> {
  requireCaller()
  await drafts().remove(key)
}

/**
 * Writes an article from rough notes in the voice of one style guide. It does not save anything:
 * the person reads it, then saves it. Expected failures come back as `{ ok: false, error }`.
 */
export async function writeDraft(notes: unknown, guideKey: unknown): Promise<Reply> {
  requireCaller()
  let clean: string
  let key: string
  try {
    clean = longText(notes, 'Notes text', MAX_NOTES)
    key = rowKey(guideKey)
  } catch (err) {
    return { ok: false, error: sentence(err) }
  }
  if (!clean) return { ok: false, error: 'Paste your rough notes first.' }

  let guide: Saved<Guide> | undefined
  try {
    guide = (await guides().list()).find(g => g.key === key)
  } catch (err) {
    return { ok: false, error: sentence(err) }
  }
  if (!guide) return { ok: false, error: 'That style guide is gone. Pick another one.' }
  return writeArticle({ system: buildSystemPrompt(guide), notes: clean })
}

/** `today` is the person's own day (YYYY-MM-DD), so the example drafts sit just before it. */
export async function loadExamples(today: unknown): Promise<{ guides: number; drafts: number }> {
  requireCaller()
  const on = day(today, 'Today', { required: true })
  return { guides: await guides().loadExamples(on), drafts: await drafts().loadExamples(on) }
}

export async function removeExamples(): Promise<{ guides: number; drafts: number }> {
  requireCaller()
  return { guides: await guides().removeExamples(), drafts: await drafts().removeExamples() }
}

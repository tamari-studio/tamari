import { afterEach, expect, test } from 'bun:test'

import { MAX_DRAFTS, MAX_DRAFT_TEXT, MAX_NOTES, MAX_TITLE, STATUSES, countGaps, exampleDrafts, gapParts, newestFirst, parseDraft, suggestTitle, summary, type Draft } from './drafts'
import { MAX_GUIDE_NAME } from './guides'
import { listDrafts, loadExamples, removeDraft, removeExamples, saveDraft, writeDraft } from './writer.server'

const TODAY = '2026-03-04'
const draft = (patch: Partial<Draft> = {}): Draft => ({ title: 'A piece', guide: 'Plain and warm', notes: 'a note', text: 'The text.', status: 'draft', updatedAt: '2026-03-01T09:30:00.000Z', ...patch })

test('parseDraft keeps the known fields, cleaned', () => {
  expect(parseDraft({ ...draft({ title: '  A   piece ', text: ' Line one.\r\nLine two. ' }), key: 'r-1', example: true, extra: 'x' })).toEqual(draft({ title: 'A piece', text: 'Line one.\nLine two.' }))
})

test('a field that is left out gets its default, so a row saved before it existed still loads', () => {
  expect(parseDraft({ title: 'Only a title' })).toEqual({ title: 'Only a title', guide: '', notes: '', text: '', status: 'draft', updatedAt: '' })
  expect(parseDraft({ ...draft(), status: null, guide: null, notes: undefined, updatedAt: '' })).toEqual(draft({ status: 'draft', guide: '', notes: '', updatedAt: '' }))
})

test('parseDraft needs a title and refuses an unknown status and a time that is not one', () => {
  expect(() => parseDraft(draft({ title: '' }))).toThrow('Title is needed.')
  expect(() => parseDraft({})).toThrow('Title is needed.')
  expect(() => parseDraft({ ...draft(), status: 'done' })).toThrow('Status must be one of: draft, final.')
  expect(() => parseDraft({ ...draft(), updatedAt: 'yesterday' })).toThrow('must be a date and a time')
  expect(() => parseDraft({ ...draft(), updatedAt: '2026-02-30T09:30:00Z' })).toThrow('must be a date and a time')
  expect(() => parseDraft({ ...draft(), updatedAt: 5 })).toThrow('must be a date and a time')
  expect(() => parseDraft({ ...draft(), title: 5 })).toThrow('Title must be text.')
  expect(() => parseDraft('text')).toThrow('could not be read')
  expect(STATUSES.map(status => parseDraft({ ...draft(), status }).status)).toEqual(['draft', 'final'])
  expect(parseDraft({ ...draft(), updatedAt: '2026-03-01T09:30:00Z' }).updatedAt).toBe('2026-03-01T09:30:00Z')
})

test('parseDraft says how long each field may be', () => {
  expect(parseDraft(draft({ title: 'a'.repeat(MAX_TITLE) })).title).toHaveLength(MAX_TITLE)
  expect(() => parseDraft(draft({ title: 'a'.repeat(MAX_TITLE + 1) }))).toThrow('Title is too long (120 characters at most).')
  expect(() => parseDraft(draft({ guide: 'a'.repeat(MAX_GUIDE_NAME + 1) }))).toThrow('Style guide is too long (60 characters at most).')
  expect(parseDraft(draft({ notes: 'a'.repeat(MAX_NOTES) })).notes).toHaveLength(60_000)
  expect(() => parseDraft(draft({ notes: 'a'.repeat(MAX_NOTES + 1) }))).toThrow('Notes text is too long (60000 characters at most).')
  expect(parseDraft(draft({ text: 'a'.repeat(MAX_DRAFT_TEXT) })).text).toHaveLength(60_000)
  expect(() => parseDraft(draft({ text: 'a'.repeat(MAX_DRAFT_TEXT + 1) }))).toThrow('Draft text is too long (60000 characters at most).')
  expect(MAX_DRAFTS).toBe(500)
})

test('the examples pass the check, name a guide or none, and date back from today', () => {
  const examples = exampleDrafts(TODAY)
  expect(examples).toHaveLength(3)
  expect(examples.map(parseDraft)).toEqual(examples)
  expect(new Set(examples.map(d => d.status))).toEqual(new Set(['draft', 'final']))
  expect(examples.some(d => countGaps(d.text) > 0)).toBe(true)
  expect(examples.some(d => d.text === '' && d.notes !== '')).toBe(true)
  for (const d of examples) expect(d.updatedAt.slice(0, 10) < TODAY).toBe(true)
})

test('the newest draft comes first, one with no time last', () => {
  const list = [draft({ title: 'B', updatedAt: '2026-03-01T09:00:00.000Z' }), draft({ title: 'Old', updatedAt: '' }), draft({ title: 'A', updatedAt: '2026-03-01T09:00:00.000Z' }), draft({ title: 'New', updatedAt: '2026-03-03T09:00:00.000Z' })]
  expect(newestFirst(list).map(d => d.title)).toEqual(['New', 'A', 'B', 'Old'])
  expect(list[0]!.title).toBe('B')
})

test('summary counts the drafts and the final ones', () => {
  expect(summary([])).toEqual({ total: 0, final: 0, inProgress: 0 })
  expect(summary([draft(), draft({ status: 'final' }), draft({ status: 'final' })])).toEqual({ total: 3, final: 2, inProgress: 1 })
})

test('a piece without a title gets its first line, without the marks of a heading', () => {
  expect(suggestTitle('# The new export is out\n\nBody.')).toBe('The new export is out')
  expect(suggestTitle('\n\n**Bold start**\nmore')).toBe('Bold start')
  expect(suggestTitle('')).toBe('Untitled draft')
  expect(suggestTitle(' \n # \n')).toBe('Untitled draft')
  const long = suggestTitle('word '.repeat(60))
  expect(long.length).toBeLessThanOrEqual(80)
  expect(long.endsWith('…')).toBe(true)
  expect(parseDraft({ title: long }).title).toBe(long)
})

test('gaps marked [NEEDS: …] are found and the text is cut around them', () => {
  const body = 'Before [NEEDS: a quote] middle [NEEDS: a number\non two lines] after.'
  expect(countGaps(body)).toBe(2)
  expect(gapParts(body)).toEqual([
    { text: 'Before ', gap: false },
    { text: '[NEEDS: a quote]', gap: true },
    { text: ' middle ', gap: false },
    { text: '[NEEDS: a number\non two lines]', gap: true },
    { text: ' after.', gap: false }
  ])
  expect(gapParts('plain')).toEqual([{ text: 'plain', gap: false }])
  expect(gapParts('')).toEqual([])
  expect(gapParts('[NEEDS: x]').map(p => p.gap)).toEqual([true])
  expect(gapParts(body).map(p => p.text).join('')).toBe(body)
  expect(countGaps('[needs: lower case] and [NEEDS without colon]')).toBe(0)
})

// The server functions: nobody signed in, nothing happens; a bad argument stops before the store.
const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})
const signIn = () => {
  process.env.MISO_CALLER_EMAIL = 'a@example.com'
  process.env.MISO_CALLER_ID = 'u1'
}

test('every draft function needs a signed-in member', async () => {
  delete process.env.MISO_CALLER_EMAIL
  delete process.env.MISO_CALLER_ID
  await expect(listDrafts()).rejects.toThrow('signed-in member')
  await expect(saveDraft(draft())).rejects.toThrow('signed-in member')
  await expect(removeDraft('r-1')).rejects.toThrow('signed-in member')
  await expect(writeDraft('notes', 'g-1')).rejects.toThrow('signed-in member')
  await expect(loadExamples(TODAY)).rejects.toThrow('signed-in member')
  await expect(removeExamples()).rejects.toThrow('signed-in member')
})

test('draft functions refuse bad arguments', async () => {
  signIn()
  await expect(saveDraft(draft({ title: '' }))).rejects.toThrow('Title is needed.')
  await expect(saveDraft(null)).rejects.toThrow('could not be read')
  await expect(saveDraft(draft({ text: 'a'.repeat(MAX_DRAFT_TEXT + 1) }))).rejects.toThrow('60000 characters at most')
  // The time of the change is the server's: what the browser sends for it is not what is checked.
  await expect(saveDraft({ ...draft({ updatedAt: 'yesterday' }), key: '../x' })).rejects.toThrow('could not be found')
  await expect(removeDraft('../x')).rejects.toThrow('could not be found')
  await expect(loadExamples('yesterday')).rejects.toThrow('Today must be a date.')
  await expect(loadExamples(undefined)).rejects.toThrow('Today is needed.')
})

test('writeDraft hands back a sentence, not an error, for notes or a guide it cannot use', async () => {
  signIn()
  expect(await writeDraft('   ', 'g-1')).toEqual({ ok: false, error: 'Paste your rough notes first.' })
  expect(await writeDraft(undefined, 'g-1')).toEqual({ ok: false, error: 'Paste your rough notes first.' })
  expect(await writeDraft(7, 'g-1')).toEqual({ ok: false, error: 'Notes text must be text.' })
  expect(await writeDraft('a'.repeat(MAX_NOTES + 1), 'g-1')).toEqual({ ok: false, error: 'Notes text is too long (60000 characters at most).' })
  expect(await writeDraft('some notes', '../x')).toMatchObject({ ok: false, error: expect.stringContaining('could not be found') })
  expect(await writeDraft('some notes', undefined)).toMatchObject({ ok: false })
})

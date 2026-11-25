import { afterEach, expect, test } from 'bun:test'

import { MAX_GUIDES, MAX_GUIDE_NAME, MAX_GUIDE_TEXT, exampleGuides, parseGuide, summary, type Guide } from './guides'
import { listGuides, removeGuide, saveGuide } from './writer.server'

const guide = (patch: Partial<Guide> = {}): Guide => ({ name: 'Plain and warm', text: 'Short sentences. Kind words.', ...patch })

test('parseGuide keeps the known fields, cleaned', () => {
  expect(parseGuide({ name: '  Plain   and warm ', text: '  Short sentences.\r\nKind words.  ', key: 'r-1', extra: 'x' })).toEqual({ name: 'Plain and warm', text: 'Short sentences.\nKind words.' })
})

test('parseGuide needs a name and the guide text', () => {
  expect(() => parseGuide(guide({ name: '' }))).toThrow('Name is needed.')
  expect(() => parseGuide(guide({ name: '   ' }))).toThrow('Name is needed.')
  expect(() => parseGuide(guide({ text: '' }))).toThrow('Guide text is needed')
  expect(() => parseGuide({ name: 'A' })).toThrow('Guide text is needed')
  expect(() => parseGuide({ name: 5, text: 'x' })).toThrow('Name must be text.')
  expect(() => parseGuide({ name: 'A', text: 5 })).toThrow('Guide text must be text.')
  expect(() => parseGuide(null)).toThrow('could not be read')
})

test('parseGuide says how long the name and the guide text may be', () => {
  expect(parseGuide(guide({ name: 'a'.repeat(MAX_GUIDE_NAME) })).name).toHaveLength(MAX_GUIDE_NAME)
  expect(() => parseGuide(guide({ name: 'a'.repeat(MAX_GUIDE_NAME + 1) }))).toThrow('Name is too long (60 characters at most).')
  expect(parseGuide(guide({ text: 'a'.repeat(MAX_GUIDE_TEXT) })).text).toHaveLength(30_000)
  expect(() => parseGuide(guide({ text: 'a'.repeat(MAX_GUIDE_TEXT + 1) }))).toThrow('Guide text is too long (30000 characters at most).')
})

test('a team keeps 50 guides at most', () => {
  expect(MAX_GUIDES).toBe(50)
})

test('the examples are two different voices that pass the check', () => {
  const examples = exampleGuides()
  expect(examples).toHaveLength(2)
  expect(examples.map(parseGuide)).toEqual(examples)
  expect(new Set(examples.map(g => g.name.toLowerCase())).size).toBe(2)
})

test('summary counts the guides and their text', () => {
  expect(summary([])).toEqual({ count: 0, characters: 0 })
  expect(summary([guide({ text: 'abc' }), guide({ name: 'B', text: 'de' })])).toEqual({ count: 2, characters: 5 })
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

test('every guide function needs a signed-in member', async () => {
  delete process.env.MISO_CALLER_EMAIL
  delete process.env.MISO_CALLER_ID
  await expect(listGuides()).rejects.toThrow('signed-in member')
  await expect(saveGuide(guide())).rejects.toThrow('signed-in member')
  await expect(removeGuide('r-1')).rejects.toThrow('signed-in member')
})

test('guide functions refuse bad arguments', async () => {
  signIn()
  await expect(saveGuide(guide({ name: '' }))).rejects.toThrow('Name is needed.')
  await expect(saveGuide(null)).rejects.toThrow('could not be read')
  await expect(saveGuide(guide({ text: 'a'.repeat(MAX_GUIDE_TEXT + 1) }))).rejects.toThrow('30000 characters at most')
  await expect(saveGuide({ ...guide(), key: '../x' })).rejects.toThrow('could not be found')
  await expect(removeGuide('../x')).rejects.toThrow('could not be found')
  await expect(removeGuide(42)).rejects.toThrow('could not be found')
})

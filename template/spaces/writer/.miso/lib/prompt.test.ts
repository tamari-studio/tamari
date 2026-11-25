import { expect, test } from 'bun:test'

import { NEEDS_RULE, WAIT_SECONDS, buildSystemPrompt } from './prompt'

test('the prompt names the voice it writes in', () => {
  const prompt = buildSystemPrompt({ name: 'Plain and warm', text: 'Short sentences.' })
  expect(prompt).toContain("You are a writing assistant, writing in Plain and warm's voice.")
  expect(prompt).toContain("as Plain and warm's own writing")
  expect(buildSystemPrompt({ name: '  Ada  ', text: 'x' })).toContain("writing in Ada's voice.")
})

test('the guide goes in between the markers, trimmed and word for word', () => {
  const prompt = buildSystemPrompt({ name: 'Ada', text: '\n  Line one.\n\nLine two.  \n' })
  expect(prompt).toContain('--- TONE REFERENCE ---\nLine one.\n\nLine two.\n--- END TONE REFERENCE ---')
})

test('the guide text stays literal, even with $&, $1, {name} and a placeholder in it', () => {
  const text = 'Use $& and $1 and $$ and $` and $\' in a row. Say {name} and {tone_reference} as they are.'
  const prompt = buildSystemPrompt({ name: 'Ada', text })
  expect(prompt).toContain(`--- TONE REFERENCE ---\n${text}\n--- END TONE REFERENCE ---`)
  expect(prompt.split('{name}')).toHaveLength(2)
  expect(prompt.split('{tone_reference}')).toHaveLength(2)
})

test('a voice name with a placeholder or $& in it stays as typed and cannot swallow the guide', () => {
  const name = 'Odd {tone_reference} $& name'
  const prompt = buildSystemPrompt({ name, text: 'The guide.' })
  expect(prompt).toContain(`writing in ${name}'s voice.`)
  expect(prompt).toContain('--- TONE REFERENCE ---\nThe guide.\n--- END TONE REFERENCE ---')
})

test('the prompt ends with the rule that a gap is marked, never invented', () => {
  const prompt = buildSystemPrompt({ name: 'Ada', text: 'x' })
  expect(prompt.endsWith(NEEDS_RULE)).toBe(true)
  expect(NEEDS_RULE).toContain('[NEEDS: ...]')
  expect(NEEDS_RULE).toContain('Never invent facts')
})

test('it asks for the article only, and names no organisation', () => {
  const prompt = buildSystemPrompt({ name: 'Ada', text: 'x' })
  expect(prompt).toContain('Reply with the article only')
  expect(prompt).not.toMatch(/organi[sz]ation|company|PR /i)
})

test('the wait the page names is the one the call gives up at', () => {
  expect(WAIT_SECONDS).toBe(45)
})

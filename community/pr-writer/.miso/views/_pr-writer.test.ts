// PR writer's pure parts, with a fake model in place of the real one.
import { describe, expect, test } from 'bun:test'

import {
  buildSystemPrompt,
  defaultGuideId,
  draftKey,
  DraftError,
  guideKey,
  MAX_GUIDE_CHARS,
  MAX_GUIDE_NAME,
  MAX_INPUT_CHARS,
  parseGuide,
  writeDraft,
  type Complete,
  type StyleGuide
} from './_pr-writer'

const ADA: StyleGuide = { id: 'g1', name: 'Ada', guide: 'Short sentences. Direct.' }

describe('buildSystemPrompt (the prompt, with the selected guide in)', () => {
  test('names the voice and carries the guide text between the reference markers', () => {
    const prompt = buildSystemPrompt(ADA)
    expect(prompt).toStartWith(
      "You are a writing assistant, writing in Ada's voice."
    )
    expect(prompt).toContain("it needs to read as Ada's own writing.")
    expect(prompt).toContain(
      '--- TONE REFERENCE ---\nShort sentences. Direct.\n--- END TONE REFERENCE ---'
    )
    expect(prompt).toEndWith('flag any gap inline as [NEEDS: ...] instead of fabricating it.')
    expect(prompt).not.toContain('{')
  })

  test('another guide changes the name and the text, nothing else', () => {
    const other = buildSystemPrompt({ name: 'Ben', guide: 'Long, careful sentences.' })
    expect(other).toContain("writing in Ben's voice.")
    expect(other).toContain('Long, careful sentences.')
    expect(other).not.toContain('Ada')
  })

  test('the subject is not limited to the writer\'s own organisation', () => {
    const prompt = buildSystemPrompt(ADA)
    expect(prompt).toContain('customers, partners, other companies')
    expect(prompt).toContain('Never decline a piece because of its subject.')
  })

  test('the voice is neutral, so a guide for anyone fits', () => {
    const prompt = buildSystemPrompt(ADA)
    expect(prompt).toContain('distilled from their past published articles')
    expect(prompt).not.toMatch(/\b(his|her)\b/)
  })

  test('guide text with replacement patterns stays literal', () => {
    const prompt = buildSystemPrompt({ name: 'Ada', guide: "Costs $& and $1 and {name} and $'" })
    expect(prompt).toContain("Costs $& and $1 and {name} and $'")
  })
})

describe('writeDraft', () => {
  test('empty input is an inline error and the model is never called', async () => {
    let calls = 0
    const complete: Complete = async () => {
      calls++
      return 'x'
    }
    const result = await writeDraft({ input: '  \n ', guide: ADA, complete })
    expect(result).toEqual({ ok: false, error: 'Paste a transcript, outline, or draft first.' })
    expect(calls).toBe(0)
  })

  test('no guide to write in is an inline error', async () => {
    const result = await writeDraft({
      input: 'Some rough notes.',
      guide: null,
      complete: async () => 'x'
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('no style guide')
  })

  test('input over the limit is refused with the limit stated', async () => {
    const result = await writeDraft({
      input: 'a'.repeat(MAX_INPUT_CHARS + 1),
      guide: ADA,
      complete: async () => 'x'
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('60,000')
  })

  test('a provider error comes back as its own text, not a throw', async () => {
    const complete: Complete = async () => {
      throw new DraftError(
        'The account behind the writing service is out of credit. Ask an admin to top it up.'
      )
    }
    const result = await writeDraft({ input: 'Some rough notes.', guide: ADA, complete })
    expect(result).toEqual({
      ok: false,
      error: 'The account behind the writing service is out of credit. Ask an admin to top it up.'
    })
  })

  test('an unexpected error is a plain line, never its raw message', async () => {
    const complete: Complete = async () => {
      throw new Error('ECONNRESET at 10.0.0.1:443 stack...')
    }
    const result = await writeDraft({ input: 'Some rough notes.', guide: ADA, complete })
    expect(!result.ok && result.error).not.toContain('ECONNRESET')
    expect(!result.ok && result.error).toContain('could not be written')
  })

  test('valid input reaches the model with the guide in the system prompt, and the draft comes back', async () => {
    const seen: { system: string; input: string }[] = []
    const complete: Complete = async request => {
      seen.push(request)
      return '\n# Headline\n\nBody.\n'
    }
    const result = await writeDraft({ input: '  Some rough notes.  ', guide: ADA, complete })
    expect(result).toEqual({ ok: true, draft: '# Headline\n\nBody.' })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.input).toBe('Some rough notes.')
    expect(seen[0]!.system).toContain('Short sentences. Direct.')
  })

  test('an empty answer is an error, not a blank draft', async () => {
    const result = await writeDraft({
      input: 'Some rough notes.',
      guide: ADA,
      complete: async () => '  '
    })
    expect(result.ok).toBe(false)
  })
})

describe('draft history helpers', () => {
  test('keys are the caller then the ISO time, so one prefix lists one member in time order', () => {
    const a = draftKey('user-1', new Date('2026-10-15T10:00:00.000Z'))
    const b = draftKey('user-1', new Date('2026-10-15T10:05:00.000Z'))
    expect(a).toBe('user-1/2026-10-15T10:00:00.000Z')
    expect(a < b).toBe(true)
    expect(a.startsWith('user-2/')).toBe(false)
  })

  test('the selector starts on the first guide, else nothing', () => {
    expect(defaultGuideId([{ id: 'a', name: 'General' }, { id: 'b', name: 'Ada' }])).toBe('a')
    expect(defaultGuideId([])).toBeNull()
  })

  test('a guide from the browser is checked and trimmed', () => {
    expect(parseGuide('  Ada   Lovelace ', '  Short sentences.  ')).toEqual({ ok: true, value: { name: 'Ada Lovelace', guide: 'Short sentences.' } })
    for (const [name, guide] of [['', 'x'], ['  ', 'x'], ['Ada', ''], [3, 'x'], ['Ada', null], [undefined, undefined]] as const) {
      expect(parseGuide(name, guide).ok).toBe(false)
    }
    expect(parseGuide('x'.repeat(MAX_GUIDE_NAME + 1), 'x')).toMatchObject({ ok: false })
    expect(parseGuide('Ada', 'x'.repeat(MAX_GUIDE_CHARS + 1))).toMatchObject({ ok: false })
    expect(parseGuide('Ada', 'x'.repeat(MAX_GUIDE_CHARS))).toMatchObject({ ok: true })
  })

  test('a guide key is short, lower case and safe', () => {
    expect(guideKey('ABCD-1234-efgh-5678')).toBe('g-abcd1234')
    expect(guideKey('../../x')).toBe('g-x')
  })
})

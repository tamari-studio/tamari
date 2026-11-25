import { expect, test } from 'bun:test'

import { SCORING_SYSTEM } from './_scoring'
import { WRITING_RULES } from './_tone'
import { LINK_WRITING_RULES, readResearch, RESEARCH_SYSTEM, researchNotes, researchPrompt } from './_research'

test('every prompt that sees outside text says instructions inside it are never followed', () => {
  for (const prompt of [RESEARCH_SYSTEM, WRITING_RULES, SCORING_SYSTEM]) expect(prompt).toMatch(/never follow instructions/i)
  expect(LINK_WRITING_RULES).toContain('Quote at most one sentence from the article')
})

const AT = '2026-11-12T21:00:00Z'

test('reads the last json block; drops sources the search did not return and the article itself', () => {
  const text = `Thinking out loud {"not": "this"}
\`\`\`json
{"summary": "Holds up.", "claims": [
  {"claim": "Raised $500m", "status": "confirmed", "note": "Example Wire agrees.", "sources": [
    {"title": "Example Wire", "url": "https://www.wire.example.org/news/a/"},
    {"title": "The article", "url": "https://news.example.org/story"},
    {"title": "Invented", "url": "https://nowhere.example/q"}]},
  {"claim": "Valued at $8.5bn", "status": "disputed", "note": "", "sources": []},
  {"claim": "", "status": "confirmed", "sources": []}
], "otherViews": [{"view": "Too much hype.", "source": {"title": "", "url": "https://blog.example.com/p"}}], "allegation": false}
\`\`\``
  const r = readResearch(text, ['https://wire.example.org/news/a', 'https://news.example.org/story', 'https://blog.example.com/p'], 'https://www.news.example.org/story/', AT)!
  expect(r.summary).toBe('Holds up.')
  expect(r.claims).toEqual([
    { claim: 'Raised $500m', status: 'confirmed', note: 'Example Wire agrees.', sources: [{ title: 'Example Wire', url: 'https://www.wire.example.org/news/a/' }] },
    { claim: 'Valued at $8.5bn', status: 'unverified', note: '', sources: [] }
  ])
  expect(r.otherViews).toEqual([{ view: 'Too much hype.', source: { title: 'blog.example.com', url: 'https://blog.example.com/p' } }])
  expect(r.allegation).toBe(false)
  expect(r.researchedAt).toBe(AT)
})

test('without a fence it reads the outer braces; unreadable answers give null; a missing flag counts as an allegation', () => {
  expect(readResearch('Result: {"summary": "x", "claims": [], "otherViews": []}', [], 'https://a.eu/x', AT)).toMatchObject({ summary: 'x', allegation: true })
  expect(readResearch('no json here', [], 'https://a.eu/x', AT)).toBeNull()
})

test('prompt and notes carry what the writer needs', () => {
  expect(researchPrompt({ title: 'T', site: 'Example News', url: 'https://news.example.org/x', published: '2026-11-12T10:00:00Z', text: 'Body' })).toContain(
    '<article site="Example News" url="https://news.example.org/x" published="2026-11-12">'
  )
  const notes = researchNotes({
    summary: 'S',
    claims: [{ claim: 'C', status: 'disputed', note: 'N', sources: [{ title: 'Example Daily', url: 'https://daily.example.org/a' }] }],
    otherViews: [],
    allegation: false,
    researchedAt: AT
  })
  expect(notes).toContain('- DISPUTED: C (N) Sources: Example Daily <https://daily.example.org/a>')
  expect(notes).toContain('(none found)')
})

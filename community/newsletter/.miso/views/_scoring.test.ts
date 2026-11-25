import { expect, test } from 'bun:test'

import { CHANNEL } from './_channel'
import {
  applyEdit,
  applySuggestion,
  DEFAULT_CRITERIA,
  DEFAULT_SETTINGS,
  isEuropean,
  normalizeSettings,
  readRatings,
  readSuggestion,
  SCORING_SYSTEM,
  scoringPrompt,
  scoringSchema,
  SUGGEST_SYSTEM,
  suggestPrompt,
  weightedScore,
  type Ratings
} from './_scoring'

const all = (n: number): Ratings => ({ topic: n, europe: n, significance: n, novelty: n, audience: n })

test('the weighted score runs 0–100 and follows the weights', () => {
  expect(weightedScore(all(10))).toBe(100)
  expect(weightedScore(all(0))).toBe(0)
  expect(weightedScore(all(5))).toBe(50)
  // Only the region rating set: its weight share (25 of 100) of the full score.
  expect(weightedScore({ ...all(0), europe: 10 })).toBe(25)
  const onlyEurope = DEFAULT_CRITERIA.map(c => ({ ...c, weight: c.id === 'europe' ? 1 : 0 }))
  expect(weightedScore({ ...all(0), europe: 7 }, onlyEurope)).toBe(70)
  expect(weightedScore(all(9), DEFAULT_CRITERIA.map(c => ({ ...c, weight: 0 })))).toBe(0)
  expect(weightedScore({ ...all(0), topic: 40 })).toBe(30)
})

test('in region means centred in the focus region (europe) or rated 6+', () => {
  expect(isEuropean({ region: 'europe', europe: 2 })).toBe(true)
  expect(isEuropean({ region: 'us', europe: 6 })).toBe(true)
  expect(isEuropean({ region: 'us', europe: 5 })).toBe(false)
})

test('reads only the asked ids, clamps ratings and fixes unknown regions', () => {
  const json = JSON.stringify({
    ratings: [
      { id: 'a', topic: 12, europe: -1, significance: 4.6, novelty: 'x', audience: 3, region: 'mars', reason: ' Big round. ', allegation: false },
      { id: 'zzz', topic: 1, europe: 1, significance: 1, novelty: 1, audience: 1, region: 'us', reason: '', allegation: false }
    ]
  })
  const out = readRatings(json, ['a', 'b'])
  expect([...out.keys()]).toEqual(['a'])
  expect(out.get('a')).toEqual({ id: 'a', region: 'other', reason: 'Big round.', allegation: false, topic: 10, europe: 0, significance: 5, novelty: 0, audience: 3 })
  expect(readRatings('not json', ['a']).size).toBe(0)
})

test('the allegation flag: only an explicit false clears a story for drafting', () => {
  const row = { topic: 5, europe: 5, significance: 5, novelty: 5, audience: 5, region: 'us', reason: '' }
  const read = (allegation: unknown) =>
    readRatings(JSON.stringify({ ratings: [{ id: 'a', ...row, ...(allegation === undefined ? {} : { allegation }) }] }), ['a']).get('a')!.allegation
  expect(read(false)).toBe(false)
  expect(read(true)).toBe(true)
  expect(read(undefined)).toBe(true)
  expect(read('no')).toBe(true)
  expect(SCORING_SYSTEM).toContain('unproven allegations about a named person')
})

test('the prompt names every criterion and every article; the schema requires them', () => {
  const prompt = scoringPrompt([{ id: '2026-11-12-abc', source: 'Example Wire', title: 'T', text: '' }])
  for (const c of DEFAULT_CRITERIA) expect(prompt).toContain(`- ${c.id} (${c.name})`)
  expect(prompt).toContain('<article id="2026-11-12-abc" source="Example Wire">')
  expect(prompt).toContain('(the feed gives only the title)')
  const schema = scoringSchema() as { properties: { ratings: { items: { required: string[] } } } }
  expect(schema.properties.ratings.items.required).toEqual(['id', 'topic', 'europe', 'significance', 'novelty', 'audience', 'region', 'reason', 'allegation'])
})

test('stored settings are made safe: every criterion once, in order, values in range', () => {
  expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  const odd = normalizeSettings({
    maxAgeDays: 99,
    minScore: -5,
    criteria: [
      { id: 'audience', weight: 250, description: '  Mine  ', byHand: { weight: true } },
      { id: 'made-up', weight: 50 },
      { id: 'topic', weight: 'x', description: '' }
    ]
  })
  expect(odd.maxAgeDays).toBe(7)
  expect(odd.minScore).toBe(0)
  expect(odd.criteria.map(c => c.id)).toEqual(['topic', 'europe', 'significance', 'novelty', 'audience'])
  expect(odd.criteria[0]).toMatchObject({ weight: 30, description: DEFAULT_CRITERIA[0]!.description })
  expect(odd.criteria[4]).toMatchObject({ weight: 100, description: 'Mine', byHand: { description: false, weight: true } })
})

test('an edit marks only the values that changed as edited by hand', () => {
  const edit = {
    maxAgeDays: 5,
    minScore: 50,
    criteria: DEFAULT_SETTINGS.criteria.map(c => ({ id: c.id, description: c.description, weight: c.id === 'europe' ? 40 : c.weight }))
  }
  const next = applyEdit(DEFAULT_SETTINGS, edit)
  expect(next.maxAgeDays).toBe(5)
  expect(next.minScore).toBe(50)
  expect(next.criteria.find(c => c.id === 'europe')).toMatchObject({ weight: 40, byHand: { description: false, weight: true } })
  expect(next.criteria.filter(c => c.byHand.weight || c.byHand.description)).toHaveLength(1)
  // Setting it back doesn't clear the mark: only a person decides that.
  const back = applyEdit(next, { ...edit, criteria: edit.criteria.map(c => (c.id === 'europe' ? { ...c, weight: 25 } : c)) })
  expect(back.criteria.find(c => c.id === 'europe')!.byHand.weight).toBe(true)
  // An emptied description keeps the old one.
  const blank = applyEdit(DEFAULT_SETTINGS, { ...edit, criteria: edit.criteria.map(c => ({ ...c, description: ' ' })) })
  expect(blank.criteria[0]!.description).toBe(DEFAULT_CRITERIA[0]!.description)
})

test('a suggestion never overwrites a value edited by hand', () => {
  const edited = applyEdit(DEFAULT_SETTINGS, {
    maxAgeDays: 3,
    minScore: 40,
    criteria: DEFAULT_SETTINGS.criteria.map(c => ({ id: c.id, description: c.id === 'topic' ? 'Hand.' : c.description, weight: c.id === 'topic' ? 5 : c.weight }))
  })
  const suggestions = DEFAULT_CRITERIA.map(c => ({ id: c.id, weight: 77, description: `AI ${c.id}`, reason: `R ${c.id}` }))
  const next = applySuggestion(edited, suggestions, '2026-11-12T21:00:00Z')
  expect(next.suggestedAt).toBe('2026-11-12T21:00:00Z')
  expect(next.criteria[0]).toMatchObject({ description: 'Hand.', weight: 5, suggestionNote: 'R topic' })
  expect(next.criteria[1]).toMatchObject({ description: 'AI europe', weight: 77, byHand: { description: false, weight: false } })
})

test('reads a suggestion: known ids once, weights clamped; bad JSON gives nothing', () => {
  const json = JSON.stringify({
    criteria: [
      { id: 'europe', weight: 140, description: ' D ', reason: 'R' },
      { id: 'europe', weight: 1, description: 'again', reason: '' },
      { id: 'vibes', weight: 50, description: 'x', reason: '' }
    ]
  })
  expect(readSuggestion(json)).toEqual([{ id: 'europe', weight: 100, description: 'D', reason: 'R' }])
  expect(readSuggestion('{')).toEqual([])
})

test('the suggest prompt lists the criteria and the reviewers decisions', () => {
  const prompt = suggestPrompt(DEFAULT_SETTINGS, [{ title: 'Meridian raises', status: 'approved', ratings: { topic: 9, europe: 9, significance: 8, novelty: 7, audience: 9 } }])
  expect(prompt).toContain('- europe (Region fit), weight 25:')
  expect(prompt).toContain('- APPROVED: Meridian raises (ratings topic 9, europe 9, significance 8, novelty 7, audience 9)')
  expect(suggestPrompt(DEFAULT_SETTINGS, [])).toContain('(no posts reviewed yet)')
})

test('the criteria and both system prompts are built from the channel description', () => {
  expect(SCORING_SYSTEM).toContain(CHANNEL.name)
  expect(SCORING_SYSTEM).toContain(CHANNEL.audience)
  expect(SUGGEST_SYSTEM).toContain(CHANNEL.name)
  expect(SUGGEST_SYSTEM).toContain(CHANNEL.regionFocus)
  expect(DEFAULT_CRITERIA.find(c => c.id === 'europe')!.description).toContain(CHANNEL.regionFocus)
  expect(DEFAULT_CRITERIA.find(c => c.id === 'audience')!.description).toContain(CHANNEL.audience)
})

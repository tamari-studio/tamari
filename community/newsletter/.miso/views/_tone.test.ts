import { expect, test } from 'bun:test'

import { CHANNEL } from './_channel'
import { canDraft, draftPrompt, rewritePrompt, sourceText, styleWarnings, TONE_GUIDE, withSourceLink, wordTarget } from './_tone'

const base = { sourceName: 'Example Wire', title: 'Meridian revenue leaps', url: 'https://example.org/x', published: '2026-11-12T15:55:00Z' }

test('a title-only item cannot be drafted; length follows the input', () => {
  expect(canDraft({ summary: '', content: '' })).toBe(false)
  expect(canDraft({ summary: 'x'.repeat(150), content: '' })).toBe(true)
  expect(wordTarget({ summary: 'x'.repeat(300), content: '' })).toEqual([60, 120])
  expect(wordTarget({ summary: 'short', content: 'y'.repeat(2000) })).toEqual([120, 200])
  expect(sourceText({ summary: 'short', content: 'longer text' })).toBe('longer text')
})

test('the draft prompt carries the source text and the word range', () => {
  const prompt = draftPrompt({ ...base, summary: 'Meridian reported revenue of $981m.', content: '' })
  expect(prompt).toContain('<text>\nMeridian reported revenue of $981m.\n</text>')
  expect(prompt).toContain('60–120 words')
})

test('the rewrite prompt carries the draft and the note, or asks for a fresh version', () => {
  const article = { ...base, summary: 'Meridian reported revenue of $981m.', content: '' }
  expect(rewritePrompt(article, 'Old draft', 'Shorter please')).toContain('The reviewer asked for this change: Shorter please')
  expect(rewritePrompt(article, 'Old draft', ' ')).toContain('a fresh version')
  expect(rewritePrompt(article, 'Old draft', '')).toContain('<current_draft>\nOld draft\n</current_draft>')
})

test('style warnings catch the machine-writing patterns, and pass a plain post', () => {
  expect(styleWarnings('Aurora Ventures has led a $500m round in Meridian Labs.\n\nNext to watch: how fast it grows.\n\nSource: https://example.org/x')).toEqual(['colon reveal'])
  expect(styleWarnings('The deal is a game-changer, underscoring its pivotal role — truly a landscape shift.')).toEqual(
    ['"game-changer"', '"underscoring"', '"pivotal"', '"landscape"', 'em dash', 'trailing commentary']
  )
  expect(styleWarnings("This isn't a chip company, it's a platform. Experts say so! Ultimately, who knows?")).toEqual(
    ['binary contrast', 'unnamed source', 'question', 'summary ending', 'exclamation mark']
  )
  expect(styleWarnings('Orion 4 Helium beats the larger Neon on benchmarks, Example Wire reports. It costs less per task.\n\nSource: https://x.example/a?b=1')).toEqual([])
})

test('the guide is built from the channel and carries both example posts, and each passes its own style check', () => {
  const references = [...TONE_GUIDE.matchAll(/<reference_post>\n([\s\S]*?)\n<\/reference_post>/g)].map(m => m[1]!)
  expect(references).toHaveLength(2)
  expect(references[0]).toStartWith('Aurora Ventures has led a €40m Series B in Meridian Labs')
  expect(references[1]).toStartWith('Quarry Robotics has started shipping its first warehouse picking robot')
  for (const reference of references) expect(styleWarnings(reference)).toEqual([])
  expect(TONE_GUIDE).toContain('Never reuse their facts, names or phrases in another post.')
  expect(TONE_GUIDE).toStartWith(`# ${CHANNEL.name}: tone guide`)
  for (const heading of ['## Voice', '## Choosing what to say', '## Shape of a post', '## The standard', '## Never use these', '## Accuracy']) {
    expect(TONE_GUIDE).toContain(heading)
  }
  expect(TONE_GUIDE).toContain('"the company says"')
})

// A link post that read as machine-written: it retold the article in order, reused its
// example and ran long.
const RETOLD = `Vienna startup Plumtree has taken its AI browser out of beta with version 1.0, aimed at people in sales, marketing, recruitment and customer service who do not write code. It runs on desktop computers, with a free plan and paid subscriptions from $20 a month.

The browser's assistants, which Plumtree calls companions, are trained by a user to do one job. A salesperson might teach one to research potential clients, contact them and enter their details in a sales database. Version 1.0 lets colleagues use that trained companion without starting over. Companions can run on a schedule or start when a new email or sales lead arrives, and for bigger jobs one can split the work among several sub-agents running in parallel.

Version 1.0 also records video calls on the user's own computer, so no bot has to join, and turns them into notes and follow-up tasks.

Plumtree says companions pause for approval before they send emails, publish posts or change records. Passwords stay in the user's browser, and companies can keep customer data within the EU.

The company has 12 people. It raised $6 million in October 2025 in a round co-led by Aurora Ventures and Harbor Capital, with the founders of three software companies also investing.

Source: https://news.example.org/plumtree-browser-1-0`

// The same story, chosen and written to the standard. It still scored 100% on a reader's
// checker: generic how-it-works sentences read as machine-written. "Every sentence carries
// something concrete" is the rule that followed (a denser version scored 55%).
const CHOSEN = `Vienna's Plumtree has taken its AI browser out of beta. Version 1.0 is for people in sales, marketing, recruitment and customer service who don't write code, and it is free to start, with paid plans from $20 a month.

Users train assistants, which Plumtree calls companions, to do one job each. What's new is that a whole team can now use a companion one person trained. "Today the person who is great with AI tools keeps all of it on their own laptop," said the chief executive.

Companions ask before they send an email, publish a post or change a record. The 12-person company raised $6m in October 2025 in a round co-led by Aurora Ventures and Harbor Capital.

Source: https://news.example.org/plumtree-browser-1-0`

test('the style check flags a hypothetical example and repeated openings, not length', () => {
  // Length and paragraph count were dropped as warnings: a longer approved post scored 0% on a
  // reader's checker while the 119-word CHOSEN scored 100%.
  expect(styleWarnings(RETOLD)).toEqual(['hypothetical example'])
  expect(styleWarnings(CHOSEN)).toEqual([])
  expect(TONE_GUIDE).toContain('Every sentence carries something concrete')
  expect(styleWarnings('Meridian has raised €2bn. Meridian has also hired.\n\nSource: https://x.example')).toEqual(['repeated opening'])
  expect(styleWarnings('Meridian has raised €2bn.\n\nThe round values it at €12bn.\n\nMeridian has hired 40 people.')).toEqual(['repeated opening'])
  expect(TONE_GUIDE).toContain('Never retell the article paragraph by paragraph in its own order')
  expect(TONE_GUIDE).toContain('No hypothetical examples')
})

test('the accuracy rules forbid moving attribution to the company and inferring dates', () => {
  const accuracy = TONE_GUIDE.slice(TONE_GUIDE.indexOf('## Accuracy'))
  expect(accuracy).toContain('Attribute a statement to the company only when the source attributes it to the company')
  expect(accuracy).toContain('Never turn "reported in <month>" or "covered in <month>" into "happened in <month>"')
  expect(accuracy).toContain("never infer a date or an event the source doesn't state")
})

test('every post ends with exactly one source line', () => {
  expect(withSourceLink('"Body text."\n\nSource: https://wrong.example', 'https://example.org/x')).toBe('Body text.\n\nSource: https://example.org/x')
  expect(withSourceLink('Body', 'https://example.org/x')).toBe('Body\n\nSource: https://example.org/x')
})

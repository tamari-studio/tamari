// The run steps and post decisions against an in-memory store, fake feeds and a fake AI, so
// neither the shared dataset nor Anthropic is touched.
import { afterAll, beforeEach, expect, mock, test } from 'bun:test'

import { CHANNEL } from './_channel'
import { NO_SOURCES_MESSAGE, SOURCES, type Source } from './_sources'

// The space ships with an empty source list. These eight invented feeds stand in for a real one:
// one answers HTTP 500, two carry the same headline, one is rated as resting on allegations, and
// two count as in the focus region.
const FIXTURE_SOURCES: Source[] = [
  { id: 'venture-daily', name: 'Venture Daily', url: 'https://venturedaily.example.org/feed', site: 'https://venturedaily.example.org', region: 'europe', method: 'rss', topics: 'Startups and funding rounds', europe: 5, carries: 'title' },
  { id: 'startup-ledger', name: 'Startup Ledger', url: 'https://startupledger.example.org/feed/', site: 'https://startupledger.example.org', region: 'europe', method: 'rss', topics: 'Startup funding rounds and launches', europe: 5, carries: 'full text' },
  { id: 'continental-tech', name: 'Continental Tech', url: 'https://continentaltech.example.org/feed/', site: 'https://continentaltech.example.org', region: 'europe', method: 'rss', topics: 'Tech, funding rounds, policy', europe: 5, carries: 'full text' },
  { id: 'ai-wire', name: 'AI Wire', url: 'https://aiwire.example.org/category/ai/feed/', site: 'https://aiwire.example.org', region: 'us', method: 'rss', topics: 'AI startups, models, funding', europe: 3, carries: 'summary' },
  { id: 'model-notes', name: 'Model Notes', url: 'https://modelnotes.example.org/feed/', site: 'https://modelnotes.example.org', region: 'europe', method: 'rss', topics: 'AI models, research and industry news', europe: 3, carries: 'summary' },
  { id: 'east-tech', name: 'East Tech', url: 'https://easttech.example.org/feed/', site: 'https://easttech.example.org', region: 'china', method: 'rss', topics: 'Tech, AI models and startups', europe: 2, carries: 'full text' },
  { id: 'frontier-lab', name: 'Frontier Lab', url: 'https://frontierlab.example.org/news/rss.xml', site: 'https://frontierlab.example.org/news/', region: 'us', method: 'rss', topics: 'Model releases, products, research', europe: 2, carries: 'summary' },
  { id: 'research-lab', name: 'Research Lab', url: 'https://researchlab.example.org/blog/rss.xml', site: 'https://researchlab.example.org/blog/', region: 'global', method: 'rss', topics: 'Model releases and research', europe: 2, carries: 'title' }
]
SOURCES.push(...FIXTURE_SOURCES)

type Row = { key: string; data: unknown; updatedAt: number }
const db = new Map<string, Map<string, Row>>()
let tick = 0
mock.module('@miso/store', () => ({
  collection: (name: string) => {
    const rows = () => db.get(name) ?? db.set(name, new Map()).get(name)!
    return {
      get: async (key: string) => rows().get(key) ?? null,
      list: async (o: { prefix?: string; order?: string; limit?: number } = {}) => {
        let list = [...rows().values()].filter(r => !o.prefix || r.key.startsWith(o.prefix))
        if (o.order === 'key') list.sort((a, b) => a.key.localeCompare(b.key))
        else if (o.order === 'key-desc') list.sort((a, b) => b.key.localeCompare(a.key))
        else list.sort((a, b) => b.updatedAt - a.updatedAt)
        return list.slice(0, o.limit ?? 1000).map(r => structuredClone(r))
      },
      put: async (key: string, data: unknown) => {
        rows().set(key, { key, data: structuredClone(data), updatedAt: ++tick })
      },
      putMany: async (entries: { key: string; data: unknown }[]) => {
        for (const e of entries) rows().set(e.key, { key: e.key, data: structuredClone(e.data), updatedAt: ++tick })
        return entries.length
      },
      remove: async (key: string) => {
        rows().delete(key)
      }
    }
  }
}))
mock.module('@miso/caller', () => ({ callerEmail: () => 'ann@example.org' }))

class LlmError extends Error {}
class KeyMissingError extends LlmError {}
let keySet = true
let rateFails: string | null = null
const written: string[] = []
mock.module('./_llm', () => ({
  KEY_ENV: 'NEWSLETTER_ANTHROPIC_KEY',
  KEY_MISSING: 'KEY MISSING',
  WRITE_MODEL: 'claude-sonnet-5-5',
  LlmError,
  KeyMissingError,
  hasKey: () => keySet,
  rateArticles: async ({ prompt }: { prompt: string }) => {
    if (rateFails) throw new LlmError(rateFails)
    const ids = [...prompt.matchAll(/<article id="([^"]+)" source="([^"]+)">/g)]
    return JSON.stringify({
      ratings: ids.map(([, id, source]) => {
        const eu = source === 'Startup Ledger' || source === 'Continental Tech'
        // Frontier Lab's story is flagged as resting on allegations: it scores highest but is never drafted.
        const allegation = source === 'Frontier Lab'
        if (allegation) return { id, topic: 10, europe: 10, significance: 10, novelty: 10, audience: 10, region: 'us', reason: 'Scandal.', allegation }
        return { id, topic: 8, europe: eu ? 9 : 1, significance: eu ? 6 : 9, novelty: 7, audience: 7, region: eu ? 'europe' : 'us', reason: 'Relevant.', allegation }
      })
    })
  },
  writeBlog: async ({ system, input }: { system: string; input: string }) => {
    blogCalls.push({ system, input })
    if (blogFails) throw new LlmError(blogFails)
    return JSON.stringify({ title: 'Meridian raises €50m', body: 'Meridian raises €50m\n\nMeridian has raised €50m.\n\nAurora Ventures led the round.' })
  },
  writePost: async ({ input }: { input: string }) => {
    written.push(input)
    return `Post written from: ${/<title>(.*)<\/title>/.exec(input)?.[1]}`
  },
  researchWithSearch: async ({ prompt }: { prompt: string }) => {
    researchPrompts.push(prompt)
    const json = {
      summary: 'Example Wire confirms the round; one analyst doubts the valuation.',
      claims: [
        { claim: 'Raised €50m', status: 'confirmed', note: 'Example Wire reports the same amount.', sources: [{ title: 'Example Wire', url: 'https://www.wire.example.org/x' }, { title: 'Made up', url: 'https://invented.example/y' }] },
        { claim: 'Valued at €1bn', status: 'confirmed', note: 'Only the made-up source says so.', sources: [{ title: 'Made up', url: 'https://invented.example/z' }] }
      ],
      otherViews: [{ view: 'An analyst calls the valuation rich.', source: { title: 'Example Daily', url: 'https://daily.example.org/a/' } }],
      allegation: researchAllegation
    }
    return { text: `Notes first.\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``, searchedUrls: ['https://wire.example.org/x', 'https://www.daily.example.org/a'] }
  },
  suggestCriteria: async ({ prompt }: { prompt: string }) => {
    suggestPrompts.push(prompt)
    return JSON.stringify({
      criteria: ['topic', 'europe', 'significance', 'novelty', 'audience'].map(id => ({
        id,
        weight: id === 'europe' ? 60 : 10,
        description: `AI description for ${id}`,
        reason: `Because ${id}.`
      }))
    })
  }
}))
const blogCalls: { system: string; input: string }[] = []
let blogFails: string | null = null
const suggestPrompts: string[] = []
const researchPrompts: string[] = []
let researchAllegation = false

const recent = new Date(Date.now() - 3_600_000).toUTCString()
const SUMMARY = 'A long enough summary of a real funding round, with the amount, the investors and what the startup builds next with the new money in Europe.'
function rss(host: string, titles: string[]): string {
  const items = titles
    .map((t, i) => `<item><title>${t}</title><link>https://${host}/${i}</link><description>${SUMMARY}</description><pubDate>${recent}</pubDate></item>`)
    .join('')
  return `<rss version="2.0"><channel>${items}</channel></rss>`
}
const ARTICLE_PARAGRAPH = 'Lisbon startup Meridian has raised €50m to build AI agents for insurers, the company said on Thursday. '
const ARTICLE_HTML = `<html><head><title>Ignored</title>
<meta property="og:title" content="Meridian raises &euro;50m for insurance AI agents">
<meta property="og:site_name" content="Example News">
<meta property="og:description" content="The Lisbon startup raised a Series B.">
<meta property="article:published_time" content="${new Date(Date.now() - 3_600_000).toISOString()}">
</head><body><nav>Home | Tech</nav><article><h1>Meridian raises €50m</h1>${`<p>${ARTICLE_PARAGRAPH}</p>`.repeat(6)}<script>track()</script></article><footer>© Example</footer></body></html>`
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input)
  const host = new URL(url).hostname
  if (host === 'news.example.com') return new Response(ARTICLE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  if (host === 'paywall.example.com') return new Response('Subscribe', { status: 403 })
  if (host === 'moved.example.com') return new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/admin' } })
  if (host.includes('easttech')) return new Response('nope', { status: 500 })
  // Two feeds carry the same story: it must be stored once.
  const titles = host.includes('aiwire') ? ['Shared headline', `${host} news`] : host.includes('modelnotes') ? ['Shared headline!'] : [`${host} news`]
  return new Response(rss(host, titles), { headers: { 'content-type': 'application/rss+xml' } })
}) as typeof fetch
afterAll(() => {
  globalThis.fetch = realFetch
  SOURCES.length = 0
})

// No real DNS in tests: the fake sites resolve to a public address, one to loopback.
const page = await import('./_page')
page.setResolverForTests(async host => (host === 'rebind.example.com' ? ['127.0.0.1'] : ['93.184.215.14']))

const server = await import('./news.server')

beforeEach(() => {
  db.clear()
  written.length = 0
  keySet = true
  rateFails = null
  researchAllegation = false
  blogCalls.length = 0
  blogFails = null
})

async function runAll() {
  const { startedAt } = await server.startRun()
  const steps = []
  for (let i = 0; i < 20; i++) {
    const step = await server.runStep(startedAt)
    steps.push(step)
    if (step.done) break
  }
  return steps
}

test('a full run fetches every feed, rates, and drafts two posts with at least one European', async () => {
  const steps = await runAll()
  expect(steps.map(s => s.step)).toEqual(['fetch', 'fetch', 'fetch', 'score', 'write', 'write', 'idle'])
  expect(steps.at(-1)).toMatchObject({ done: true, message: "Today's two posts are drafted." })
  expect(steps[0]!.message).toContain('feeds to go')

  const { sources } = await server.listSources()
  const eastTech = sources.find(s => s.id === 'east-tech')!
  expect(eastTech.status).toMatchObject({ ok: false, error: 'answered HTTP 500' })
  expect(sources.filter(s => s.status?.ok)).toHaveLength(7)

  const { articles } = await server.listArticles()
  expect(articles.filter(a => a.title.startsWith('Shared headline'))).toHaveLength(1)
  expect(articles.every(a => a.score !== null)).toBe(true)
  // The flagged story scores 100 and ranks first, but no post is written from it.
  const flagged = articles.find(a => a.sourceId === 'frontier-lab')!
  expect(flagged).toMatchObject({ allegation: true, postKey: null, score: 100 })
  expect(articles[0]!.key).toBe(flagged.key)

  const { posts, sourceCount } = await server.listPosts()
  expect(sourceCount).toBe(FIXTURE_SOURCES.length)
  expect(posts).toHaveLength(2)
  expect(posts.some(p => p.european)).toBe(true)
  for (const p of posts) {
    expect(p.text).toEndWith(`Source: ${p.url}`)
    expect(p.status).toBe('draft')
    expect(p.excerpt).toBe(SUMMARY)
  }
  // A second run fetches again but finds nothing new to rate or write.
  const again = await runAll()
  expect(again.at(-1)!.message).toBe("Today's two posts are drafted.")
  expect(again.filter(s => s.step === 'score')).toHaveLength(0)
})

test('without the key, the run fetches and then stops with the key message', async () => {
  keySet = false
  const steps = await runAll()
  expect(steps.at(-1)).toMatchObject({ done: true, step: 'idle', warning: 'KEY MISSING' })
  expect(written).toHaveLength(0)
})

test('a failed rating call ends the run with the reason and counts the attempt', async () => {
  rateFails = 'The AI service is busy right now.'
  const steps = await runAll()
  expect(steps.at(-1)).toMatchObject({ done: true, step: 'score', warning: 'The AI service is busy right now.' })
  const { articles } = await server.listArticles()
  expect(articles.every(a => a.scoreError === 'The AI service is busy right now.')).toBe(true)
})

test('edit text by hand: kept as a version, marked, source line kept, status unchanged, warnings back', async () => {
  await runAll()
  const { posts } = await server.listPosts()
  const post = posts[0]!
  await server.decidePost(post.key, 'approved')

  const outcome = await server.editPost(post.key, 'My own words about the round.\n\nSource: https://wrong.example/x')
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) return
  expect(outcome.post.text).toBe(`My own words about the round.\n\nSource: ${post.url}`)
  expect(outcome.post).toMatchObject({ status: 'approved', handEdited: { by: 'ann@example.org' } })
  expect(outcome.post.versions.at(-1)).toMatchObject({ text: post.text, by: 'ann@example.org', replacedBy: 'hand-edit' })
  expect(outcome.warnings).toEqual([])
  // Still in News feed with the new text.
  expect((await server.listFeed()).find(p => p.key === post.key)!.text).toStartWith('My own words')

  const flagged = await server.editPost(post.key, 'Next to watch: the next round!')
  expect(flagged).toMatchObject({ ok: true, warnings: ['colon reveal', 'exclamation mark'] })

  // An AI rewrite clears the hand-edit mark and records itself as a rewrite.
  const rewritten = await server.rewritePost(post.key, 'tighter')
  if (!rewritten.ok) throw new Error(rewritten.error)
  expect(rewritten.post.handEdited).toBeUndefined()
  expect(rewritten.post.versions.at(-1)).toMatchObject({ replacedBy: 'rewrite', note: 'tighter' })

  expect(await server.editPost(post.key, '   ')).toMatchObject({ ok: false })
  expect(await server.editPost(post.key, 'x'.repeat(3001))).toMatchObject({ ok: false })
  await server.decidePost(post.key, 'rejected')
  expect(await server.editPost(post.key, 'Words')).toMatchObject({ ok: false })
  expect(await server.editPost('nope', 'Words')).toMatchObject({ ok: false })
})

test('approve, reject, undo and rewrite; a rejected slot is refilled on the next run', async () => {
  await runAll()
  const { posts } = await server.listPosts()
  const [first, second] = posts
  const approved = await server.decidePost(first!.key, 'approved')
  expect(approved).toMatchObject({ status: 'approved', decidedBy: 'ann@example.org' })
  expect((await server.listFeed()).map(p => p.key)).toEqual([first!.key])

  const back = await server.decidePost(first!.key, 'draft')
  expect(back.status).toBe('draft')
  expect(back.decidedAt).toBeUndefined()
  await expect(server.decidePost(first!.key, 'published' as never)).rejects.toThrow('Unknown decision')

  const rewritten = await server.rewritePost(second!.key, 'Shorter')
  expect(rewritten.ok).toBe(true)
  if (rewritten.ok) {
    expect(rewritten.post.versions).toHaveLength(1)
    expect(rewritten.post.versions[0]).toMatchObject({ text: second!.text, note: 'Shorter', by: 'ann@example.org' })
  }
  expect(written.at(-1)).toContain('The reviewer asked for this change: Shorter')

  await server.decidePost(second!.key, 'rejected')
  const steps = await runAll()
  expect(steps.filter(s => s.step === 'write')).toHaveLength(1)
  expect((await server.listPosts()).posts).toHaveLength(3)
})

test('a weight change re-ranks the articles without an AI call', async () => {
  await runAll()
  const before = await server.listArticles()
  // European stories rate europe 9 / significance 6, the others europe 1 / significance 9.
  const top = (list: typeof before) => list.articles.find(a => !a.allegation)!
  expect(top(before).european).toBe(true)
  const { settings } = await server.getScoring()
  const edit = {
    maxAgeDays: settings.maxAgeDays,
    minScore: settings.minScore,
    criteria: settings.criteria.map(c => ({ id: c.id, description: c.description, weight: c.id === 'europe' ? 0 : c.id === 'significance' ? 100 : c.weight }))
  }
  const saved = await server.saveScoring(edit)
  expect(saved.updatedBy).toBe('ann@example.org')
  expect(saved.criteria.find(c => c.id === 'europe')!.byHand).toEqual({ description: false, weight: true })
  const after = await server.listArticles()
  expect(top(after).european).toBe(false)
  expect(after.criteria.find(c => c.id === 'europe')!.weight).toBe(0)
})

test('the minimum score filters articles and stops drafting', async () => {
  await runAll()
  const { settings } = await server.getScoring()
  await server.saveScoring({
    maxAgeDays: settings.maxAgeDays,
    minScore: 95,
    criteria: settings.criteria.map(({ id, description, weight }) => ({ id, description, weight }))
  })
  const list = await server.listArticles()
  expect(list.minScore).toBe(95)
  expect(list.articles.filter(a => !a.allegation).every(a => a.filteredOut)).toBe(true)
  // A fresh day's drafting finds nothing above 95.
  db.delete('newsletter-posts')
  const steps = await runAll()
  expect(steps.at(-1)!.message).toContain('scores 95+')
})

test('Suggest fills every value not edited by hand, and sends the reviewers decisions', async () => {
  await runAll()
  const { posts } = await server.listPosts()
  await server.decidePost(posts[0]!.key, 'approved')
  const { settings } = await server.getScoring()
  await server.saveScoring({
    maxAgeDays: settings.maxAgeDays,
    minScore: settings.minScore,
    criteria: settings.criteria.map(c => ({ id: c.id, description: c.id === 'topic' ? 'My own words.' : c.description, weight: c.id === 'novelty' ? 33 : c.weight }))
  })
  const outcome = await server.suggestScoring()
  expect(outcome.ok).toBe(true)
  if (!outcome.ok) return
  const byId = Object.fromEntries(outcome.settings.criteria.map(c => [c.id, c]))
  expect(byId.topic!.description).toBe('My own words.')
  expect(byId.topic!.weight).toBe(10)
  expect(byId.novelty!.weight).toBe(33)
  expect(byId.novelty!.description).toBe('AI description for novelty')
  expect(byId.europe).toMatchObject({ weight: 60, suggestionNote: 'Because europe.' })
  expect(outcome.settings.suggestedAt).toBeDefined()
  expect(suggestPrompts.at(-1)).toContain(`APPROVED: ${posts[0]!.title}`)
})

test('write from a link: read, research with only real sources, write a draft outside the daily slots', async () => {
  const added = await server.addLink('https://news.example.com/meridian?utm_source=x')
  expect(added).toMatchObject({ ok: true, title: 'Meridian raises €50m for insurance AI agents', site: 'Example News' })
  if (!added.ok) return
  const article = (await server.listArticles()).articles.find(a => a.key === added.key)!
  expect(article.sourceName).toBe('Example News')

  const researched = await server.researchLink(added.key)
  expect(researched.ok).toBe(true)
  if (!researched.ok) return
  const [confirmed, unsupported] = researched.research.claims
  // Only URLs the search returned survive; a claim left without a source becomes unverified.
  expect(confirmed!.sources).toEqual([{ title: 'Example Wire', url: 'https://www.wire.example.org/x' }])
  expect(unsupported).toMatchObject({ status: 'unverified', sources: [] })
  expect(researched.research.otherViews).toHaveLength(1)
  expect(researchPrompts.at(-1)).toContain('Lisbon startup Meridian has raised €50m')
  expect(researchPrompts.at(-1)).not.toContain('track()')

  const written_ = await server.writeLinkPost(added.key)
  expect(written_.ok).toBe(true)
  if (!written_.ok) return
  expect(written_.post).toMatchObject({ origin: 'link', status: 'draft', slot: 0, sourceName: 'Example News' })
  // A link post reaches News feed only through Approve.
  expect((await server.listFeed()).some(p => p.key === written_.post.key)).toBe(false)
  await server.decidePost(written_.post.key, 'approved')
  expect((await server.listFeed()).some(p => p.key === written_.post.key)).toBe(true)
  await server.decidePost(written_.post.key, 'draft')
  expect(written_.post.text).toEndWith('Source: https://news.example.com/meridian?utm_source=x')
  expect(written.at(-1)).toContain('<research>')
  expect(written.at(-1)).toContain('CONFIRMED: Raised €50m')

  // The same link again is refused, pointing at the post.
  expect(await server.addLink('https://news.example.com/meridian?utm_source=x')).toMatchObject({ ok: false, postKey: written_.post.key })

  // A rewrite keeps using the research.
  await server.rewritePost(written_.post.key, 'shorter')
  expect(written.at(-1)).toContain('<research>')

  // The link post doesn't take one of the day's two automatic slots.
  const steps = await runAll()
  expect(steps.filter(s => s.step === 'write')).toHaveLength(2)
})

test('write from a link: refused links, paywalls, pasted text and allegations', async () => {
  for (const bad of ['notalink', 'ftp://news.example.com/x', 'http://localhost:3000/a', 'http://192.168.1.4/a', 'https://user:pw@news.example.com/a']) {
    expect((await server.addLink(bad)).ok).toBe(false)
  }
  // A redirect to a private address is caught too, and so is a public name resolving to loopback.
  expect(await server.addLink('https://moved.example.com/a')).toMatchObject({ ok: false })
  const rebind = await server.addLink('https://rebind.example.com/a')
  expect(rebind).toMatchObject({ ok: false })
  if (!rebind.ok) expect(rebind.error).toContain('private or local address')
  const paywalled = await server.addLink('https://paywall.example.com/story')
  expect(paywalled).toMatchObject({ ok: false })
  if (!paywalled.ok) expect(paywalled.error).toContain('Paste the article text')
  const pasted = await server.addLink('https://paywall.example.com/story', ARTICLE_PARAGRAPH.repeat(6))
  expect(pasted).toMatchObject({ ok: true, site: 'paywall.example.com' })

  researchAllegation = true
  const added = await server.addLink('https://news.example.com/scandal')
  if (!added.ok) throw new Error(added.error)
  await server.researchLink(added.key)
  expect(await server.writeLinkPost(added.key)).toMatchObject({ ok: false, error: expect.stringContaining('unproven allegations') })

  keySet = false
  expect(await server.researchLink(added.key)).toMatchObject({ ok: false, error: 'KEY MISSING' })
})

const BLOG_FILE = { name: 'meridian.md', text: 'Meridian, the Lisbon insurance AI startup, has raised €50m in a Series B led by Aurora Ventures. '.repeat(4) }
const NOTES_FILE = { name: 'notes.md', text: 'Founded in 2021 by two engineers.' }

test('a blog post is written from the files in the tone guide, kept apart from the posts, and shows in the feed once approved', async () => {
  const written_ = await server.writeBlogPost([BLOG_FILE, NOTES_FILE], 'The round')
  if (!written_.ok) throw new Error(written_.error)
  const { blog } = written_
  expect(blog).toMatchObject({ title: 'Meridian raises €50m', body: 'Meridian has raised €50m.\n\nAurora Ventures led the round.', status: 'draft', note: 'The round', writtenBy: 'ann@example.org' })
  expect(blog.sources).toEqual([{ name: 'meridian.md', chars: BLOG_FILE.text.trim().length }, { name: 'notes.md', chars: NOTES_FILE.text.length }])
  expect(blogCalls[0]!.system).toContain(`# ${CHANNEL.name}: tone guide`)
  expect(blogCalls[0]!.system).toContain('400–800 words')
  expect(blogCalls[0]!.input).toContain(`<file name="notes.md">\n${NOTES_FILE.text}\n</file>`)

  // Never in the Posts list, so it can't take one of the day's two LinkedIn slots.
  expect((await server.listPosts()).posts).toEqual([])
  expect((await server.listBlogs()).blogs.map(b => b.key)).toEqual([blog.key])
  expect(await server.listBlogFeed()).toEqual([])

  const approved = await server.decideBlog(blog.key, 'approved')
  expect(approved).toMatchObject({ status: 'approved', decidedBy: 'ann@example.org' })
  expect((await server.listBlogFeed()).map(b => b.key)).toEqual([blog.key])
  expect((await server.decideBlog(blog.key, 'draft')).decidedAt).toBeUndefined()
  expect(await server.listBlogFeed()).toEqual([])
})

test('a blog post can be edited by hand; the old text is kept and a rejected one is locked', async () => {
  const written_ = await server.writeBlogPost([BLOG_FILE])
  if (!written_.ok) throw new Error(written_.error)
  const key = written_.blog.key
  const edited = await server.editBlog(key, ' # My title ', 'My own words.\r\n\r\nSecond paragraph.')
  if (!edited.ok) throw new Error(edited.error)
  expect(edited.blog).toMatchObject({ title: 'My title', body: 'My own words.\n\nSecond paragraph.', handEdited: { by: 'ann@example.org' } })
  expect(edited.blog.versions).toEqual([expect.objectContaining({ title: 'Meridian raises €50m', by: 'ann@example.org' })])
  expect(await server.editBlog(key, 'x', ' ')).toMatchObject({ ok: false })

  await server.decideBlog(key, 'rejected')
  expect(await server.editBlog(key, 'Another', 'Text')).toMatchObject({ ok: false, error: expect.stringContaining('rejected') })
  await expect(server.decideBlog(key, 'published' as never)).rejects.toThrow('Unknown decision')
})

test('a blog post is not written without files, without the key, or when the AI fails', async () => {
  expect(await server.writeBlogPost([])).toMatchObject({ ok: false })
  keySet = false
  expect(await server.writeBlogPost([BLOG_FILE])).toEqual({ ok: false, error: 'KEY MISSING' })
  keySet = true
  blogFails = 'The AI took too long to answer.'
  expect(await server.writeBlogPost([BLOG_FILE])).toEqual({ ok: false, error: 'The AI took too long to answer.' })
  expect((await server.listBlogs()).blogs).toEqual([])
})

test('with no sources listed, Run now says how to add one, and no tab throws or divides by zero', async () => {
  const saved = SOURCES.splice(0)
  try {
    const { startedAt } = await server.startRun()
    expect(await server.runStep(startedAt)).toEqual({ done: true, step: 'idle', message: NO_SOURCES_MESSAGE, noSources: true })
    expect(NO_SOURCES_MESSAGE).toStartWith('Add a source: edit views/_sources.ts, or ask your coding agent to')
    expect((await server.listSources()).sources).toEqual([])
    expect(await server.listPosts()).toMatchObject({ posts: [], sourceCount: 0 })
    expect((await server.listArticles()).articles).toEqual([])
    expect(await server.listFeed()).toEqual([])
  } finally {
    SOURCES.push(...saved)
  }
})

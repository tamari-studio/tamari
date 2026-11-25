// The Newsletter space's server calls, shared by all its tabs.
//
// The pipeline runs as small steps, each well under the hosted 60 s cap: the "Run now" button
// calls runStep() again and again until it says it is done. A step does one of: fetch up to
// three feeds, rate up to 20 articles (Haiku), or write one post (Sonnet). A dead feed or a
// failed AI call never stops the run's other work: a feed failure is recorded on the source,
// and a failed AI call ends the run with the reason shown.
//
// Data lives in five shared collections (miso.records): newsletter-sources (per-source fetch
// status), newsletter-articles (keyed <published day>-<url hash>, ratings inside, deleted after
// 30 days), newsletter-posts (keyed <channel day>-<slot>), newsletter-settings (the
// Scoring tab's criteria, weights and filters, one record) and newsletter-blogs (the Blog tab's
// posts, keyed <channel day>-<time>; kept apart so they never take one of the day's two
// LinkedIn slots). No tables.
//
// The channel day is the day in the time zone set in _channel.ts (UTC by default).
//
// Only async functions are exported (the RPC layer requires it); types are erased.
import { collection, type StoredRecord } from '@miso/store'
import { callerEmail } from '@miso/caller'

import { BLOG_RULES, blogPrompt, blogSchema, checkBlogFiles, cleanTitle, MAX_BLOG_BODY_CHARS, readBlog, type BlogRecord, type BlogSourceFile } from './_blog'
import { articleKey, canonicalUrl, clip, fetchFeed, FeedError, MAX_ITEMS_PER_FEED, normalTitle, parseFeed, shortHash } from './_feed'
import { hasKey, KEY_MISSING, KeyMissingError, LlmError, rateArticles, researchWithSearch, suggestCriteria, writeBlog, writePost, WRITE_MODEL } from './_llm'
import { checkLink, fetchPage, MAX_PAGE_TEXT_CHARS, MIN_PAGE_TEXT_CHARS, PageError, readArticle, type PageArticle } from './_page'
import { LINK_WRITING_RULES, readResearch, RESEARCH_SYSTEM, researchNotes, researchPrompt, type Research } from './_research'
import {
  channelDay,
  europeanArticle,
  isRecent,
  KEEP_DAYS,
  MAX_SCORE_ATTEMPTS,
  newArticles,
  pickStory,
  postKey,
  recentDays,
  scoreOf,
  SCORE_BATCH,
  toScore,
  type ArticleRecord,
  type PostRecord,
  type PostStatus,
  type SourceStatus
} from './_pipeline'
import {
  applyEdit,
  applySuggestion,
  normalizeSettings,
  readRatings,
  readSuggestion,
  SCORING_SYSTEM,
  scoringPrompt,
  scoringSchema,
  SUGGEST_SYSTEM,
  suggestPrompt,
  suggestSchema,
  type Ratings,
  type ReviewedPost,
  type ScoringEdit,
  type ScoringSettings,
  type StoryRegion
} from './_scoring'
import { NO_SOURCES_MESSAGE, SOURCES, sourceById, type Source } from './_sources'
import { canDraft, draftPrompt, rewritePrompt, sourceText, styleWarnings, TONE_GUIDE, withSourceLink, WRITING_RULES, type DraftSource } from './_tone'

const sourceStatus = () => collection<SourceStatus>('newsletter-sources')
const articleStore = () => collection<ArticleRecord>('newsletter-articles')
const postStore = () => collection<PostRecord>('newsletter-posts')
const settingsStore = () => collection<ScoringSettings>('newsletter-settings')
const blogStore = () => collection<BlogRecord>('newsletter-blogs')
const SETTINGS_KEY = 'scoring'

/** Feeds fetched in parallel by one step. */
const FETCH_PARALLEL = 3
/** Days of articles the Articles tab shows. */
const SHOW_DAYS = 7

const WRITING_SYSTEM = `${TONE_GUIDE}\n\n${WRITING_RULES}`
const LINK_WRITING_SYSTEM = `${TONE_GUIDE}\n\n${WRITING_RULES}\n\n${LINK_WRITING_RULES}`

async function loadSettings(): Promise<ScoringSettings> {
  return normalizeSettings((await settingsStore().get(SETTINGS_KEY))?.data)
}

// ---------------------------------------------------------------------------------------------
// Run steps

export type StepResult = {
  /** True when nothing is left to do in this run. */
  done: boolean
  step: 'fetch' | 'score' | 'write' | 'idle'
  /** What the step did, in one line. */
  message: string
  /** Set when the run stopped early for a reason a person should see (no key, an AI error). */
  warning?: string
  /** Set when there is nothing to run because no sources are listed in _sources.ts. */
  noSources?: boolean
}

/** Starts a run: the server's clock, so a feed counts as fetched in this run whatever the browser's clock says. */
export async function startRun(): Promise<{ startedAt: string; hasKey: boolean }> {
  return { startedAt: new Date().toISOString(), hasKey: hasKey() }
}

/** Does the next pending step of the run that started at `startedAt` (from startRun). */
export async function runStep(startedAt: string): Promise<StepResult> {
  if (SOURCES.length === 0) return { done: true, step: 'idle', message: NO_SOURCES_MESSAGE, noSources: true }
  const [statuses, settings] = await Promise.all([sourceStatusMap(), loadSettings()])
  const due = SOURCES.filter(source => !((statuses.get(source.id)?.lastRunAt ?? '') >= startedAt))
  if (due.length > 0) {
    if (due.length === SOURCES.length) await deleteOldArticles()
    return fetchSources(due.slice(0, FETCH_PARALLEL), due.length, settings)
  }
  if (!hasKey()) return { done: true, step: 'idle', message: 'Feeds fetched. Rating and writing need the AI key.', warning: KEY_MISSING }

  const recent = await recentArticles(settings.maxAgeDays + 1)
  const batch = toScore(recent, new Date(), SCORE_BATCH, settings.maxAgeDays)
  if (batch.length > 0) return scoreBatch(batch, settings)

  return writeNextPost(recent, settings)
}

async function fetchSources(batch: Source[], dueCount: number, settings: ScoringSettings): Promise<StepResult> {
  const known = (await recentArticles(settings.maxAgeDays + 1)).map(a => a.data)
  const lines = await Promise.all(
    batch.map(async source => {
      const now = new Date()
      try {
        const items = parseFeed(await fetchFeed(source.url))
        // Synchronous from here to putMany's call, so parallel feeds see each other's articles.
        const fresh = newArticles(source.id, items, known, { now, limit: MAX_ITEMS_PER_FEED, maxAgeDays: settings.maxAgeDays })
        known.push(...fresh.map(f => f.data))
        const recentCount = items.filter(i => isRecent(i.published, now, settings.maxAgeDays)).length
        await articleStore().putMany(fresh)
        await sourceStatus().put(source.id, { lastRunAt: now.toISOString(), ok: true, items: recentCount, added: fresh.length })
        return `${source.name}: ${fresh.length} new`
      } catch (err) {
        const reason = err instanceof FeedError ? err.message : 'could not be read'
        if (!(err instanceof FeedError)) console.error(`Newsletter: fetching ${source.id} failed`, err)
        await sourceStatus().put(source.id, { lastRunAt: now.toISOString(), ok: false, error: reason, items: 0, added: 0 })
        return `${source.name}: ${reason}`
      }
    })
  )
  const left = dueCount - batch.length
  return { done: false, step: 'fetch', message: `Fetched ${lines.join(', ')}${left > 0 ? ` (${left} feeds to go)` : ''}` }
}

async function scoreBatch(batch: { key: string; data: ArticleRecord }[], settings: ScoringSettings): Promise<StepResult> {
  const input = batch.map(a => ({
    id: a.key,
    source: sourceById(a.data.sourceId)?.name ?? a.data.sourceId,
    title: a.data.title,
    text: clip(a.data.summary || a.data.content, 600)
  }))
  const now = new Date().toISOString()
  let ratings: ReturnType<typeof readRatings>
  try {
    const json = await rateArticles({
      system: SCORING_SYSTEM,
      prompt: scoringPrompt(input, settings.criteria),
      schema: scoringSchema(settings.criteria)
    })
    ratings = readRatings(json, input.map(i => i.id))
  } catch (err) {
    const message = err instanceof LlmError ? err.message : 'The rating step failed.'
    if (!(err instanceof LlmError)) console.error('Newsletter: rating failed', err)
    if (!(err instanceof KeyMissingError)) {
      await articleStore().putMany(batch.map(a => ({ key: a.key, data: failedRating(a.data, message) })))
    }
    return { done: true, step: 'score', message: 'Rating stopped.', warning: message }
  }
  await articleStore().putMany(
    batch.map(a => {
      const rating = ratings.get(a.key)
      if (!rating) return { key: a.key, data: failedRating(a.data, 'The AI skipped this article.') }
      const { id: _id, region, reason, allegation, ...scores } = rating
      return {
        key: a.key,
        data: { ...a.data, ratings: scores as Ratings, region, reason, allegation, scoredAt: now, scoreError: undefined }
      }
    })
  )
  return { done: false, step: 'score', message: `Rated ${ratings.size} of ${batch.length} articles` }
}

function failedRating(article: ArticleRecord, message: string): ArticleRecord {
  return { ...article, scoreAttempts: (article.scoreAttempts ?? 0) + 1, scoreError: message }
}

async function writeNextPost(recent: StoredRecord<ArticleRecord>[], settings: ScoringSettings): Promise<StepResult> {
  const day = channelDay()
  const posts = await postStore().list({ order: 'key-desc', limit: 300 })
  // Posts written from a pasted link don't take one of the day's two slots.
  const todays = posts.filter(p => p.data.day === day && p.data.origin !== 'link').map(p => p.data)
  const used = new Set(posts.map(p => p.data.articleKey))
  const pick = pickStory(recent, todays, used, {
    criteria: settings.criteria,
    minScore: settings.minScore,
    maxAgeDays: settings.maxAgeDays
  })
  if (pick.kind === 'enough') return { done: true, step: 'idle', message: "Today's two posts are drafted." }
  if (pick.kind === 'limit') return { done: true, step: 'idle', message: 'Today has reached its limit of drafts.' }
  if (pick.kind === 'none') return { done: true, step: 'idle', message: pick.reason }

  const source = draftSource(pick.article)
  let text: string
  try {
    text = await writePost({ system: WRITING_SYSTEM, input: draftPrompt(source) })
  } catch (err) {
    const message = err instanceof LlmError ? err.message : 'Writing the post failed.'
    if (!(err instanceof LlmError)) console.error('Newsletter: writing failed', err)
    return { done: true, step: 'write', message: 'Writing stopped.', warning: message }
  }
  const at = new Date().toISOString()
  const post: PostRecord = {
    day,
    slot: pick.slot,
    articleKey: pick.key,
    sourceId: pick.article.sourceId,
    sourceName: source.sourceName,
    title: pick.article.title,
    url: pick.article.url,
    published: pick.article.published,
    excerpt: clip(sourceText(pick.article), 1_500),
    text: withSourceLink(text, pick.article.url),
    status: 'draft',
    european: pick.european,
    score: pick.score,
    writtenAt: at,
    model: WRITE_MODEL,
    versions: []
  }
  await postStore().put(postKey(day, pick.slot), post)
  return { done: false, step: 'write', message: `Drafted a post: ${pick.article.title}` }
}

function draftSource(article: ArticleRecord): DraftSource {
  return {
    sourceName: sourceById(article.sourceId)?.name ?? article.siteName ?? article.sourceId,
    title: article.title,
    url: article.url,
    published: article.published,
    summary: article.summary,
    content: article.content
  }
}

// ---------------------------------------------------------------------------------------------
// Store helpers

async function sourceStatusMap(): Promise<Map<string, SourceStatus>> {
  const rows = await sourceStatus().list({ limit: 200 })
  return new Map(rows.map(r => [r.key, r.data]))
}

/** Articles published on the last `days` UTC days, read by key prefix (one call per day). */
async function recentArticles(days: number): Promise<StoredRecord<ArticleRecord>[]> {
  const lists = await Promise.all(recentDays(days).map(day => articleStore().list({ prefix: day, order: 'key-desc', limit: 1000 })))
  return lists.flat()
}

async function deleteOldArticles(): Promise<void> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
  const oldest = await articleStore().list({ order: 'key', limit: 200 })
  const old = oldest.filter(r => r.key.slice(0, 10) < cutoff)
  for (const row of old) await articleStore().remove(row.key)
}

// ---------------------------------------------------------------------------------------------
// Tabs

export type SourceRow = Source & { status: SourceStatus | null }

export async function listSources(): Promise<{ sources: SourceRow[]; hasKey: boolean }> {
  const statuses = await sourceStatusMap()
  return { sources: SOURCES.map(source => ({ ...source, status: statuses.get(source.id) ?? null })), hasKey: hasKey() }
}

export type ArticleRow = {
  key: string
  sourceId: string
  sourceName: string
  title: string
  url: string
  published: string
  /** The first part of the article's text, for the list. */
  snippet: string
  score: number | null
  ratings: Ratings | null
  region: StoryRegion | null
  european: boolean
  reason: string | null
  scoreError: string | null
  /** Rating failed too often; left unrated. */
  gaveUp: boolean
  draftable: boolean
  /** Rests on unproven allegations about a named person: never drafted. */
  allegation: boolean
  /** The key of the post written from it, if any. */
  postKey: string | null
  /** Outside the Scoring tab's hard filters: older than the maximum age, or scored below the minimum. */
  filteredOut: boolean
}

export type ArticleList = {
  articles: ArticleRow[]
  criteria: { id: string; name: string; weight: number }[]
  maxAgeDays: number
  minScore: number
}

export async function listArticles(): Promise<ArticleList> {
  const [articles, posts, settings] = await Promise.all([
    recentArticles(SHOW_DAYS),
    postStore().list({ order: 'key-desc', limit: 300 }),
    loadSettings()
  ])
  const now = new Date()
  const postByArticle = new Map(posts.map(p => [p.data.articleKey, p.key]))
  const rows = articles.map(({ key, data }): ArticleRow => {
    const score = scoreOf(data, settings.criteria)
    return {
      key,
      sourceId: data.sourceId,
      sourceName: sourceById(data.sourceId)?.name ?? data.siteName ?? data.sourceId,
      title: data.title,
      url: data.url,
      published: data.published,
      snippet: clip(data.summary || data.content, 280),
      score,
      ratings: data.ratings ?? null,
      region: data.region ?? null,
      european: europeanArticle(data),
      reason: data.reason ?? null,
      scoreError: data.scoreError ?? null,
      gaveUp: !data.ratings && (data.scoreAttempts ?? 0) >= MAX_SCORE_ATTEMPTS,
      draftable: canDraft(data),
      allegation: data.allegation === true,
      postKey: postByArticle.get(key) ?? null,
      filteredOut: !isRecent(data.published, now, settings.maxAgeDays) || (score !== null && score < settings.minScore)
    }
  })
  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.published.localeCompare(a.published))
  return {
    articles: rows,
    criteria: settings.criteria.map(({ id, name, weight }) => ({ id, name, weight })),
    maxAgeDays: settings.maxAgeDays,
    minScore: settings.minScore
  }
}

export type PostRow = PostRecord & { key: string }

export async function listPosts(): Promise<{ posts: PostRow[]; today: string; hasKey: boolean; sourceCount: number }> {
  const posts = await postStore().list({ order: 'key-desc', limit: 60 })
  return { posts: posts.map(p => ({ ...p.data, key: p.key })), today: channelDay(), hasKey: hasKey(), sourceCount: SOURCES.length }
}

/** Approved posts, newest first: the News feed tab. */
export async function listFeed(): Promise<PostRow[]> {
  const posts = await postStore().list({ order: 'key-desc', limit: 300 })
  return posts
    .filter(p => p.data.status === 'approved')
    .map(p => ({ ...p.data, key: p.key }))
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
}

const DECISIONS: readonly PostStatus[] = ['approved', 'rejected', 'draft']

/** Approve, reject, or put back to draft. Returns the updated post. */
export async function decidePost(key: string, status: PostStatus): Promise<PostRow> {
  if (!DECISIONS.includes(status)) throw new Error('Unknown decision')
  const store = postStore()
  const existing = await store.get(key)
  if (!existing) throw new Error('This post no longer exists. Reload the tab.')
  const post: PostRecord = {
    ...existing.data,
    status,
    decidedAt: status === 'draft' ? undefined : new Date().toISOString(),
    decidedBy: status === 'draft' ? undefined : callerEmail()
  }
  await store.put(key, post)
  return { ...post, key }
}

export type RewriteOutcome = { ok: true; post: PostRow } | { ok: false; error: string }

/** Writes the post again, following the reviewer's note. The old text is kept in versions. */
export async function rewritePost(key: string, note: string): Promise<RewriteOutcome> {
  const store = postStore()
  const existing = await store.get(key)
  if (!existing) return { ok: false, error: 'This post no longer exists. Reload the tab.' }
  const post = existing.data
  const article = (await articleStore().get(post.articleKey))?.data
  // An article older than 30 days is gone from the store; the post's excerpt is what it was written from.
  const source: DraftSource = article
    ? draftSource(article)
    : { sourceName: post.sourceName, title: post.title, url: post.url, published: post.published, summary: post.excerpt, content: '' }
  const current = post.text.replace(/\n*Source: \S+\s*$/, '').trim()
  // A post written from a link keeps using its research when rewritten.
  const research = post.research ?? article?.research
  const system = research ? LINK_WRITING_SYSTEM : WRITING_SYSTEM
  const input = rewritePrompt(source, current, note.slice(0, 1_000)) + (research ? `\n\n${researchNotes(research)}` : '')
  let text: string
  try {
    text = await writePost({ system, input })
  } catch (err) {
    if (!(err instanceof LlmError)) console.error('Newsletter: rewrite failed', err)
    return { ok: false, error: err instanceof LlmError ? err.message : 'The rewrite failed. Try again.' }
  }
  const at = new Date().toISOString()
  const updated: PostRecord = {
    ...post,
    text: withSourceLink(text, post.url),
    status: 'draft',
    decidedAt: undefined,
    decidedBy: undefined,
    writtenAt: at,
    handEdited: undefined,
    versions: [...post.versions, { text: post.text, at: post.writtenAt, note: note.trim() || undefined, by: callerEmail(), replacedBy: 'rewrite' }]
  }
  await store.put(key, updated)
  return { ok: true, post: { ...updated, key } }
}

/** Longest text a hand edit may save. */
const MAX_EDIT_CHARS = 3_000

export type EditOutcome = { ok: true; post: PostRow; warnings: string[] } | { ok: false; error: string }

/**
 * A person replaces a post's text with their own: on a draft or an approved post. The source
 * line is kept, the old text becomes an earlier version marked as replaced by a hand edit, and
 * the status stays as it is (a person wrote it). Style warnings come back for the editor to see.
 */
export async function editPost(key: string, text: string): Promise<EditOutcome> {
  const store = postStore()
  const existing = await store.get(key)
  if (!existing) return { ok: false, error: 'This post no longer exists. Reload the tab.' }
  const post = existing.data
  if (post.status === 'rejected') return { ok: false, error: 'A rejected post can’t be edited. Put it back to review first.' }
  const body = text.replace(/\n*Source: \S+\s*$/, '').trim()
  if (!body) return { ok: false, error: 'The post is empty. Write the text, or cancel.' }
  if (body.length > MAX_EDIT_CHARS) return { ok: false, error: `The post is longer than ${MAX_EDIT_CHARS.toLocaleString('en-GB')} characters. Shorten it.` }
  const next = withSourceLink(body, post.url)
  if (next === post.text) return { ok: true, post: { ...post, key }, warnings: styleWarnings(next) }
  const by = callerEmail()
  const at = new Date().toISOString()
  const updated: PostRecord = {
    ...post,
    text: next,
    writtenAt: at,
    handEdited: { by, at },
    versions: [...post.versions, { text: post.text, at: post.writtenAt, by, replacedBy: 'hand-edit' }]
  }
  await store.put(key, updated)
  return { ok: true, post: { ...updated, key }, warnings: styleWarnings(next) }
}

// ---------------------------------------------------------------------------------------------
// Scoring tab

export async function getScoring(): Promise<{ settings: ScoringSettings; hasKey: boolean }> {
  return { settings: await loadSettings(), hasKey: hasKey() }
}

/** Saves a person's edit. Values that changed are marked "edited by hand". */
export async function saveScoring(edit: ScoringEdit): Promise<ScoringSettings> {
  const next = { ...applyEdit(await loadSettings(), edit), updatedAt: new Date().toISOString(), updatedBy: callerEmail() }
  await settingsStore().put(SETTINGS_KEY, next)
  return next
}

export type SuggestOutcome = { ok: true; settings: ScoringSettings; changed: number } | { ok: false; error: string }

/**
 * Asks the AI for criteria descriptions and weights, from the channel's goal and the posts people
 * approved or rejected, and saves them. Values edited by hand are kept.
 */
export async function suggestScoring(): Promise<SuggestOutcome> {
  const [current, posts] = await Promise.all([loadSettings(), postStore().list({ order: 'key-desc', limit: 60 })])
  const decided = posts.filter(p => p.data.status !== 'draft').slice(0, 30)
  const ratings = await Promise.all(decided.map(p => articleStore().get(p.data.articleKey)))
  const reviewed: ReviewedPost[] = decided.map((p, i) => ({
    title: p.data.title,
    status: p.data.status as 'approved' | 'rejected',
    ratings: ratings[i]?.data.ratings ?? null
  }))
  let suggestions
  try {
    suggestions = readSuggestion(await suggestCriteria({ system: SUGGEST_SYSTEM, prompt: suggestPrompt(current, reviewed), schema: suggestSchema() }))
  } catch (err) {
    if (!(err instanceof LlmError)) console.error('Newsletter: suggesting failed', err)
    return { ok: false, error: err instanceof LlmError ? err.message : 'The suggestion failed. Try again.' }
  }
  if (suggestions.length === 0) return { ok: false, error: 'The AI sent back no usable suggestion. Try again.' }
  const next = applySuggestion(current, suggestions, new Date().toISOString())
  const changed = next.criteria.filter((c, i) => c.weight !== current.criteria[i]!.weight || c.description !== current.criteria[i]!.description).length
  await settingsStore().put(SETTINGS_KEY, next)
  return { ok: true, settings: next, changed }
}

// ---------------------------------------------------------------------------------------------
// Write from a link: anyone pastes a link (and, for a paywalled page, the article text). Three
// steps, each its own call under the hosted 60 s cap: read the article, research it on the web,
// write the post. A link post doesn't take one of the day's two automatic slots.

export type LinkStep<T> = ({ ok: true } & T) | { ok: false; error: string; postKey?: string }

/** Step 1: reads the article behind the link and stores it. Pasted text is used when given. */
export async function addLink(link: string, pastedText = ''): Promise<LinkStep<{ key: string; title: string; site: string; chars: number }>> {
  let url: URL
  try {
    url = checkLink(link)
  } catch (err) {
    return { ok: false, error: err instanceof PageError ? err.message : 'That link cannot be read.' }
  }
  const pasted = pastedText.trim().slice(0, MAX_PAGE_TEXT_CHARS)
  let page: PageArticle | null = null
  try {
    const fetched = await fetchPage(url.toString())
    page = await readArticle(fetched.html, fetched.url)
  } catch (err) {
    if (!(err instanceof PageError)) console.error('Newsletter: reading a link failed', err)
    if (!pasted) {
      return { ok: false, error: `${err instanceof PageError ? err.message : 'The page could not be read.'} You can paste the article text and try again.` }
    }
  }
  const text = pasted || page?.text || ''
  if (text.length < MIN_PAGE_TEXT_CHARS) {
    return { ok: false, error: 'Not enough article text could be read from that page (it may be behind a paywall). Paste the article text and try again.' }
  }
  const title = page?.title || clip(text.split('\n', 1)[0] ?? '', 200)
  const site = page?.site || url.hostname.replace(/^www\./, '')
  const published = page?.published ?? new Date().toISOString()
  const key = articleKey(published, url.toString())

  const existing = await articleStore().get(key)
  if (existing) {
    const post = (await postStore().list({ order: 'key-desc', limit: 300 })).find(p => p.data.articleKey === key)
    if (post) return { ok: false, error: 'This article already has a post. It is in the list below.', postKey: post.key }
  }
  const article: ArticleRecord = {
    sourceId: 'link',
    title,
    url: url.toString(),
    canonical: canonicalUrl(url.toString()),
    normTitle: normalTitle(title),
    summary: clip(page?.description || text, 600),
    content: text,
    published,
    fetchedAt: new Date().toISOString(),
    origin: 'link',
    siteName: site,
    addedBy: callerEmail()
  }
  await articleStore().put(key, article)
  return { ok: true, key, title, site, chars: text.length }
}

/** Step 2: searches the web for sources that confirm or dispute the article's claims, and other views. */
export async function researchLink(key: string): Promise<LinkStep<{ research: Research }>> {
  const stored = await articleStore().get(key)
  if (!stored) return { ok: false, error: 'The article is no longer stored. Add the link again.' }
  if (!hasKey()) return { ok: false, error: KEY_MISSING }
  const article = stored.data
  let research: Research | null
  try {
    const answer = await researchWithSearch({
      system: RESEARCH_SYSTEM,
      prompt: researchPrompt({ title: article.title, site: article.siteName ?? '', url: article.url, published: article.published, text: article.content })
    })
    research = readResearch(answer.text, answer.searchedUrls, article.url, new Date().toISOString())
  } catch (err) {
    if (!(err instanceof LlmError)) console.error('Newsletter: link research failed', err)
    return { ok: false, error: err instanceof LlmError ? err.message : 'The research failed. Try again.' }
  }
  if (!research) return { ok: false, error: 'The research answer could not be read. Try again.' }
  await articleStore().put(key, { ...article, research, allegation: research.allegation })
  return { ok: true, research }
}

/** Step 3: writes the post from the article and its research, as a draft for review. */
export async function writeLinkPost(key: string): Promise<LinkStep<{ post: PostRow }>> {
  const stored = await articleStore().get(key)
  if (!stored) return { ok: false, error: 'The article is no longer stored. Add the link again.' }
  const article = stored.data
  const research = article.research
  if (!research) return { ok: false, error: 'Research the article first.' }
  if (research.allegation) {
    return { ok: false, error: 'This story rests on unproven allegations about a named person, so it is not written up.' }
  }
  const source = draftSource(article)
  let text: string
  try {
    text = await writePost({ system: LINK_WRITING_SYSTEM, input: `${draftPrompt(source)}\n\n${researchNotes(research)}` })
  } catch (err) {
    if (!(err instanceof LlmError)) console.error('Newsletter: writing a link post failed', err)
    return { ok: false, error: err instanceof LlmError ? err.message : 'Writing the post failed. Try again.' }
  }
  const day = channelDay()
  const at = new Date().toISOString()
  const post: PostRecord = {
    day,
    slot: 0,
    articleKey: key,
    sourceId: article.sourceId,
    sourceName: source.sourceName,
    title: article.title,
    url: article.url,
    published: article.published,
    excerpt: clip(sourceText(article), 1_500),
    text: withSourceLink(text, article.url),
    status: 'draft',
    european: false,
    score: 0,
    writtenAt: at,
    model: WRITE_MODEL,
    versions: [],
    origin: 'link',
    addedBy: article.addedBy ?? callerEmail(),
    research
  }
  const postKeyForLink = `${day}-link-${shortHash(article.canonical)}`
  await postStore().put(postKeyForLink, post)
  return { ok: true, post: { ...post, key: postKeyForLink } }
}

// ---------------------------------------------------------------------------------------------
// Blog tab: a person uploads one or more .md files and the AI writes one 400–800 word blog post
// from them in the channel's tone. A draft until someone approves it; approved blog posts show
// in the News feed as cards. The files' text is used for the one call and not kept.

const BLOG_SYSTEM = `${TONE_GUIDE}\n\n${BLOG_RULES}`

export type BlogRow = BlogRecord & { key: string }

export type BlogOutcome = { ok: true; blog: BlogRow } | { ok: false; error: string }

/** Writes a blog post from the files' text, as a draft for review. */
export async function writeBlogPost(files: BlogSourceFile[], note = ''): Promise<BlogOutcome> {
  const checked = checkBlogFiles(files)
  if (!checked.ok) return checked
  if (!hasKey()) return { ok: false, error: KEY_MISSING }
  let blog: { title: string; body: string } | null
  try {
    blog = readBlog(await writeBlog({ system: BLOG_SYSTEM, input: blogPrompt(checked.files, note), schema: blogSchema() }))
  } catch (err) {
    if (!(err instanceof LlmError)) console.error('Newsletter: writing a blog post failed', err)
    return { ok: false, error: err instanceof LlmError ? err.message : 'Writing the blog post failed. Try again.' }
  }
  if (!blog) return { ok: false, error: 'The AI answer could not be read. Try again.' }
  const now = new Date()
  const record: BlogRecord = {
    day: channelDay(now),
    title: blog.title,
    body: blog.body,
    status: 'draft',
    sources: checked.files.map(f => ({ name: f.name, chars: f.text.length })),
    note: String(note ?? '').trim().slice(0, 1_000) || undefined,
    writtenAt: now.toISOString(),
    writtenBy: callerEmail(),
    model: WRITE_MODEL,
    versions: []
  }
  const key = `${record.day}-${now.getTime().toString(36)}`
  await blogStore().put(key, record)
  return { ok: true, blog: { ...record, key } }
}

export async function listBlogs(): Promise<{ blogs: BlogRow[]; today: string; hasKey: boolean }> {
  const blogs = await blogStore().list({ order: 'key-desc', limit: 100 })
  return { blogs: blogs.map(b => ({ ...b.data, key: b.key })), today: channelDay(), hasKey: hasKey() }
}

/** Approved blog posts, newest first: the News feed shows them as cards. */
export async function listBlogFeed(): Promise<BlogRow[]> {
  const blogs = await blogStore().list({ order: 'key-desc', limit: 300 })
  return blogs
    .filter(b => b.data.status === 'approved')
    .map(b => ({ ...b.data, key: b.key }))
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''))
}

/** Approve, reject, or put back to draft. */
export async function decideBlog(key: string, status: PostStatus): Promise<BlogRow> {
  if (!DECISIONS.includes(status)) throw new Error('Unknown decision')
  const store = blogStore()
  const existing = await store.get(key)
  if (!existing) throw new Error('This blog post no longer exists. Reload the tab.')
  const blog: BlogRecord = {
    ...existing.data,
    status,
    decidedAt: status === 'draft' ? undefined : new Date().toISOString(),
    decidedBy: status === 'draft' ? undefined : callerEmail()
  }
  await store.put(key, blog)
  return { ...blog, key }
}

/** A person replaces the title and text with their own. The old text is kept as an earlier version. */
export async function editBlog(key: string, title: string, body: string): Promise<BlogOutcome> {
  const store = blogStore()
  const existing = await store.get(key)
  if (!existing) return { ok: false, error: 'This blog post no longer exists. Reload the tab.' }
  const blog = existing.data
  if (blog.status === 'rejected') return { ok: false, error: 'A rejected blog post can’t be edited. Put it back to review first.' }
  const nextTitle = cleanTitle(String(title ?? ''))
  const nextBody = String(body ?? '').replace(/\r\n?/g, '\n').trim()
  if (!nextTitle || !nextBody) return { ok: false, error: 'The title and the text both need words. Write them, or cancel.' }
  if (nextBody.length > MAX_BLOG_BODY_CHARS) {
    return { ok: false, error: `The text is longer than ${MAX_BLOG_BODY_CHARS.toLocaleString('en-GB')} characters. Shorten it.` }
  }
  if (nextTitle === blog.title && nextBody === blog.body) return { ok: true, blog: { ...blog, key } }
  const by = callerEmail()
  const at = new Date().toISOString()
  const updated: BlogRecord = {
    ...blog,
    title: nextTitle,
    body: nextBody,
    writtenAt: at,
    handEdited: { by, at },
    versions: [...blog.versions, { title: blog.title, body: blog.body, at: blog.writtenAt, by }]
  }
  await store.put(key, updated)
  return { ok: true, blog: { ...updated, key } }
}

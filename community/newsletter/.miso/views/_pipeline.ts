// The Newsletter pipeline's records and its pure decisions: which feed items are new, which
// articles to rate next, and which story each of the day's two posts is written from. The
// store reads and writes and the AI calls are in news.server.ts. Tested in _pipeline.test.ts.
import { CHANNEL } from './_channel'
import { articleKey, canonicalUrl, normalTitle, type FeedItem } from './_feed'
import { DEFAULT_CRITERIA, isEuropean, weightedScore, type Criterion, type Ratings, type StoryRegion } from './_scoring'
import type { Research } from './_research'
import { canDraft } from './_tone'

/** Default maximum article age; the Scoring tab's setting overrides it. */
export const MAX_AGE_DAYS = 3
/** Articles are deleted from the store after this many days. */
export const KEEP_DAYS = 30
/** Articles per rating call. */
export const SCORE_BATCH = 20
/** An article whose rating failed this many times is left unrated. */
export const MAX_SCORE_ATTEMPTS = 2
/** Posts wanted each day. */
export const POSTS_PER_DAY = 2
/** Drafts a day can hold at most, rejected ones included, so rejecting can't loop forever. */
export const MAX_DRAFTS_PER_DAY = 8
/** Default minimum score for a draft; the Scoring tab's setting overrides it. */
export const MIN_DRAFT_SCORE = 40

export type ArticleRecord = {
  sourceId: string
  title: string
  url: string
  canonical: string
  normTitle: string
  summary: string
  content: string
  published: string
  fetchedAt: string
  ratings?: Ratings
  region?: StoryRegion
  reason?: string
  /** The AI found the story rests on unproven allegations about a named person: never drafted. */
  allegation?: boolean
  scoredAt?: string
  scoreAttempts?: number
  scoreError?: string
  /** 'link' when someone added it by pasting a link; feed articles have none. */
  origin?: 'link'
  /** The site's own name, for articles added by link. */
  siteName?: string
  addedBy?: string | null
  /** Web research on an article added by link. */
  research?: Research
}

export type PostStatus = 'draft' | 'approved' | 'rejected'

/**
 * An earlier text of a post. `replacedBy` says how the next text was made: an AI rewrite
 * (`note` is the reviewer's request) or a person's hand edit (`by` is who edited).
 */
export type PostVersion = { text: string; at: string; note?: string; by?: string | null; replacedBy?: 'rewrite' | 'hand-edit' }

export type PostRecord = {
  /** The channel's day (see channelDay) the post is for. */
  day: string
  slot: number
  articleKey: string
  sourceId: string
  sourceName: string
  title: string
  url: string
  published: string
  /** The source text the post was written from, shown next to the draft. */
  excerpt: string
  text: string
  status: PostStatus
  european: boolean
  score: number
  writtenAt: string
  model: string
  versions: PostVersion[]
  decidedAt?: string
  decidedBy?: string | null
  /** 'link' for a post written from a pasted link; it doesn't take one of the day's two slots. */
  origin?: 'link'
  addedBy?: string | null
  /** The web research the post was written with, shown next to the draft. */
  research?: Research
  /** Set when a person last wrote the text by hand; cleared by an AI rewrite. */
  handEdited?: { by: string | null; at: string }
}

export type SourceStatus = {
  lastRunAt: string
  ok: boolean
  error?: string
  /** Items in the feed within the age limit. */
  items: number
  /** New articles stored by the last fetch. */
  added: number
}

/** The day in the channel's time zone (_channel.ts, UTC by default) as YYYY-MM-DD. */
export function channelDay(at: Date = new Date(), timeZone: string = CHANNEL.timeZone): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** The last `count` UTC days as YYYY-MM-DD, today first: the key prefixes of recent articles. */
export function recentDays(count: number, now: Date = new Date()): string[] {
  const days: string[] = []
  for (let i = 0; i < count; i++) days.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10))
  return days
}

export function isRecent(published: string, now: Date = new Date(), days = MAX_AGE_DAYS): boolean {
  const time = Date.parse(published)
  return !Number.isNaN(time) && time >= now.getTime() - days * 86_400_000 && time <= now.getTime() + 3_600_000
}

/**
 * The feed items to store: recent ones, at most `limit`, minus anything already stored or seen
 * earlier in the same batch (same canonical URL or same normalised title).
 */
export function newArticles(
  sourceId: string,
  items: readonly FeedItem[],
  existing: Iterable<Pick<ArticleRecord, 'canonical' | 'normTitle'>>,
  options: { now?: Date; limit: number; maxAgeDays?: number }
): { key: string; data: ArticleRecord }[] {
  const now = options.now ?? new Date()
  const maxAge = options.maxAgeDays ?? MAX_AGE_DAYS
  const urls = new Set<string>()
  const titles = new Set<string>()
  for (const article of existing) {
    urls.add(article.canonical)
    titles.add(article.normTitle)
  }
  const out: { key: string; data: ArticleRecord }[] = []
  const recent = items.filter(item => isRecent(item.published, now, maxAge)).slice(0, options.limit)
  for (const item of recent) {
    const canonical = canonicalUrl(item.url)
    const normTitle = normalTitle(item.title)
    if (urls.has(canonical) || (normTitle && titles.has(normTitle))) continue
    urls.add(canonical)
    titles.add(normTitle)
    out.push({
      key: articleKey(item.published, item.url),
      data: { sourceId, ...item, canonical, normTitle, fetchedAt: now.toISOString() }
    })
  }
  return out
}

/** Unrated recent articles to rate next, newest first. */
export function toScore(
  articles: readonly { key: string; data: ArticleRecord }[],
  now: Date = new Date(),
  batch = SCORE_BATCH,
  maxAgeDays = MAX_AGE_DAYS
): { key: string; data: ArticleRecord }[] {
  return articles
    .filter(a => !a.data.ratings && (a.data.scoreAttempts ?? 0) < MAX_SCORE_ATTEMPTS && isRecent(a.data.published, now, maxAgeDays))
    .sort((a, b) => b.data.published.localeCompare(a.data.published))
    .slice(0, batch)
}

export function scoreOf(article: ArticleRecord, criteria: readonly Criterion[] = DEFAULT_CRITERIA): number | null {
  return article.ratings ? weightedScore(article.ratings, criteria) : null
}

export function europeanArticle(article: ArticleRecord): boolean {
  return article.ratings ? isEuropean({ region: article.region ?? 'other', europe: article.ratings.europe }) : false
}

/** Posts that still count toward today's two: everything not rejected. */
export function livePosts(posts: readonly PostRecord[]): PostRecord[] {
  return posts.filter(p => p.status !== 'rejected')
}

export type StoryPick =
  | { kind: 'enough' }
  | { kind: 'limit' }
  | { kind: 'none'; reason: string }
  | { kind: 'pick'; key: string; article: ArticleRecord; score: number; european: boolean; slot: number }

/**
 * The story the next post of `day` is written from: the highest-scored recent, draftable story,
 * never one the AI flagged as resting on unproven allegations about a named person,
 * not used by any post yet. When the day's other post isn't European, this one must be.
 */
export function pickStory(
  articles: readonly { key: string; data: ArticleRecord }[],
  todaysPosts: readonly PostRecord[],
  usedArticleKeys: ReadonlySet<string>,
  options: { now?: Date; criteria?: readonly Criterion[]; minScore?: number; maxAgeDays?: number } = {}
): StoryPick {
  const live = livePosts(todaysPosts)
  if (live.length >= POSTS_PER_DAY) return { kind: 'enough' }
  if (todaysPosts.length >= MAX_DRAFTS_PER_DAY) return { kind: 'limit' }
  const now = options.now ?? new Date()
  const minScore = options.minScore ?? MIN_DRAFT_SCORE
  const maxAge = options.maxAgeDays ?? MAX_AGE_DAYS

  const ranked = articles
    .filter(a => a.data.ratings && !a.data.allegation && a.data.origin !== 'link' && !usedArticleKeys.has(a.key) && isRecent(a.data.published, now, maxAge) && canDraft(a.data))
    .map(a => ({ ...a, score: scoreOf(a.data, options.criteria) ?? 0, european: europeanArticle(a.data) }))
    .filter(a => a.score >= minScore)
    .sort((a, b) => b.score - a.score || b.data.published.localeCompare(a.data.published))

  if (ranked.length === 0) {
    return { kind: 'none', reason: `No rated story from the last ${maxAge} days scores ${minScore}+ and has enough text to write from.` }
  }
  // Last post of the day and nothing European yet: this one must be European, if any is.
  const needEuropean = live.length === POSTS_PER_DAY - 1 && !live.some(p => p.european)
  const choice = (needEuropean && ranked.find(a => a.european)) || ranked[0]!
  const slot = todaysPosts.reduce((max, p) => Math.max(max, p.slot), 0) + 1
  return { kind: 'pick', key: choice.key, article: choice.data, score: choice.score, european: choice.european, slot }
}

export function postKey(day: string, slot: number): string {
  return `${day}-${String(slot).padStart(2, '0')}`
}

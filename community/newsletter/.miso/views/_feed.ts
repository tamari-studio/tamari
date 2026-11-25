// Fetching and reading one news feed: a capped download (some feeds run to 12 MB with 2,000
// items), RSS 2.0 and Atom parsing, plain text out of HTML, and the keys used to spot duplicates.
// Everything except fetchFeed is pure and tested in _feed.test.ts.
import { XMLParser } from 'fast-xml-parser'

export type FeedItem = {
  title: string
  url: string
  /** Plain text: the feed's summary or description. Empty when the feed sends only a title. */
  summary: string
  /** Plain text: the full article when the feed carries it (content:encoded, Atom content). */
  content: string
  /** ISO time the item was published. */
  published: string
}

/** Stop reading a feed after this many bytes; the newest items come first in every feed we read. */
export const MAX_FEED_BYTES = 1_500_000
/** Keep at most this many items per feed per fetch. */
export const MAX_ITEMS_PER_FEED = 30
/** A feed that has not answered in this time is skipped for this run. */
export const FEED_TIMEOUT_MS = 15_000
/** Article text kept per item; enough for a post, small enough for the shared store. */
export const MAX_CONTENT_CHARS = 4_000
export const MAX_SUMMARY_CHARS = 1_200

const USER_AGENT = 'Mozilla/5.0 (compatible; Tamari-Newsletter/0.1)'

export class FeedError extends Error {}

/** Downloads a feed, reading no more than MAX_FEED_BYTES. Throws FeedError with a short reason. */
export async function fetchFeed(url: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS)
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    throw new FeedError(name === 'TimeoutError' ? 'no answer within 15 s' : 'could not be reached')
  }
  if (!response.ok) throw new FeedError(`answered HTTP ${response.status}`)
  if (!response.body) throw new FeedError('answered with an empty body')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let capped = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size >= MAX_FEED_BYTES) {
      capped = true
      await reader.cancel().catch(() => {})
      break
    }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = new TextDecoder('utf-8').decode(bytes)
  return capped ? closeTruncatedFeed(text) : text
}

/** Cuts a feed that was stopped mid-download after its last whole item and closes it again. */
export function closeTruncatedFeed(text: string): string {
  const lastItem = text.lastIndexOf('</item>')
  if (lastItem !== -1) return `${text.slice(0, lastItem + '</item>'.length)}</channel></rss>`
  const lastEntry = text.lastIndexOf('</entry>')
  if (lastEntry !== -1) return `${text.slice(0, lastEntry + '</entry>'.length)}</feed>`
  return text
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  isArray: name => name === 'item' || name === 'entry' || name === 'link'
})

type Node = Record<string, unknown>

/** The text of a node that may be a string, a number, or an object with #text. */
function text(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return text(value[0])
  if (typeof value === 'object') return text((value as Node)['#text'])
  return ''
}

function linkOf(item: Node): string {
  const links = item.link
  if (!Array.isArray(links)) return text(links).trim()
  // RSS: <link>url</link>. Atom: <link rel="alternate" href="url"/>, possibly several.
  for (const link of links) {
    if (typeof link === 'string' && link.trim()) return link.trim()
    if (link && typeof link === 'object') {
      const node = link as Node
      const rel = text(node['@_rel'])
      const href = text(node['@_href']).trim()
      if (href && (!rel || rel === 'alternate')) return href
    }
  }
  const guid = text(item.guid).trim()
  return /^https?:\/\//.test(guid) ? guid : ''
}

function dateOf(item: Node): string | null {
  for (const field of ['pubDate', 'published', 'updated', 'dc:date']) {
    const raw = text(item[field]).trim()
    if (!raw) continue
    const time = Date.parse(raw)
    if (!Number.isNaN(time)) return new Date(time).toISOString()
  }
  return null
}

/** Reads every item from an RSS 2.0 or Atom feed. Items without a title, link or date are skipped. */
export function parseFeed(xml: string): FeedItem[] {
  let doc: Node
  try {
    doc = parser.parse(xml) as Node
  } catch {
    throw new FeedError('is not valid XML')
  }
  const channel = (doc.rss as Node | undefined)?.channel as Node | undefined
  const raw = (channel?.item ?? (doc.feed as Node | undefined)?.entry) as Node[] | undefined
  if (!Array.isArray(raw)) throw new FeedError('has no items (not an RSS or Atom feed)')

  const items: FeedItem[] = []
  for (const item of raw) {
    const title = plainText(text(item.title))
    const url = linkOf(item)
    const published = dateOf(item)
    if (!title || !url || !published) continue
    const content = plainText(text(item['content:encoded'] ?? item.content))
    let summary = plainText(text(item.description ?? item.summary))
    // Some feeds repeat the whole article as the description; keep a summary-sized piece.
    if (summary.length > MAX_SUMMARY_CHARS) summary = clip(summary, MAX_SUMMARY_CHARS)
    items.push({ title, url, summary, content: clip(content, MAX_CONTENT_CHARS), published })
  }
  return items
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  euro: '€',
  pound: '£',
  yen: '¥',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  times: '×'
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole
    }
    return ENTITIES[code.toLowerCase()] ?? whole
  })
}

/** HTML to readable plain text: no tags, scripts, images or WordPress "appeared first on" footers. */
export function plainText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/The (post|article) .{1,300}? appeared first on .{1,120}?\s*\.\s*$/s, '')
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cuts text at a word boundary and marks the cut. */
export function clip(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${cut.slice(0, space > max * 0.8 ? space : max).trimEnd()} …`
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|source$|guccounter$)/i

/** The URL as one story: lower-case host without www, no tracking parameters, hash or trailing slash. */
export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url.trim())
    parsed.hash = ''
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, '')
    for (const name of [...parsed.searchParams.keys()]) {
      if (TRACKING.test(name)) parsed.searchParams.delete(name)
    }
    parsed.protocol = 'https:'
    return parsed.toString().replace(/\/(\?|$)/, '$1')
  } catch {
    return url.trim()
  }
}

/** A title reduced to lower-case words, so the same headline from two feeds matches. */
export function normalTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** FNV-1a, 32 bits, as 7 base-36 characters: stable and the same on every machine. */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(7, '0')
}

/** An article's store key: its publication day first, so keys sort by time and a day is a prefix. */
export function articleKey(published: string, url: string): string {
  return `${published.slice(0, 10)}-${shortHash(canonicalUrl(url))}`
}

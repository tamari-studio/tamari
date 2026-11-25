// Reading one article from a link someone pasted: which links may be fetched at all, a capped
// download, and the article's title, site, date and text out of its HTML. Tested in
// _page.test.ts with a stub resolver.
//
// The space's server code runs with the app's secrets and the member session in its environment,
// and shows the fetched text to the user, so a link must never reach an internal address. Every hop
// (the link and each redirect) is resolved first, and any loopback, private, link-local, CGNAT,
// multicast or reserved address, or an IPv6 equivalent, refuses the link. Known gap: a name can
// resolve differently between the check and fetch's own lookup (DNS rebinding); closing that
// needs connecting to the checked address, which plain fetch can't do with TLS.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { clip, plainText } from './_feed'

/** Article text kept for research and writing. */
export const MAX_PAGE_TEXT_CHARS = 8_000
/** Below this, the page is probably a paywall or a script-only page. */
export const MIN_PAGE_TEXT_CHARS = 400
const MAX_PAGE_BYTES = 2_000_000
const PAGE_TIMEOUT_MS = 15_000
const USER_AGENT = 'Mozilla/5.0 (compatible; Tamari-Newsletter/0.1)'

export class PageError extends Error {}

/** Turns a host name into its addresses (every A and AAAA record). */
export type Resolver = (host: string) => Promise<string[]>

const systemResolver: Resolver = async host => (await lookup(host, { all: true, verbatim: true })).map(a => a.address)
let resolver: Resolver = systemResolver

/** Tests swap in a stub so no real DNS is used; pass nothing to go back to the system resolver. */
export function setResolverForTests(stub?: Resolver): void {
  resolver = stub ?? systemResolver
}

function v4Blocked(ip: string): boolean {
  const [a = 0, b = 0, c = 0] = ip.split('.').map(Number)
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  )
}

/** True for any address a pasted link must never reach. Unparseable input counts as blocked. */
export function isBlockedAddress(raw: string): boolean {
  const ip = raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const kind = isIP(ip)
  if (kind === 4) return v4Blocked(ip)
  if (kind !== 6) return true
  if (ip === '::' || ip === '::1') return true
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1) and NAT64 (64:ff9b::/96) carry an IPv4 address.
  if (ip.startsWith('::ffff:') || ip.startsWith('0:0:0:0:0:ffff:') || ip.startsWith('64:ff9b:')) return true
  const first = parseInt(ip.split(':')[0] || '0', 16)
  return (
    (first & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (first & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (first & 0xff00) === 0xff00 || // multicast
    ip.startsWith('2001:db8:') || // documentation
    first === 0 // other ::/16 forms (IPv4-compatible and the like)
  )
}

/** Refuses a host that is, or resolves to, any blocked address. Throws PageError. */
export async function checkHost(host: string): Promise<void> {
  const bare = host.replace(/^\[|\]$/g, '')
  if (isIP(bare)) {
    if (isBlockedAddress(bare)) throw new PageError('That link points to a private or local address, which is not read.')
    return
  }
  let addresses: string[]
  try {
    addresses = await resolver(bare)
  } catch {
    throw new PageError('That web address could not be found.')
  }
  if (addresses.length === 0) throw new PageError('That web address could not be found.')
  if (addresses.some(isBlockedAddress)) throw new PageError('That link points to a private or local address, which is not read.')
}

/**
 * The link as a URL the server may fetch: http(s), a public host name, no credentials, no
 * private or local addresses. Throws PageError with words fit to show.
 */
export function checkLink(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new PageError('That is not a web address. Paste the full link, starting with https://')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new PageError('Only http and https links can be read.')
  if (url.username || url.password) throw new PageError('Links with a user name or password are not read.')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const isIp = /^[\d.]+$/.test(host) || host.includes(':')
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    (isIp && isBlockedAddress(host))
  ) {
    throw new PageError('That link points to a private or local address, which is not read.')
  }
  if (url.port && url.port !== '80' && url.port !== '443') throw new PageError('Only links on the standard web ports are read.')
  url.hash = ''
  return url
}

/** Downloads a page (HTML only, capped). Redirects are followed one at a time and each is checked. */
export async function fetchPage(link: string): Promise<{ url: string; html: string }> {
  let url = checkLink(link)
  for (let hop = 0; hop < 5; hop++) {
    // Resolve before every request, the first and each redirect.
    await checkHost(url.hostname)
    let response: Response
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual',
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
      })
    } catch (err) {
      throw new PageError(err instanceof Error && err.name === 'TimeoutError' ? 'The page did not answer within 15 seconds.' : 'The page could not be reached.')
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = checkLink(new URL(response.headers.get('location')!, url).toString())
      continue
    }
    if (response.status === 401 || response.status === 403) throw new PageError('The site refused to show the page (it may need a login). Paste the article text instead.')
    if (!response.ok) throw new PageError(`The page answered HTTP ${response.status}.`)
    const type = response.headers.get('content-type') ?? ''
    if (type && !/html|xml/i.test(type)) throw new PageError('That link is not a web page (for example a PDF). Paste the article text instead.')
    const reader = response.body?.getReader()
    if (!reader) throw new PageError('The page was empty.')
    const chunks: Uint8Array[] = []
    let size = 0
    while (size < MAX_PAGE_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
    await reader.cancel().catch(() => {})
    const bytes = new Uint8Array(size)
    let at = 0
    for (const c of chunks) {
      bytes.set(c, at)
      at += c.byteLength
    }
    return { url: url.toString(), html: new TextDecoder('utf-8').decode(bytes) }
  }
  throw new PageError('The link redirected too many times.')
}

export type PageArticle = {
  title: string
  site: string
  /** The byline, when the page names one. */
  author: string | null
  /** ISO time, or null when the page doesn't say. */
  published: string | null
  description: string
  text: string
}

function meta(html: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, 'i')
    const tag = re.exec(html)?.[0]
    const content = tag && /content=["']([^"']*)["']/i.exec(tag)?.[1]
    if (content?.trim()) return plainText(content)
  }
  return ''
}

function inner(html: string, tag: string): string | null {
  const open = new RegExp(`<${tag}[\\s>]`, 'i').exec(html)
  if (!open) return null
  const close = html.toLowerCase().lastIndexOf(`</${tag}>`)
  return close > open.index ? html.slice(open.index, close) : null
}

/**
 * Defuddle's Markdown as plain reading text for the AI: links keep their words, images and raw
 * HTML go, emphasis marks are dropped. Headings and list markers stay, they help the reader.
 */
export function markdownText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The article in a page, read the way the Obsidian Web Clipper reads it: Defuddle (the Clipper's
 * own extraction library) over a linkedom document finds the main content and the page's
 * metadata. When Defuddle fails or finds too little text, the simple reader below is used.
 */
export async function readArticle(html: string, url: string): Promise<PageArticle> {
  const basic = readArticleBasic(html, url)
  try {
    const [{ parseHTML }, { Defuddle }] = await Promise.all([import('linkedom'), import('defuddle/node')])
    const { document } = parseHTML(html)
    const result = await Defuddle(document as unknown as Document, url, { markdown: true })
    const text = clip(markdownText(result.content ?? ''), MAX_PAGE_TEXT_CHARS)
    if (text.length < MIN_PAGE_TEXT_CHARS && basic.text.length > text.length) return basic
    const time = Date.parse(result.published ?? '')
    return {
      title: plainText(result.title ?? '') || basic.title,
      site: plainText(result.site ?? '') || basic.site,
      author: plainText(result.author ?? '') || null,
      published: Number.isNaN(time) ? basic.published : new Date(time).toISOString(),
      description: plainText(result.description ?? '') || basic.description,
      text
    }
  } catch (err) {
    console.error('Newsletter: Defuddle could not read the page; using the simple reader', err instanceof Error ? err.message : err)
    return basic
  }
}

/** The simple reader: meta tags and the article/main/body element, page chrome dropped. */
export function readArticleBasic(html: string, url: string): PageArticle {
  const title = meta(html, ['og:title', 'twitter:title']) || plainText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const site = meta(html, ['og:site_name', 'application-name']) || new URL(url).hostname.replace(/^www\./, '')
  const rawDate =
    meta(html, ['article:published_time', 'datePublished', 'pubdate', 'date']) ||
    /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1] ||
    /<time[^>]+datetime=["']([^"']+)["']/i.exec(html)?.[1] ||
    ''
  const time = Date.parse(rawDate)
  const description = meta(html, ['og:description', 'description', 'twitter:description'])
  const body = (inner(html, 'article') ?? inner(html, 'main') ?? inner(html, 'body') ?? html)
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|button|iframe)[\s\S]*?<\/\1>/gi, ' ')
  const text = clip(plainText(body), MAX_PAGE_TEXT_CHARS)
  return { title, site, author: null, published: Number.isNaN(time) ? null : new Date(time).toISOString(), description, text }
}

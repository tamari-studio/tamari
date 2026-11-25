import { expect, test } from 'bun:test'

import { articleKey, canonicalUrl, clip, closeTruncatedFeed, normalTitle, parseFeed, plainText, shortHash } from './_feed'

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<item><title><![CDATA[Meridian raises €200m]]></title><link>https://www.example.com/a/?utm_source=rss</link>
<description><![CDATA[<p>The Lisbon startup&#8217;s round.</p>]]></description>
<content:encoded><![CDATA[<p>Full <b>text</b> here.</p><figure><img src="x"/><figcaption>cap</figcaption></figure><p>The post Meridian raises appeared first on Example.</p>]]></content:encoded>
<pubDate>Thu, 12 Nov 2026 17:19:55 GMT</pubDate></item>
<item><title>No date</title><link>https://example.com/b</link></item>
<item><title>Title only</title><link>https://example.com/c</link><description/><pubDate>Thu, 12 Nov 2026 10:00:00 +0000</pubDate></item>
</channel></rss>`

test('reads RSS items, as plain text, and skips items without a date', () => {
  const items = parseFeed(RSS)
  expect(items).toHaveLength(2)
  expect(items[0]).toEqual({
    title: 'Meridian raises €200m',
    url: 'https://www.example.com/a/?utm_source=rss',
    summary: 'The Lisbon startup’s round.',
    content: 'Full text here.',
    published: '2026-11-12T17:19:55.000Z'
  })
  expect(items[1]!.summary).toBe('')
})

test('reads Atom entries with alternate links', () => {
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Model launch</title>
<link rel="self" href="https://x.ai/self"/><link rel="alternate" href="https://x.ai/post"/>
<summary>Short.</summary><updated>2026-11-11T08:00:00Z</updated></entry></feed>`
  expect(parseFeed(atom)).toEqual([
    { title: 'Model launch', url: 'https://x.ai/post', summary: 'Short.', content: '', published: '2026-11-11T08:00:00.000Z' }
  ])
})

test('refuses what is not a feed', () => {
  expect(() => parseFeed('<html><body>hi</body></html>')).toThrow('has no items')
})

test('a feed cut mid-download is closed after its last whole item', () => {
  const cut = RSS.slice(0, RSS.indexOf('<item><title>No date'))
  const closed = closeTruncatedFeed(cut + '<item><title>half')
  expect(closed.endsWith('</item></channel></rss>')).toBe(true)
  expect(parseFeed(closed)).toHaveLength(1)
})

test('currency and symbol entities are decoded', () => {
  expect(plainText('Raises &euro;50m, &pound;20m and &yen;1bn &times; 2 &copy;')).toBe('Raises €50m, £20m and ¥1bn × 2 ©')
})

test('plain text keeps paragraphs and drops tags', () => {
  expect(plainText('<p>One &amp; two</p><p>Three<br/>four</p>')).toBe('One & two\nThree\nfour')
})

test('drops WordPress "appeared first on" footers in both wordings', () => {
  expect(plainText('<p>Body.</p><p>The post Big news appeared first on Example News.</p>')).toBe('Body.')
  // A second wording, with a space before the full stop.
  expect(plainText('<p>Body.</p><p>The article Orion wins appeared first on <a href="x">Example Wire</a> .</p>')).toBe('Body.')
})

test('clip cuts at a word and marks the cut', () => {
  expect(clip('alpha beta gamma delta', 12)).toBe('alpha beta …')
  expect(clip('short', 12)).toBe('short')
})

test('the same story from different URLs gets the same key', () => {
  expect(canonicalUrl('http://WWW.Example.com/a/?utm_source=x&id=2#top')).toBe('https://example.com/a?id=2')
  expect(canonicalUrl('https://example.com/a')).toBe('https://example.com/a')
  expect(articleKey('2026-11-12T17:00:00Z', 'https://www.example.com/a/')).toBe(articleKey('2026-11-12T01:00:00Z', 'https://example.com/a?utm_medium=feed'))
  expect(articleKey('2026-11-12T17:00:00Z', 'https://example.com/a')).toMatch(/^2026-11-12-[0-9a-z]{7}$/)
  expect(shortHash('a')).not.toBe(shortHash('b'))
})

test('titles match across punctuation, case and accents', () => {
  expect(normalTitle('Meridian’s new model — “Orion” 2.0!')).toBe(normalTitle('meridian s new model orion 2 0'))
  expect(normalTitle('Société Générale')).toBe('societe generale')
})

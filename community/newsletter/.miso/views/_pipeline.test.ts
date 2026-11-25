import { expect, test } from 'bun:test'

import { CHANNEL } from './_channel'
import { channelDay, newArticles, pickStory, postKey, recentDays, toScore, type ArticleRecord, type PostRecord } from './_pipeline'
import type { Ratings } from './_scoring'

const NOW = new Date('2026-11-12T20:00:00Z')
const TEXT = 'A Lisbon startup raised a seed round to build AI agents for insurers, led by a regional fund.'.repeat(2)

function article(over: Partial<ArticleRecord> = {}): ArticleRecord {
  return {
    sourceId: 'continental-tech',
    title: 'T',
    url: 'https://example.org/t',
    canonical: 'https://example.org/t',
    normTitle: 't',
    summary: TEXT,
    content: '',
    published: '2026-11-12T10:00:00.000Z',
    fetchedAt: NOW.toISOString(),
    ...over
  }
}
const rated = (n: number, europe = n, region: ArticleRecord['region'] = 'us'): Partial<ArticleRecord> => ({
  ratings: { topic: n, europe, significance: n, novelty: n, audience: n } as Ratings,
  region
})
function post(over: Partial<PostRecord> = {}): PostRecord {
  return {
    day: '2026-11-12', slot: 1, articleKey: 'x', sourceId: 'continental-tech', sourceName: 'Continental Tech', title: 'T', url: 'u',
    published: '', excerpt: '', text: '', status: 'draft', european: false, score: 80, writtenAt: '', model: 'm', versions: [],
    ...over
  }
}

test('the channel day (UTC by default, or a given time zone) and recent UTC days', () => {
  expect(channelDay(new Date('2026-11-12T23:30:00Z'))).toBe(channelDay(new Date('2026-11-12T23:30:00Z'), CHANNEL.timeZone))
  expect(channelDay(new Date('2026-11-12T23:30:00Z'), 'UTC')).toBe('2026-11-12')
  expect(channelDay(new Date('2026-11-12T23:30:00Z'), 'Europe/Berlin')).toBe('2026-11-13')
  expect(channelDay(new Date('2026-11-12T03:30:00Z'), 'America/Los_Angeles')).toBe('2026-11-11')
  expect(recentDays(3, NOW)).toEqual(['2026-11-12', '2026-11-11', '2026-11-10'])
  expect(postKey('2026-11-12', 3)).toBe('2026-11-12-03')
})

test('new articles: recent only, capped, and no repeats by URL or title', () => {
  const items = [
    { title: 'Fresh', url: 'https://a.com/1', summary: '', content: '', published: '2026-11-12T08:00:00Z' },
    { title: 'Fresh!', url: 'https://a.com/other', summary: '', content: '', published: '2026-11-12T07:00:00Z' },
    { title: 'Known', url: 'https://www.known.com/k/?utm_source=x', summary: '', content: '', published: '2026-11-12T06:00:00Z' },
    { title: 'Old', url: 'https://a.com/old', summary: '', content: '', published: '2026-11-01T06:00:00Z' },
    { title: 'Third', url: 'https://a.com/3', summary: '', content: '', published: '2026-11-11T06:00:00Z' }
  ]
  const out = newArticles('venture-daily', items, [{ canonical: 'https://known.com/k', normTitle: 'nothing' }], { now: NOW, limit: 10 })
  expect(out.map(o => o.data.title)).toEqual(['Fresh', 'Third'])
  expect(out[0]!.key).toMatch(/^2026-11-12-/)
  expect(out[0]!.data).toMatchObject({ sourceId: 'venture-daily', canonical: 'https://a.com/1', normTitle: 'fresh' })
  expect(newArticles('venture-daily', items, [], { now: NOW, limit: 1 })).toHaveLength(1)
})

test('rates unrated recent articles, newest first, and gives up after two failures', () => {
  const rows = [
    { key: 'a', data: article({ published: '2026-11-11T00:00:00Z' }) },
    { key: 'b', data: article({ published: '2026-11-12T00:00:00Z' }) },
    { key: 'c', data: article({ ...rated(5) }) },
    { key: 'd', data: article({ scoreAttempts: 2 }) },
    { key: 'e', data: article({ published: '2026-11-01T00:00:00Z' }) }
  ]
  expect(toScore(rows, NOW).map(r => r.key)).toEqual(['b', 'a'])
  expect(toScore(rows, NOW, 1).map(r => r.key)).toEqual(['b'])
})

test('first post: the best draftable, unused story', () => {
  const rows = [
    { key: 'top-title-only', data: article({ ...rated(10), summary: '' }) },
    { key: 'used', data: article({ ...rated(9) }) },
    { key: 'good', data: article({ ...rated(8) }) },
    { key: 'unrated', data: article() },
    { key: 'weak', data: article({ ...rated(3) }) }
  ]
  const pick = pickStory(rows, [], new Set(['used']), { now: NOW })
  expect(pick).toMatchObject({ kind: 'pick', key: 'good', slot: 1, score: 80, european: true })
})

test('second post must be European when the first is not', () => {
  const rows = [
    { key: 'us-best', data: article({ ...rated(9, 2, 'us') }) },
    { key: 'eu', data: article({ ...rated(6, 9, 'europe') }) }
  ]
  const usFirst = [post({ european: false })]
  expect(pickStory(rows, usFirst, new Set(), { now: NOW })).toMatchObject({ kind: 'pick', key: 'eu', slot: 2, european: true })
  const euFirst = [post({ european: true })]
  expect(pickStory(rows, euFirst, new Set(), { now: NOW })).toMatchObject({ kind: 'pick', key: 'us-best' })
  // No European story at all: still the best one.
  expect(pickStory([rows[0]!], usFirst, new Set(), { now: NOW })).toMatchObject({ kind: 'pick', key: 'us-best' })
})

test('a rejected post frees its slot; two live posts or the draft limit end the day', () => {
  const rows = [{ key: 'a', data: article({ ...rated(8) }) }]
  expect(pickStory(rows, [post({ status: 'rejected', slot: 1 }), post({ status: 'approved', slot: 2, european: true })], new Set(), { now: NOW })).toMatchObject({ kind: 'pick', slot: 3 })
  expect(pickStory(rows, [post(), post({ slot: 2 })], new Set(), { now: NOW })).toEqual({ kind: 'enough' })
  const rejected = Array.from({ length: 8 }, (_, i) => post({ status: 'rejected', slot: i + 1 }))
  expect(pickStory(rows, rejected, new Set(), { now: NOW })).toEqual({ kind: 'limit' })
  expect(pickStory([], [], new Set(), { now: NOW }).kind).toBe('none')
})

test('a story flagged as resting on allegations is never picked, however high it scores', () => {
  const rows = [
    { key: 'scandal', data: article({ ...rated(10), allegation: true }) },
    { key: 'news', data: article({ ...rated(7) }) }
  ]
  expect(pickStory(rows, [], new Set(), { now: NOW })).toMatchObject({ kind: 'pick', key: 'news' })
  expect(pickStory([rows[0]!], [], new Set(), { now: NOW }).kind).toBe('none')
})

import { expect, test } from 'bun:test'
import { dayTitle, groupByDay, historyPath, sentenceText, timeAgo, type ActivityItem } from './activity'

const item = (over: Partial<ActivityItem>): ActivityItem => ({
  id: 1,
  at: '2026-11-20T10:00:00',
  kind: 'record',
  action: 'update',
  actor: { id: 'a', name: 'Anna', automatic: false },
  space: { id: 'finance', name: 'Finance' },
  title: 'Budget 2027',
  collection: 'budget-lines',
  collectionTitle: 'Budget lines',
  key: 'b1',
  version: 2,
  from: null,
  ...over
})

test('a record change reads as a sentence', () => {
  expect(sentenceText(item({}))).toBe('Anna changed Budget 2027 in Finance')
  expect(sentenceText(item({ action: 'insert' }))).toBe('Anna added Budget 2027 in Finance')
  expect(sentenceText(item({ action: 'delete', space: null }))).toBe('Anna removed Budget 2027')
})

test('nobody, a job, and a space that is gone', () => {
  expect(sentenceText(item({ actor: { id: null, name: null, automatic: false } }))).toBe('Someone changed Budget 2027 in Finance')
  expect(sentenceText(item({ actor: { id: 'j', name: null, automatic: true } }))).toBe('An automatic update changed Budget 2027 in Finance')
  expect(sentenceText(item({ space: { id: 'old', name: null } }))).toBe('Anna changed Budget 2027')
})

test('pages and spaces', () => {
  const tab = { kind: 'tab', title: 'Budget board', collection: null, collectionTitle: null, version: null } as const
  expect(sentenceText(item({ ...tab, action: 'insert' }))).toBe('Anna opened the page Budget board in Finance')
  expect(sentenceText(item({ ...tab, action: 'delete' }))).toBe('Anna closed the page Budget board in Finance')
  expect(sentenceText(item({ ...tab, action: 'update', from: 'Sales' }))).toBe('Anna moved the page Budget board from Sales to Finance')
  expect(sentenceText(item({ ...tab, action: 'update' }))).toBe('Anna moved the page Budget board to Finance')
  const space = { kind: 'space', title: 'Finance', collection: null, collectionTitle: null, version: null } as const
  expect(sentenceText(item({ ...space, action: 'insert' }))).toBe('Anna added the space Finance')
  expect(sentenceText(item({ ...space, action: 'update', from: 'Money' }))).toBe('Anna renamed the space Money to Finance')
  expect(sentenceText(item({ ...space, action: 'delete' }))).toBe('Anna deleted the space Finance')
})

const now = new Date('2026-11-20T12:00:00')

test('time in words', () => {
  expect(timeAgo('2026-11-20T11:59:40', now)).toBe('Just now')
  expect(timeAgo('2026-11-20T11:59:00', now)).toBe('1 minute ago')
  expect(timeAgo('2026-11-20T10:00:00', now)).toBe('2 hours ago')
  expect(timeAgo('2026-11-18T09:05:00', now)).toBe('09:05')
})

test('days', () => {
  expect(dayTitle('2026-11-20T00:10:00', now)).toBe('Today')
  expect(dayTitle('2026-11-19T23:50:00', now)).toBe('Yesterday')
  expect(dayTitle('2026-11-16T10:00:00', now)).toBe('Monday 16 November')
  expect(dayTitle('2025-12-31T10:00:00', now)).toBe('Wednesday 31 December 2025')
  const days = groupByDay(
    [item({ id: 4, at: '2026-11-20T11:00:00' }), item({ id: 3, at: '2026-11-20T09:00:00' }), item({ id: 2, at: '2026-11-19T09:00:00' })],
    now
  )
  expect(days.map(d => [d.title, d.items.map(i => i.id)])).toEqual([
    ['Today', [4, 3]],
    ['Yesterday', [2]]
  ])
})

test('the address of a page of the feed', () => {
  expect(historyPath({})).toBe('/api/history')
  expect(historyPath({ space: 'finance', before: 40, limit: 8 })).toBe('/api/history?space=finance&before=40&limit=8')
})

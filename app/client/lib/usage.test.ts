import { expect, test } from 'bun:test'

import type { UsageEvent } from '../../lib/usage'
import { createTracker, FLUSH_AT, SESSION_IDLE_MS } from './usage'

function setup() {
  let now = 1_000_000
  let ids = 0
  const sent: { events: UsageEvent[]; keepalive: boolean }[] = []
  const tracker = createTracker({
    now: () => now,
    newId: () => `s${++ids}`,
    send: async (events, keepalive) => void sent.push({ events, keepalive })
  })
  return { tracker, sent, advance: (ms: number) => (now += ms) }
}

test('the first event starts a session, and a flush sends them in order', () => {
  const { tracker, sent } = setup()
  tracker.view('sp-open', 'widgets')
  tracker.action('tab.open', 'sp-open')
  tracker.flush()
  expect(sent).toEqual([
    {
      keepalive: false,
      events: [
        { kind: 'session', target: 'start', spaceId: null, sessionId: 's1' },
        { kind: 'view', target: 'widgets', spaceId: 'sp-open', sessionId: 's1' },
        { kind: 'action', target: 'tab.open', spaceId: 'sp-open', sessionId: 's1' }
      ]
    }
  ])
  tracker.flush()
  expect(sent).toHaveLength(1)
})

test('half an hour without activity starts a new session', () => {
  const { tracker, sent, advance } = setup()
  tracker.view(null, 'page:members')
  advance(SESSION_IDLE_MS - 1)
  tracker.view(null, 'page:usage')
  advance(SESSION_IDLE_MS)
  tracker.view(null, 'page:members')
  tracker.flush()
  const events = sent[0].events
  expect(events.filter(e => e.kind === 'session').map(e => e.sessionId)).toEqual(['s1', 's2'])
  expect(events.at(-1)).toEqual({ kind: 'view', target: 'page:members', spaceId: null, sessionId: 's2' })
})

test('the same view twice in a row counts once', () => {
  const { tracker, sent, advance } = setup()
  tracker.view('sp-open', 'widgets')
  advance(500)
  tracker.view('sp-open', 'widgets')
  tracker.flush()
  expect(sent[0].events.filter(e => e.kind === 'view')).toHaveLength(1)
})

test('coming back after a long break counts the screen again, in a new session', () => {
  const { tracker, sent, advance } = setup()
  tracker.view('sp-open', 'view:open/board')
  tracker.resume()
  advance(SESSION_IDLE_MS)
  tracker.resume()
  tracker.flush()
  expect(sent[0].events.map(e => `${e.kind}:${e.target}:${e.sessionId}`)).toEqual([
    'session:start:s1',
    'view:view:open/board:s1',
    'session:start:s2',
    'view:view:open/board:s2'
  ])
})

test('a full batch goes out on its own; a page leaving sends with keepalive', () => {
  const { tracker, sent } = setup()
  for (let i = 0; i < FLUSH_AT - 1; i++) tracker.action('tab.reorder', null)
  expect(sent).toHaveLength(1)
  expect(sent[0].events).toHaveLength(FLUSH_AT)
  tracker.action('tab.close', null)
  tracker.flush(true)
  expect(sent[1]).toEqual({ keepalive: true, events: [{ kind: 'action', target: 'tab.close', spaceId: null, sessionId: 's1' }] })
})

test('a server that keeps failing never grows the queue past its cap', async () => {
  const sent: number[] = []
  const tracker = createTracker({
    now: () => 0,
    newId: () => 's',
    send: async events => {
      sent.push(events.length)
      throw new Error('down')
    }
  })
  for (let i = 0; i < FLUSH_AT * 3; i++) tracker.action('tab.open', null)
  expect(tracker.pending()).toBeLessThan(FLUSH_AT)
  // Failed batches are dropped, not retried: a down server costs nothing later.
  await Promise.resolve()
  expect(sent.every(n => n <= FLUSH_AT)).toBe(true)
})

test('a reload within half an hour keeps the session', () => {
  let saved: { id: string; lastAt: number } | null = null
  const memory = { load: () => saved, save: (id: string, lastAt: number) => void (saved = { id, lastAt }) }
  const sent: UsageEvent[] = []
  const make = (now: number) =>
    createTracker({ now: () => now, newId: () => `s${now}`, send: async events => void sent.push(...events), memory })
  make(1_000).view(null, 'page:members')
  const reloaded = make(2_000)
  reloaded.view(null, 'page:usage')
  reloaded.flush()
  expect(sent.filter(e => e.kind === 'session')).toEqual([])
  expect(sent.map(e => e.sessionId)).toEqual(['s1000'])
  const later = make(2_000 + SESSION_IDLE_MS)
  later.view(null, 'page:usage')
  later.flush()
  expect(sent.at(-1)?.sessionId).toBe(`s${2_000 + SESSION_IDLE_MS}`)
})

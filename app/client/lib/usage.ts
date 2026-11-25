// Usage analytics, the browser half: which screens people open and what they do, sent in small
// batches to /api/usage (app/server/usage.ts), which stores them in this app's own database. Only
// ids the app already knows (a tab ref, a workspace page, an action name), never what's on screen.
//
// A session is one browser tab's run of use, kept across reloads; half an hour without any event
// ends it. Events
// wait in a queue and go out every few seconds, when the queue fills, and when the page is
// hidden or closed. A batch the server refuses is dropped, not retried.
import { useEffect } from 'react'
import type { UsageAction, UsageEvent } from '../../lib/usage'
import { USAGE_BATCH_MAX } from '../../lib/usage'
import { accessToken } from '../runtime/session'

export const SESSION_IDLE_MS = 30 * 60_000
export const FLUSH_EVERY_MS = 15_000
export const FLUSH_AT = 20
// The same screen reported again this soon is a re-render, not a second visit.
const SAME_VIEW_MS = 2_000

type Send = (events: UsageEvent[], keepalive: boolean) => Promise<void>
// Where the session survives a reload: sessionStorage in the browser.
type Memory = { load(): { id: string; lastAt: number } | null; save(id: string, lastAt: number): void }

export function createTracker(deps: { now: () => number; newId: () => string; send: Send; memory?: Memory }) {
  let queue: UsageEvent[] = []
  const saved = deps.memory?.load() ?? null
  let sessionId: string | null = saved?.id ?? null
  let lastAt = saved?.lastAt ?? 0
  let lastView: { spaceId: string | null; target: string; at: number } | null = null

  function flush(keepalive = false): void {
    while (queue.length) {
      const batch = queue.slice(0, Math.min(FLUSH_AT, USAGE_BATCH_MAX))
      queue = queue.slice(batch.length)
      void deps.send(batch, keepalive).catch(() => {})
    }
  }

  function push(event: Omit<UsageEvent, 'sessionId'>): void {
    const now = deps.now()
    if (sessionId === null || now - lastAt >= SESSION_IDLE_MS) {
      sessionId = deps.newId()
      queue.push({ kind: 'session', target: 'start', spaceId: null, sessionId })
    }
    lastAt = now
    deps.memory?.save(sessionId, lastAt)
    queue.push({ ...event, sessionId })
    if (queue.length >= FLUSH_AT) flush()
  }

  return {
    view(spaceId: string | null, target: string): void {
      const now = deps.now()
      if (lastView && lastView.spaceId === spaceId && lastView.target === target && now - lastView.at < SAME_VIEW_MS) return
      lastView = { spaceId, target, at: now }
      push({ kind: 'view', target, spaceId })
    },
    action(target: UsageAction, spaceId: string | null): void {
      push({ kind: 'action', target, spaceId })
    },
    // Back on the page: after a break long enough to end the session, the screen they come back
    // to counts as a view in the new one.
    resume(): void {
      if (lastView && sessionId !== null && deps.now() - lastAt >= SESSION_IDLE_MS) {
        lastView = { ...lastView, at: deps.now() }
        push({ kind: 'view', target: lastView.target, spaceId: lastView.spaceId })
      }
    },
    flush,
    pending: () => queue.length
  }
}

async function send(events: UsageEvent[], keepalive: boolean): Promise<void> {
  const token = await accessToken()
  if (!token) return
  await fetch('/api/usage', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
    // Lets the last batch finish while the page closes.
    keepalive
  })
}

const SESSION_KEY = 'miso.usage.session'
const UUID = /^[0-9a-f-]{36}$/i

const sessionMemory: Memory = {
  load() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { id?: unknown; lastAt?: unknown } | null
      return typeof saved?.id === 'string' && UUID.test(saved.id) && typeof saved.lastAt === 'number'
        ? { id: saved.id, lastAt: saved.lastAt }
        : null
    } catch {
      return null
    }
  },
  save(id, lastAt) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id, lastAt }))
    } catch {
      // Private mode or a full storage: the session just ends with the page.
    }
  }
}

const tracker = createTracker({
  now: () => Date.now(),
  newId: () => crypto.randomUUID(),
  send,
  memory: typeof sessionStorage === 'undefined' ? undefined : sessionMemory
})

export const trackView = tracker.view
export const trackAction = tracker.action

// Once, in the signed-in app: sends the queue on a timer and when the page goes away.
export function useUsageTracking(): void {
  useEffect(() => {
    const timer = setInterval(() => tracker.flush(), FLUSH_EVERY_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') tracker.flush(true)
      else tracker.resume()
    }
    const onPageHide = () => tracker.flush(true)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      tracker.flush()
    }
  }, [])
}

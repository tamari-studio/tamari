// Tells the server this person is using the app: once on load, then at most
// every five minutes, and only when they actually click or type. The server
// keeps one timestamp per person (app.record_activity), visible to owners only.
import { useEffect } from 'react'
import { api } from './http'

export const PING_EVERY_MS = 5 * 60_000

export function shouldPing(lastPingAt: number | null, now: number): boolean {
  return lastPingAt === null || now - lastPingAt >= PING_EVERY_MS
}

export function useActivityHeartbeat(): void {
  useEffect(() => {
    let lastPingAt: number | null = null
    const ping = () => {
      const now = Date.now()
      if (!shouldPing(lastPingAt, now)) return
      // Set before the request, so a failing server is retried in five
      // minutes rather than on every click.
      lastPingAt = now
      void api('/api/activity', { method: 'POST' }).catch(() => {})
    }
    ping()
    window.addEventListener('pointerdown', ping, { passive: true })
    window.addEventListener('keydown', ping, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', ping)
      window.removeEventListener('keydown', ping)
    }
  }, [])
}

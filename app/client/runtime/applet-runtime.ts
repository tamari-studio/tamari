// The `miso` (and legacy `moi`) module a view imports, bound to the space its
// code lives in. `focusTab('view:roadmap')` in ibtikar's code means ibtikar's
// roadmap even when that view has been moved to another space's tabs.
import { apiFetch } from './api-fetch'
import { getBridge } from './session'

export function runtimeFor(folder: string) {
  return {
    fileUrl(path: string): string {
      const clean = String(path).replace(/^\/+/, '')
      return `/api/files/${encodeURIComponent(folder)}/${clean.split('/').map(encodeURIComponent).join('/')}`
    },
    // The hosted API's own routes (a path starting with /api/), called as the signed-in member.
    apiFetch,
    focusTab(tab: string, params?: Record<string, unknown>): void {
      getBridge()?.focusTab(folder, tab, params)
    },
    // Whether focusTab(tab) would open something for this person: false for a view or space they
    // don't see, so a view can leave out a link they couldn't follow. Local miso has no canOpen,
    // so space code calls it as `canOpen?.(tab) ?? true`.
    canOpen(tab: string): boolean {
      return getBridge()?.canOpen(folder, tab) ?? false
    },
    sendChatMessage(message: string, context?: Record<string, unknown>): void {
      getBridge()?.sendChatMessage(folder, message, context)
    }
  }
}

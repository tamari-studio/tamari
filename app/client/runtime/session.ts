// Browser-wide state the applet runtime needs outside React: the signed-in
// session's token, which space is on screen, and the shell's navigation bridge.
import type { SupabaseClient } from '@supabase/supabase-js'

export type ShellBridge = {
  focusTab: (fromFolder: string, tab: string, params?: Record<string, unknown>) => void
  canOpen: (fromFolder: string, tab: string) => boolean
  sendChatMessage: (fromFolder: string, message: string, context?: Record<string, unknown>) => void
}

let supabase: SupabaseClient | null = null
let currentSpaceId: string | null = null
let bridge: ShellBridge | null = null

export function setSupabase(client: SupabaseClient): void {
  supabase = client
}

export function getSupabase(): SupabaseClient {
  if (!supabase) throw new Error('miso: Supabase client not ready')
  return supabase
}

export async function accessToken(): Promise<string | null> {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

export function setCurrentSpace(id: string | null): void {
  currentSpaceId = id
}

// Which space displays each mounted view or widget (Applet.tsx). A server
// function call names the space showing an applet of its folder, so a widget
// from ops placed on management's grid calls as management — even on its
// first render, before the shell's effect has set the current space.
const displayed = new Map<symbol, { spaceId: string; folder: string }>()

export function showApplet(token: symbol, spaceId: string, folder: string): void {
  displayed.set(token, { spaceId, folder })
}

export function hideApplet(token: symbol): void {
  displayed.delete(token)
}

// The space displaying `folder`'s code. If several do, the one on screen wins,
// then the one that mounted last; with none mounted, the space on screen.
export function displayingSpace(folder: string): string | null {
  const spaces = [...displayed.values()].filter(d => d.folder === folder).map(d => d.spaceId)
  if (spaces.length === 0) return currentSpaceId
  if (currentSpaceId && spaces.includes(currentSpaceId)) return currentSpaceId
  return spaces[spaces.length - 1]!
}

export function setBridge(next: ShellBridge | null): void {
  bridge = next
}

export function getBridge(): ShellBridge | null {
  return bridge
}

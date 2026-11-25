// "Connect your coding agent": a card floating bottom-right until one of the person's tokens has
// been used (ai_tokens.last_used_at). Connecting clears it for good; × ("Remind me later") hides it
// for a week, on this browser. It leads to Settings → Connect your AI. Nothing shows where
// connecting isn't set up, or on Settings itself.
import { IconCheck, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import { APP_NAME } from '../../lib/brand'
import { useMe, useOrgSettings } from '../lib/queries'
import { navigate, useRoute } from '../lib/router'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { CONNECT_AI_ID, useAiTokens } from './ConnectAi'

export const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
const snoozeKey = (userId: string) => `tamari:connect-agent-later:${userId}`

/** Whether "Remind me later" (the time it was clicked, as stored) still hides the card at `now`. */
export const snoozed = (stored: string | null, now = Date.now()): boolean => {
  const at = Number(stored)
  return stored !== null && Number.isFinite(at) && now - at < SNOOZE_MS
}

export function ConnectAgentBanner() {
  const me = useMe().data
  const route = useRoute()
  const company = useOrgSettings().data?.name
  const [later, setLater] = useState(() => !!me && snoozed(localStorage.getItem(snoozeKey(me.id))))
  const hidden = later || (!!me && snoozed(localStorage.getItem(snoozeKey(me.id))))
  const tokens = useAiTokens(!hidden)
  const active = me?.status === 'active' && me.tier !== null
  if (!active || hidden || route.page === 'settings' || !tokens.data?.available || tokens.data.tokens.some(t => t.lastUsedAt)) return null
  return (
    <aside
      aria-label="Connect your coding agent"
      className="fixed right-4 bottom-4 z-40 flex w-[300px] flex-col gap-3 rounded-2xl border bg-background p-3 text-sm shadow-lg max-[480px]:inset-x-3 max-[480px]:bottom-3 max-[480px]:w-auto"
    >
      <div className="flex items-center justify-between">
        <Badge variant="outline">Setup</Badge>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Remind me later"
          title="Remind me later"
          onClick={() => {
            localStorage.setItem(snoozeKey(me.id), String(Date.now()))
            setLater(true)
          }}
        >
          <IconX stroke={1.75} />
        </Button>
      </div>
      {/* What it looks like once connected: a picture, so screen readers skip it. */}
      <div aria-hidden className="flex flex-col gap-1 rounded-lg border bg-muted/50 p-2.5 font-mono text-xs text-muted-foreground">
        <p className="break-words">$ claude mcp add --transport http {APP_NAME.toLowerCase()} …</p>
        <p className="text-foreground">&gt; whoami</p>
        <p className="flex min-w-0 items-start gap-1 text-foreground">
          <IconCheck size={12} stroke={1.75} className="mt-0.5 shrink-0 text-success" />
          <span className="min-w-0 break-words">
            Connected as {me.name ?? me.email} · {company ?? 'your workspace'}
          </span>
        </p>
      </div>
      <div className="flex flex-col gap-1 px-0.5">
        <p className="font-medium">Connect your coding agent</p>
        <p className="text-muted-foreground">Let Claude Code or another agent read your spaces and build new ones with you.</p>
      </div>
      <Button variant="outline" size="sm" className="self-start" onClick={() => navigate(`/settings#${CONNECT_AI_ID}`)}>
        Connect
      </Button>
    </aside>
  )
}

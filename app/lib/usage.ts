// Usage analytics: what the browser reports (app/client/lib/usage.ts), what the API stores
// (app/server/usage.ts, miso.usage_events) and what the Usage page reads back. A closed list
// of ids, never free text: a target is a tab ref, a workspace page or one of the actions below.

export const USAGE_KINDS = ['session', 'view', 'action'] as const
export type UsageKind = (typeof USAGE_KINDS)[number]

// The workspace pages (app/client/lib/router.ts), as `page:<name>` targets.
export const USAGE_PAGES = ['connectors', 'shared-data', 'members', 'space-access', 'usage', 'settings'] as const
export type UsagePage = (typeof USAGE_PAGES)[number]

// What people do in the shell, besides opening tabs and pages.
export const USAGE_ACTIONS = [
  'tab.open',
  'tab.close',
  'tab.move',
  'tab.reorder',
  'widget.arrange',
  'widget.move',
  'space.edit',
  'space.create',
  'theme.edit',
  'subspace.create',
  'subspace.delete',
  'feedback.send'
] as const
export type UsageAction = (typeof USAGE_ACTIONS)[number]

export const USAGE_ACTION_LABEL: Record<UsageAction, string> = {
  'tab.open': 'Opened a tab',
  'tab.close': 'Closed a tab',
  'tab.move': 'Moved a tab to another space',
  'tab.reorder': 'Reordered tabs',
  'widget.arrange': 'Arranged widgets',
  'widget.move': 'Moved a widget to another space',
  'space.edit': 'Changed a space name or icon',
  'space.create': 'Added a space',
  'theme.edit': 'Changed the look of the app',
  'subspace.create': 'Made a subspace',
  'subspace.delete': 'Deleted a subspace',
  'feedback.send': 'Sent feedback'
}

export const USAGE_PAGE_LABEL: Record<UsagePage, string> = {
  connectors: 'Connectors',
  'shared-data': 'Data map',
  members: 'People & access',
  'space-access': 'People & access (Spaces)',
  usage: 'Usage',
  settings: 'Settings'
}

// The shape the database accepts (usage_events_target_id).
export const USAGE_TARGET = /^[A-Za-z0-9:/._-]{1,200}$/
export const USAGE_BATCH_MAX = 50
export const USAGE_DAYS = [7, 30, 90] as const

export type UsageEvent = {
  kind: UsageKind
  target: string
  spaceId: string | null
  // One per browser tab, renewed after half an hour without activity.
  sessionId: string
}

export type UsageCount = { views: number; users: number }

export type UsageReport = {
  from: string
  to: string
  days: number
  // Distinct people active today, in the last 7 days and in the last 30 days.
  active: { today: number; week: number; month: number }
  totals: { users: number; sessions: number; events: number }
  daily: { day: string; users: number; sessions: number; events: number }[]
  weekly: { week: string; users: number }[]
  spaces: ({ spaceId: string; name: string } & UsageCount)[]
  tabs: ({ spaceId: string; target: string } & UsageCount)[]
  pages: ({ target: string } & UsageCount)[]
  actions: { target: string; count: number; users: number }[]
  // Owners only; null for admins. Last seen is the latest event or activity ping.
  members: UsageMember[] | null
}

export type UsageMember = {
  userId: string
  email: string
  name: string | null
  tier: string | null
  status: string
  lastSeenAt: string | null
}

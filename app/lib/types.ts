// Types shared by the hosted app's server (app/server) and browser (app/client).
import type { Tier } from '../vendor/dto-core/tier'

export type WidgetSize = 1 | 2 | 3 | 4

// One view or widget, identified across spaces by `<folder>/<name>`.
export type CatalogApplet = {
  ref: string
  folder: string
  name: string
  kind: 'view' | 'widget'
  file: string
  title: string
  icon?: string
  requiredEnv: string[]
  rowSpan?: WidgetSize
  colSpan?: WidgetSize
  // The lowest tier that sees this view or widget (its `config.minTier`), on
  // top of its space's own; everyone who sees the space when absent.
  minTier?: MemberTier
}

export type CatalogSpace = {
  id: string
  slug: string
  folder: string
  previousSlugs: string[]
  position: number
  name: string
  theme: Record<string, string>
  // From .workspace.json; the backend takes it when it first adds the space.
  icon?: string
  // The lowest tier that sees this space (spaces.json `minTier`); everyone when absent.
  minTier?: MemberTier
  // A member's draft (spaces.json `draft`, `createdBy`): nobody reviewed its code. Its server
  // functions don't run (server/drafts.ts), except a module byte-identical to the live space's
  // (`draftOf`), which runs as the live space. `sameModules` comes from the build.
  draft?: true
  createdBy?: string
  draftOf?: string
  // A copy's starting commit in the spaces' history (server/proposals.ts): files still as the live
  // space had them then pass the draft guard (build/draft-guard.ts).
  baseCommit?: string
  sameModules?: string[]
}

export type Catalog = {
  spaces: CatalogSpace[]
  applets: CatalogApplet[]
}

// Build output: where each applet's compiled module and the shared CSS live.
export type BuildManifest = {
  builtAt: string
  commit: string | null
  modules: Record<string, string>
  // A view's or widget's own stylesheet, by the same key as `modules`; loaded with it.
  moduleCss?: Record<string, string>
  css: string[]
}

export type SpaceTheme = {
  font?: string
  color?: string
  radius?: string
}

export type Space = {
  id: string
  slug: string
  name: string
  folder: string | null
  previousSlugs: string[]
  position: number
  theme: SpaceTheme
  icon: string | null
  // The icon an admin picked (app/lib/symbols.ts); null shows the default for the folder.
  symbol: string | null
  // A subspace's top-level space (one level deep, owners only for now); null for a spaces.json space.
  parentId: string | null
}

// Settings for the whole app (miso.org_settings): its look, the same on every page, and the workspace
// name at the top of the sidebar (null: the product name).
export type OrgSettings = { theme: SpaceTheme; name: string | null }

// 'widgets' or 'view:<folder>/<name>'.
export type TabRef = 'widgets' | `view:${string}`

export type Tab = {
  id: string
  spaceId: string
  ref: TabRef
  position: number
  params: Record<string, unknown> | null
}

// x/y: top-left cell in the widget grid's frame (0-based); w/h: size in cells,
// 2×2 when missing. `grid` is the frame width the numbers refer to (14); a
// placement without it was saved on the older 7-wide grid. No x/y means
// "first free spot". See app/client/lib/widget-grid.ts.
export type WidgetPlacement = { ref: string; x?: number; y?: number; w?: number; h?: number; grid?: number }

export type SpaceLayout = {
  spaceId: string
  widgets: WidgetPlacement[]
  activeTab: string | null
}

export type Workspace = {
  spaces: Space[]
  tabs: Tab[]
  layouts: SpaceLayout[]
}

export type ConnectorKind = 'supabase' | 'airtable' | 'google-drive' | 'gmail' | 'tito' | 'custom'

export type ConnectorConfig = {
  url?: string
  envKeys?: string[]
  connectedAccount?: string
}

export type Connector = {
  id: string
  kind: ConnectorKind
  name: string
  config: ConnectorConfig
  disabledSpaceIds: string[]
  // Env keys that have a value stored. Values never leave the server.
  setKeys: string[]
  createdAt: string
  updatedAt: string
}

export type ConnectorInput = {
  kind: ConnectorKind
  name: string
  config?: ConnectorConfig
  secrets?: Record<string, string>
  disabledSpaceIds?: string[]
}

export type ConnectorPatch = {
  name?: string
  config?: ConnectorConfig
  secrets?: Record<string, string>
  disabledSpaceIds?: string[]
}

// The data map (app/build/data-map.ts): one space's code names one source.
// `env` is an env var a connector provides. `applets` are catalog keys
// (`view:<folder>/<name>`, `widget:<folder>/<name>`).
export type DataSourceKind = 'table' | 'function' | 'collection' | 'env'
export type DataUse = { kind: DataSourceKind; name: string; folder: string; applets: string[] }

export type RecordCollection = { name: string; count: number; updatedAt: string | null }

export type SharedRecord = {
  collection: string
  key: string
  data: unknown
  spaceId: string | null
  updatedAt: string
}

export type Me = {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
  // Their own app.app_user row; null when they have none yet.
  tier: MemberTier | null
  status: MemberStatus | null
}

// The Members screen. `tier` is the shared-data tier (app.tier); a person with a
// tier but a status other than 'active' can still read nothing.
export type MemberTier = Tier
export type MemberStatus = 'pending' | 'active' | 'suspended'

export type Member = {
  id: string
  email: string
  name: string | null
  // Their job title, when they gave one in the welcome step.
  position?: string
  tier: MemberTier | null
  status: MemberStatus
  // Why the viewer can't edit this row, or null when they can.
  locked: string | null
  // Owners only: the server leaves the key out for everyone else.
  lastActiveAt?: string | null
}

export type MembersResponse = {
  viewer: { id: string; tier: MemberTier }
  assignableTiers: MemberTier[]
  members: Member[]
}

export type MemberChange = { tier?: MemberTier; status?: 'active' | 'suspended' }

// An open invite (miso.invitations): the address signs up and lands active at `tier`.
export type Invitation = { id: string; email: string; tier: MemberTier; createdAt: string; expiresAt: string }

// Who sees a space, set by hand on the Space access page (miso.space_access,
// migration 20261110000000_departments): anyone in its tiers, its
// departments or its people. A space without a rule keeps its spaces.json
// `minTier`. Owners see every space, so `tiers` never needs to name them.
export type SpaceAccessRule = {
  spaceId: string
  tiers: MemberTier[]
  departments?: string[]
  people?: string[]
  // Everyone the rule names, directly or through a department (user ids).
  members?: string[]
}

// A rule as the Space access page sets it.
export type SpaceAccessChange = { tiers: MemberTier[]; departments: string[]; people: string[] }

export type Department = { id: string; name: string; memberIds: string[] }

// The welcome step on first sign-in (server/welcome.ts): name and department(s).
export type WelcomeDepartment = { id: string; name: string }
// newTeam: they may type a new team (admins and owners). samples: they get the sample-space step (the first owner).
// position: the database keeps a position, so the step asks for one.
export type WelcomeState = { needed: boolean; name: string | null; departments: WelcomeDepartment[]; newTeam: boolean; samples: boolean; position: boolean }
export type WelcomeInput = { name: string; departmentIds: string[]; position?: string; newTeam?: string }
// A starter template the company can add as a space (server/samples.ts). image: it has a picture.
export type SampleSpace = { type: string; title: string; space: string; job: string; image: boolean; added: boolean }
// `joined` is false when the person picked departments but an admin still has to place them.
export type WelcomeResult = { name: string; joined: boolean }

// One row of the Space access page (admins and owners only).
export type SpaceAccessEntry = {
  id: string
  name: string
  // Who sees it right now: the rule's tiers, or the default's.
  tiers: MemberTier[]
  // Departments and people the rule names besides its tiers (none without a rule).
  departments: string[]
  people: string[]
  // Who sees it without a rule (spaces.json `minTier`).
  defaultTiers: MemberTier[]
  // Whether a rule overrides the default.
  custom: boolean
}

export type SpaceAccessResponse = {
  // The tiers a rule can name: everyone but owners, most privileged first.
  tiers: MemberTier[]
  spaces: SpaceAccessEntry[]
}

export type ClientConfig = {
  supabaseUrl: string
  supabasePublishableKey: string
  commit: string | null
  builtAt: string
}

// Feedback from the rail's Feedback button (miso.feedback, migration 0065 in the
// miso repo). Anyone signed in sends it and reads back their own; owners and
// admins read all of it and tick issues completed (the health space's feedback view).
export const FEEDBACK_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number]

export type FeedbackInput = {
  title: string
  description: string
  priority: FeedbackPriority
  // The app path the person was on, e.g. /kpis.
  page?: string | null
}

export type FeedbackItem = {
  id: number
  title: string
  description: string
  priority: FeedbackPriority
  page: string | null
  submittedBy: string | null
  submitterEmail: string | null
  submitterName: string | null
  createdAt: string
  completedAt: string | null
  completedByEmail: string | null
}


// The Proposals page (server/proposal-routes.ts): a member's change to a space, or their draft space
// to publish, waiting for an admin or owner. Admins and owners get every one; a member their own.
export type ProposalStatus = 'open' | 'approved' | 'rejected' | 'withdrawn' | 'out_of_date'
export type Proposal = {
  id: string
  kind: 'change' | 'publish'
  // The space it changes (a change), or the draft space itself (a publication).
  spaceId: string
  spaceName: string
  summary: string
  visibility: 'team' | 'everyone' | null
  authorId: string
  author: string
  mine: boolean
  status: ProposalStatus
  reason: string | null
  createdAt: string
  decidedAt: string | null
}

// Connector kinds and the env vars each one hands to server code. The names
// match local miso's (server/connectors.ts there), so a space's `*.server.ts`
// reads the same `process.env.X` in both places.
import type { Connector, ConnectorConfig, ConnectorKind } from './types'

export type ConnectorKindInfo = {
  label: string
  // One plain sentence on what connecting it gives you.
  description: string
  // Secret env keys the connector stores (fixed per kind; `custom` declares its own).
  secretKeys: string[]
  // True when the kind needs a non-secret `url`.
  needsUrl?: boolean
  // What the connect form calls each stored key, instead of its env name.
  fieldLabels?: Record<string, string>
  // Where to find the values, in plain words, and the page to open for them.
  help?: string
  helpUrl?: string
}

export const CONNECTOR_KINDS: Record<ConnectorKind, ConnectorKindInfo> = {
  supabase: {
    label: 'Supabase',
    description: 'Lets spaces read and save data in a Supabase project.',
    secretKeys: ['SUPABASE_PUBLISHABLE_KEY'],
    needsUrl: true,
    fieldLabels: { SUPABASE_PUBLISHABLE_KEY: 'Publishable key' },
    help: 'In the Supabase project, open Project settings, then API keys. Copy the project URL and the publishable key (it starts with sb_publishable_). Never paste a secret key here.',
    helpUrl: 'https://supabase.com/dashboard/project/_/settings/api-keys'
  },
  airtable: {
    label: 'Airtable',
    description: 'Lets spaces read and update your Airtable bases.',
    secretKeys: ['AIRTABLE_TOKEN'],
    fieldLabels: { AIRTABLE_TOKEN: 'Personal access token' },
    help: 'In Airtable, open the Builder Hub, then Personal access tokens. Create a token that can reach the bases your spaces use, and paste it here.',
    helpUrl: 'https://airtable.com/create/tokens'
  },
  tito: {
    label: 'Tito',
    description: 'Lets spaces read tickets and registrations from Tito.',
    secretKeys: ['TITO_TOKEN'],
    fieldLabels: { TITO_TOKEN: 'API token' },
    help: 'Sign in to Tito, open API access tokens in your account, create a token and paste it here.',
    helpUrl: 'https://id.tito.io/api-access-tokens'
  },
  gmail: {
    label: 'Gmail',
    description: 'Lets spaces send and read mail from one Gmail mailbox.',
    secretKeys: ['GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'],
    fieldLabels: {
      GMAIL_OAUTH_CLIENT_ID: 'OAuth client ID',
      GMAIL_OAUTH_CLIENT_SECRET: 'OAuth client secret',
      GMAIL_REFRESH_TOKEN: 'Refresh token'
    },
    help: 'There is no "Sign in with Google" here yet. Create an OAuth client with Gmail access in Google Cloud, then get a refresh token for the mailbox with it (Google\'s OAuth Playground can do that). Spaces can use the mailbox once all three values are saved.'
  },
  'google-drive': {
    label: 'Google Drive',
    description: 'Not in use yet: spaces get nothing from a Google Drive connector.',
    secretKeys: []
  },
  custom: {
    label: 'Custom',
    description: "Named values a space's code needs, such as a key for a service that isn't listed.",
    secretKeys: []
  }
}

// What the form calls one stored key: its plain label, or the env name itself for `custom`.
export function fieldLabel(kind: ConnectorKind, key: string): string {
  return CONNECTOR_KINDS[kind].fieldLabels?.[key] ?? key
}

const ENV_KEY = /^[A-Z_][A-Z0-9_]*$/

export function isValidEnvKey(key: string): boolean {
  return ENV_KEY.test(key)
}

// Names no connector may provide (the server also refuses them at runtime):
// miso's own logins and settings, and every name that decides what a process
// runs, loads or trusts, or which model endpoint and credentials an agent
// uses. Any member can edit a connector, and its values reach every space's
// server code here and every space's workers, agent and MCP servers on each
// connected local miso, which applies this same function
// (isReservedSharedEnvKey in local miso's server/connectors.ts; keep the two
// in step). Three rules:
//   (a) the name must be plain upper case (`^[A-Z][A-Z0-9_]*$`), so `Path`,
//       `Node_Options` or `https_proxy` can't slip past the lists below;
//   (b) a denied prefix, or the `_PROXY` suffix;
//   (c) a denied exact name.
const RESERVED_SHAPE = /^[A-Z][A-Z0-9_]*$/

const RESERVED_PREFIXES = [
  'MISO_',
  'SUPABASE_SERVICE_',
  'ANTHROPIC_',
  'CLAUDE_',
  'OPENAI_',
  'CODEX_',
  'GEMINI_',
  'GOOGLE_APPLICATION_',
  'AWS_',
  'GIT_',
  'NODE_',
  'BUN_',
  'NPM_CONFIG_',
  'PYTHON',
  'PERL',
  'RUBY',
  'LD_',
  'DYLD_',
  'SSL_',
  'XDG_',
  'LC_'
]

const RESERVED_NAMES = new Set([
  'PATH',
  'HOME',
  'SHELL',
  'BASH_ENV',
  'ENV',
  'ZDOTDIR',
  'EDITOR',
  'VISUAL',
  'PAGER',
  'LESSOPEN',
  'LESSCLOSE',
  'TMPDIR',
  'USER',
  'LOGNAME',
  'TERM',
  'LANG',
  'SUPABASE_SECRET_KEY',
  'CURL_CA_BUNDLE',
  'REQUESTS_CA_BUNDLE',
  'NO_PROXY'
])

export function isReservedEnvKey(key: string): boolean {
  if (!RESERVED_SHAPE.test(key)) return true
  if (key.endsWith('_PROXY')) return true
  if (RESERVED_PREFIXES.some(prefix => key.startsWith(prefix))) return true
  return RESERVED_NAMES.has(key)
}

export function secretKeysFor(kind: ConnectorKind, config: ConnectorConfig): string[] {
  if (kind === 'custom') return (config.envKeys ?? []).filter(isValidEnvKey)
  return CONNECTOR_KINDS[kind].secretKeys
}

// Opt-outs, never opt-ins: a connector reaches every space — including spaces
// added after it was created — unless that space is in its denylist.
export function isConnectorEnabledForSpace(
  connector: Pick<Connector, 'disabledSpaceIds'>,
  spaceId: string
): boolean {
  return !connector.disabledSpaceIds.includes(spaceId)
}

export function nextDisabledSpaceIds(
  connector: Pick<Connector, 'disabledSpaceIds'>,
  spaceId: string,
  enabled: boolean
): string[] {
  const rest = connector.disabledSpaceIds.filter(id => id !== spaceId)
  return enabled ? rest : [...rest, spaceId]
}

// The account part of a Gmail connector's env names, as local miso names it
// (gmailAccountLabel in its server/connectors.ts): the connected address's
// local part, upper-cased, anything outside A-Z/0-9 folded to `_`
// (`ana@example.com` → `ANA`). Falls back to the connector's name.
export function gmailAccountLabel(connector: { name?: string; config: ConnectorConfig }): string {
  const source = connector.config.connectedAccount?.split('@')[0] || connector.name || ''
  return (
    source
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'ACCOUNT'
  )
}

// The env names one Gmail connector hands to server code: `GMAIL_<ACCOUNT>_…`,
// so two connected inboxes never collide on one key. The stored secret keeps
// the plain GMAIL_OAUTH_CLIENT_ID/…_SECRET/GMAIL_REFRESH_TOKEN names; only the
// env is per-account. Same names as local miso (plan 29).
export function gmailEnvKeys(connector: { name?: string; config: ConnectorConfig }) {
  const prefix = `GMAIL_${gmailAccountLabel(connector)}`
  return {
    clientId: `${prefix}_OAUTH_CLIENT_ID`,
    clientSecret: `${prefix}_OAUTH_CLIENT_SECRET`,
    refreshToken: `${prefix}_REFRESH_TOKEN`
  }
}

// The env vars one connector contributes, given its stored secret values. A key
// only appears once it has a value; gmail only once all three are present, under
// its per-account names (gmailEnvKeys).
export function connectorEnv(
  connector: Pick<Connector, 'kind' | 'config'> & { name?: string },
  secrets: Record<string, string>
): Record<string, string> {
  const pick = (keys: string[]) => {
    const out: Record<string, string> = {}
    for (const key of keys) if (secrets[key]) out[key] = secrets[key]
    return out
  }
  switch (connector.kind) {
    case 'supabase': {
      const out = pick(['SUPABASE_PUBLISHABLE_KEY'])
      if (connector.config.url) out.SUPABASE_URL = connector.config.url
      return out
    }
    case 'gmail': {
      const clientId = secrets.GMAIL_OAUTH_CLIENT_ID
      const clientSecret = secrets.GMAIL_OAUTH_CLIENT_SECRET
      const refreshToken = secrets.GMAIL_REFRESH_TOKEN
      if (!clientId || !clientSecret || !refreshToken) return {}
      const keys = gmailEnvKeys(connector)
      return { [keys.clientId]: clientId, [keys.clientSecret]: clientSecret, [keys.refreshToken]: refreshToken }
    }
    case 'custom':
      return pick(secretKeysFor('custom', connector.config))
    case 'google-drive':
      return {}
    default:
      return pick(CONNECTOR_KINDS[connector.kind].secretKeys)
  }
}

export type ConnectorStatus = {
  state: 'connected' | 'attention' | 'inactive'
  label: string
  // Stored keys that have no value yet.
  missing: string[]
}

// Only what the stored data shows: whether every value the kind needs is saved.
// Nothing here tests that a saved value still works.
export function connectorStatus(connector: Pick<Connector, 'kind' | 'config' | 'setKeys'>): ConnectorStatus {
  if (connector.kind === 'google-drive') return { state: 'inactive', label: 'Not in use yet', missing: [] }
  const missing = secretKeysFor(connector.kind, connector.config).filter(key => !connector.setKeys.includes(key))
  return missing.length > 0
    ? { state: 'attention', label: 'Needs attention', missing }
    : { state: 'connected', label: 'Connected', missing: [] }
}

// The env names a connector hands to space code once every value is saved.
export function providedEnvNames(connector: Pick<Connector, 'kind' | 'config'> & { name?: string }): string[] {
  const filled = Object.fromEntries(secretKeysFor(connector.kind, connector.config).map(key => [key, 'x']))
  return Object.keys(connectorEnv(connector, filled))
}

export function reachLabel(connector: Pick<Connector, 'disabledSpaceIds'>, spaceIds: string[]): string {
  const off = spaceIds.filter(id => connector.disabledSpaceIds.includes(id)).length
  if (off === 0) return 'All spaces'
  const on = spaceIds.length - off
  if (on === 0) return 'No spaces'
  if (off <= on) return `All spaces but ${off}`
  return on === 1 ? '1 space' : `${on} spaces`
}

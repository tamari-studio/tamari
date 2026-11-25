import { describe, expect, test } from 'bun:test'
import {
  connectorEnv,
  connectorStatus,
  fieldLabel,
  isConnectorEnabledForSpace,
  isReservedEnvKey,
  nextDisabledSpaceIds,
  providedEnvNames,
  reachLabel
} from './connectors'

describe('connector reach', () => {
  test('a new connector is on in every space, including ones added later', () => {
    const connector = { disabledSpaceIds: [] as string[] }
    expect(isConnectorEnabledForSpace(connector, 'a')).toBe(true)
    expect(isConnectorEnabledForSpace(connector, 'added-later')).toBe(true)
  })

  test('turning one space off leaves every other space on', () => {
    const connector = { disabledSpaceIds: nextDisabledSpaceIds({ disabledSpaceIds: [] }, 'a', false) }
    expect(connector.disabledSpaceIds).toEqual(['a'])
    expect(isConnectorEnabledForSpace(connector, 'a')).toBe(false)
    expect(isConnectorEnabledForSpace(connector, 'added-later')).toBe(true)
    expect(nextDisabledSpaceIds(connector, 'a', true)).toEqual([])
  })

  test('reach labels', () => {
    const spaces = ['a', 'b', 'c', 'd']
    expect(reachLabel({ disabledSpaceIds: [] }, spaces)).toBe('All spaces')
    expect(reachLabel({ disabledSpaceIds: ['a'] }, spaces)).toBe('All spaces but 1')
    expect(reachLabel({ disabledSpaceIds: ['a', 'b', 'c'] }, spaces)).toBe('1 space')
    expect(reachLabel({ disabledSpaceIds: spaces }, spaces)).toBe('No spaces')
  })
})

test('the Supabase secret key is reserved for miso itself', () => {
  expect(isReservedEnvKey('SUPABASE_SECRET_KEY')).toBe(true)
  expect(isReservedEnvKey('SUPABASE_PUBLISHABLE_KEY')).toBe(false)
})

// The same table as local miso's server/test/connectors-backend.test.ts.
const RESERVED_EXAMPLES = [
  // git runs whatever these name (core.fsmonitor via GIT_CONFIG_*, ssh, editor, pager)
  'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_SSH_COMMAND', 'GIT_EDITOR', 'GIT_PAGER',
  // the agent's model endpoint and credentials (Bedrock, Vertex, others)
  'CLAUDE_CODE_USE_BEDROCK', 'ANTHROPIC_BEDROCK_BASE_URL', 'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'CLAUDE_CODE_USE_VERTEX', 'ANTHROPIC_VERTEX_BASE_URL', 'CLAUDE_CODE_SKIP_VERTEX_AUTH', 'ANTHROPIC_VERTEX_PROJECT_ID',
  'OPENAI_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR',
  'GEMINI_API_KEY', 'CODEX_HOME', 'AWS_ACCESS_KEY_ID', 'GOOGLE_APPLICATION_CREDENTIALS',
  // proxies, in every case
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy',
  // shells, loaders and interpreters
  'PATH', 'HOME', 'SHELL', 'BASH_ENV', 'ENV', 'ZDOTDIR', 'TMPDIR', 'USER', 'LOGNAME', 'TERM', 'LANG', 'LC_ALL',
  'XDG_CONFIG_HOME', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'BUN_OPTIONS', 'LD_PRELOAD',
  'DYLD_INSERT_LIBRARIES', 'PYTHONPATH', 'PERL5OPT', 'RUBYOPT', 'NPM_CONFIG_SCRIPT_SHELL', 'npm_config_script_shell',
  // trust stores
  'SSL_CERT_FILE', 'CURL_CA_BUNDLE', 'REQUESTS_CA_BUNDLE',
  // editors and pagers
  'EDITOR', 'VISUAL', 'PAGER', 'LESSOPEN', 'LESSCLOSE',
  // Windows case variants, and anything not plain upper case
  'Path', 'Node_Options', '_LEADING_UNDERSCORE', 'lower',
  // miso's own
  'MISO_SPACE_ID', 'SUPABASE_SERVICE_EMAIL', 'SUPABASE_SECRET_KEY'
]

// Every name in Vault on 2026-09-28 (names only), plus the per-account Gmail env names.
const ALLOWED_EXAMPLES = [
  'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'AIRTABLE_TOKEN', 'TITO_TOKEN',
  'GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN',
  'GMAIL_LEJ_OAUTH_CLIENT_ID', 'GMAIL_LEJ_OAUTH_CLIENT_SECRET', 'GMAIL_LEJ_REFRESH_TOKEN',
  'GMAIL_ASG_OAUTH_CLIENT_ID', 'GMAIL_ASG_OAUTH_CLIENT_SECRET', 'GMAIL_ASG_REFRESH_TOKEN',
  'ECONOMIC_AGREEMENT_GRANT_TOKEN', 'ECONOMIC_APP_SECRET_TOKEN', 'EXT_ZWIRN_TOKEN', 'INVITATION_ENGINE_DIR'
]

describe('reserved env names', () => {
  test.each(RESERVED_EXAMPLES)('%s is reserved', key => {
    expect(isReservedEnvKey(key)).toBe(true)
  })
  test.each(ALLOWED_EXAMPLES)('%s is a connector’s to set', key => {
    expect(isReservedEnvKey(key)).toBe(false)
  })
})

describe('connectorEnv', () => {
  test('supabase contributes its url and key', () => {
    expect(connectorEnv({ kind: 'supabase', config: { url: 'https://x.supabase.co' } }, { SUPABASE_PUBLISHABLE_KEY: 'k' })).toEqual({
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'k'
    })
  })

  test('only keys with values appear', () => {
    expect(connectorEnv({ kind: 'airtable', config: {} }, {})).toEqual({})
    expect(connectorEnv({ kind: 'custom', config: { envKeys: ['A', 'B'] } }, { A: '1', B: '', C: '3' })).toEqual({ A: '1' })
  })

  test('gmail only once all three values are present', () => {
    const partial = { GMAIL_OAUTH_CLIENT_ID: 'id', GMAIL_OAUTH_CLIENT_SECRET: 's' }
    expect(connectorEnv({ kind: 'gmail', config: {} }, partial)).toEqual({})
    expect(Object.keys(connectorEnv({ kind: 'gmail', config: {} }, { ...partial, GMAIL_REFRESH_TOKEN: 'r' }))).toHaveLength(3)
  })

  test('gmail env names follow the connected account, like local miso', () => {
    const bag = { GMAIL_OAUTH_CLIENT_ID: 'id', GMAIL_OAUTH_CLIENT_SECRET: 's', GMAIL_REFRESH_TOKEN: 'r' }
    expect(connectorEnv({ kind: 'gmail', name: 'Inbox', config: { connectedAccount: 'asg@example.com' } }, bag)).toEqual({
      GMAIL_ASG_OAUTH_CLIENT_ID: 'id',
      GMAIL_ASG_OAUTH_CLIENT_SECRET: 's',
      GMAIL_ASG_REFRESH_TOKEN: 'r'
    })
    // No connected account yet: the connector's name stands in.
    expect(Object.keys(connectorEnv({ kind: 'gmail', name: 'LEJ - Gmail', config: {} }, bag))).toEqual([
      'GMAIL_LEJ_GMAIL_OAUTH_CLIENT_ID',
      'GMAIL_LEJ_GMAIL_OAUTH_CLIENT_SECRET',
      'GMAIL_LEJ_GMAIL_REFRESH_TOKEN'
    ])
  })
})

describe('connector status', () => {
  test('connected only once every value the kind needs is saved', () => {
    const gmail = { kind: 'gmail' as const, config: {} }
    expect(connectorStatus({ ...gmail, setKeys: ['GMAIL_OAUTH_CLIENT_ID'] })).toEqual({
      state: 'attention',
      label: 'Needs attention',
      missing: ['GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']
    })
    expect(
      connectorStatus({ ...gmail, setKeys: ['GMAIL_OAUTH_CLIENT_ID', 'GMAIL_OAUTH_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'] }).state
    ).toBe('connected')
    expect(connectorStatus({ kind: 'custom', config: { envKeys: ['A', 'B'] }, setKeys: ['A'] }).missing).toEqual(['B'])
  })

  test('google drive is never shown as connected: it gives spaces nothing', () => {
    expect(connectorStatus({ kind: 'google-drive', config: {}, setKeys: [] }).state).toBe('inactive')
  })

  test('env names a connector provides, and the plain label of each stored key', () => {
    expect(providedEnvNames({ kind: 'supabase', config: { url: 'https://x.supabase.co' } })).toEqual([
      'SUPABASE_PUBLISHABLE_KEY',
      'SUPABASE_URL'
    ])
    expect(providedEnvNames({ kind: 'gmail', name: 'Partners', config: {} })).toEqual([
      'GMAIL_PARTNERS_OAUTH_CLIENT_ID',
      'GMAIL_PARTNERS_OAUTH_CLIENT_SECRET',
      'GMAIL_PARTNERS_REFRESH_TOKEN'
    ])
    expect(providedEnvNames({ kind: 'google-drive', config: {} })).toEqual([])
    expect(fieldLabel('airtable', 'AIRTABLE_TOKEN')).toBe('Personal access token')
    expect(fieldLabel('custom', 'BRELLA_TOKEN')).toBe('BRELLA_TOKEN')
  })
})

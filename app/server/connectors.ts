// Connectors live once in miso.connectors and reach every space unless a space
// opts out. Metadata goes through the caller's own client (row level security);
// secret values only ever go through the service account and Vault.
import { CONNECTOR_KINDS, connectorEnv, isConnectorEnabledForSpace, isReservedEnvKey, isValidEnvKey, secretKeysFor } from '../lib/connectors'
import type { Connector, ConnectorConfig, ConnectorInput, ConnectorKind, ConnectorPatch } from '../lib/types'
import { vaultClient, type Db } from './supabase'
import { APP_NAME } from '../lib/brand'

type ConnectorRow = {
  id: string
  kind: ConnectorKind
  name: string
  config: ConnectorConfig | null
  disabled_space_ids: string[] | null
  created_at: string
  updated_at: string
}

const COLUMNS = 'id, kind, name, config, disabled_space_ids, created_at, updated_at'

export class InputError extends Error {}

function toConnector(row: ConnectorRow, setKeys: string[]): Connector {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    config: row.config ?? {},
    disabledSpaceIds: row.disabled_space_ids ?? [],
    setKeys,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function cleanConfig(kind: ConnectorKind, config: ConnectorConfig | undefined): ConnectorConfig {
  const out: ConnectorConfig = {}
  if (CONNECTOR_KINDS[kind].needsUrl) {
    const url = config?.url?.trim()
    if (!url || !/^https:\/\//.test(url)) throw new InputError('A Supabase connector needs an https:// URL.')
    out.url = url
  }
  if (kind === 'custom') {
    const keys = [...new Set((config?.envKeys ?? []).map(k => k.trim()).filter(Boolean))]
    const bad = keys.filter(k => !isValidEnvKey(k))
    if (bad.length) throw new InputError(`Not valid env var names: ${bad.join(', ')}`)
    const reserved = keys.filter(isReservedEnvKey)
    if (reserved.length) throw new InputError(`${APP_NAME} reserves ${reserved.join(', ')} for itself, so a connector can't set ${reserved.length === 1 ? 'it' : 'them'}.`)
    if (keys.length === 0) throw new InputError('A custom connector needs at least one env var name.')
    out.envKeys = keys
  }
  // A non-string here would throw in gmailAccountLabel on every server function call.
  if (typeof config?.connectedAccount === 'string' && config.connectedAccount) out.connectedAccount = config.connectedAccount
  return out
}

function cleanSecrets(kind: ConnectorKind, config: ConnectorConfig, secrets: Record<string, string> | undefined) {
  if (!secrets) return undefined
  const allowed = new Set(secretKeysFor(kind, config))
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(secrets)) {
    if (!allowed.has(key)) throw new InputError(`${key} isn't a key this connector stores.`)
    if (typeof value !== 'string') throw new InputError(`${key} must be text.`)
    out[key] = value.trim()
  }
  return out
}

function cleanSpaceIds(ids: unknown): string[] | undefined {
  if (ids === undefined) return undefined
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) {
    throw new InputError('disabledSpaceIds must be a list of space ids.')
  }
  return [...new Set(ids)]
}

async function secretKeys(db: Db): Promise<Map<string, string[]>> {
  const { data, error } = await db.rpc('connector_secret_keys')
  if (error) throw new Error(`connector keys: ${error.message}`)
  return new Map(((data ?? []) as { connector_id: string; keys: string[] }[]).map(r => [r.connector_id, r.keys]))
}

async function storedSecrets(): Promise<Map<string, Record<string, string>>> {
  const service = await vaultClient()
  const { data, error } = await service.rpc('connector_secrets')
  if (error) throw new Error(`connector secrets: ${error.message}`)
  return new Map(
    ((data ?? []) as { connector_id: string; secret: Record<string, string> | null }[]).map(r => [
      r.connector_id,
      r.secret ?? {}
    ])
  )
}

async function writeSecrets(id: string, patch: Record<string, string>): Promise<void> {
  const current = (await storedSecrets()).get(id) ?? {}
  const next: Record<string, string> = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value) next[key] = value
    else delete next[key]
  }
  const service = await vaultClient()
  const { error } = await service.rpc('set_connector_secret', { p_connector: id, p_secret: next })
  if (error) throw new Error(`saving connector secret: ${error.message}`)
  invalidateEnvCache()
}

export async function listConnectors(db: Db): Promise<Connector[]> {
  const [{ data, error }, keys] = await Promise.all([
    db.from('connectors').select(COLUMNS).order('created_at').order('id'),
    secretKeys(db)
  ])
  if (error) throw new Error(`connectors: ${error.message}`)
  return ((data ?? []) as ConnectorRow[]).map(row => toConnector(row, keys.get(row.id) ?? []))
}

async function getConnector(db: Db, id: string): Promise<Connector | null> {
  const [{ data, error }, keys] = await Promise.all([
    db.from('connectors').select(COLUMNS).eq('id', id).maybeSingle<ConnectorRow>(),
    secretKeys(db)
  ])
  if (error) throw new Error(`connector: ${error.message}`)
  return data ? toConnector(data, keys.get(id) ?? []) : null
}

export async function createConnector(db: Db, input: ConnectorInput): Promise<Connector> {
  if (!Object.hasOwn(CONNECTOR_KINDS, input.kind)) throw new InputError(`Unknown connector kind "${input.kind}".`)
  const name = input.name?.trim()
  if (!name) throw new InputError('Give the connector a name.')
  const config = cleanConfig(input.kind, input.config)
  const secrets = cleanSecrets(input.kind, config, input.secrets)
  const { data, error } = await db
    .from('connectors')
    .insert({ kind: input.kind, name, config, disabled_space_ids: cleanSpaceIds(input.disabledSpaceIds) ?? [] })
    .select(COLUMNS)
    .single<ConnectorRow>()
  if (error) throw new Error(`creating connector: ${error.message}`)
  if (secrets && Object.values(secrets).some(Boolean)) {
    try {
      await writeSecrets(data.id, secrets)
    } catch (err) {
      // Don't leave a connector behind that looks set up but has no values.
      await db.from('connectors').delete().eq('id', data.id)
      throw err
    }
  }
  invalidateEnvCache()
  return (await getConnector(db, data.id)) ?? toConnector(data, [])
}

export async function updateConnector(db: Db, id: string, patch: ConnectorPatch): Promise<Connector | null> {
  const current = await getConnector(db, id)
  if (!current) return null
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new InputError('Give the connector a name.')
    update.name = name
  }
  const config = patch.config !== undefined ? cleanConfig(current.kind, { ...current.config, ...patch.config }) : current.config
  if (patch.config !== undefined) update.config = config
  const disabled = cleanSpaceIds(patch.disabledSpaceIds)
  if (disabled !== undefined) update.disabled_space_ids = disabled
  // Checked before anything is saved, so a refused key leaves the connector as it was.
  const secrets = cleanSecrets(current.kind, config, patch.secrets)
  if (Object.keys(update).length > 0) {
    const { error } = await db.from('connectors').update(update).eq('id', id)
    if (error) throw new Error(`updating connector: ${error.message}`)
  }
  if (secrets && Object.keys(secrets).length > 0) await writeSecrets(id, secrets)
  invalidateEnvCache()
  return getConnector(db, id)
}

export async function deleteConnector(db: Db, id: string): Promise<boolean> {
  const { data, error } = await db.from('connectors').delete().eq('id', id).select('id')
  if (error) throw new Error(`deleting connector: ${error.message}`)
  invalidateEnvCache()
  return (data ?? []).length > 0
}

// --- Env for server code ------------------------------------------------------

type ResolvedConnector = { name: string; disabledSpaceIds: string[]; env: Record<string, string> }

const ENV_TTL_MS = 30_000
let envCache: { at: number; connectors: Promise<ResolvedConnector[]> } | null = null

function invalidateEnvCache(): void {
  envCache = null
}

async function loadResolvedConnectors(): Promise<ResolvedConnector[]> {
  const service = await vaultClient()
  const [{ data, error }, secrets] = await Promise.all([
    service.from('connectors').select(COLUMNS).order('created_at').order('id'),
    storedSecrets()
  ])
  if (error) throw new Error(`connectors: ${error.message}`)
  return ((data ?? []) as ConnectorRow[]).map(row => ({
    name: row.name,
    disabledSpaceIds: row.disabled_space_ids ?? [],
    env: connectorEnv({ kind: row.kind, name: row.name, config: row.config ?? {} }, secrets.get(row.id) ?? {})
  }))
}

// The env one space's server code gets from connectors. The server's own env
// always wins: a connector can never replace a key the deployment is
// configured with (SUPABASE_URL, the service logins…) — otherwise anyone who
// can edit a connector could point server code, and the credentials it signs
// in with, at a host of their choosing. Keys only a turned-off connector
// provides come back as `undefined`, so a value another space's call left
// behind can't leak in. Later connectors win on a clash, like local miso: rows
// are ordered by created_at, then id, so two rows imported in the same instant
// always resolve the same way (local miso sorts identically).
export async function connectorEnvForSpace(
  spaceId: string,
  baseEnv: Record<string, string | undefined> = process.env
): Promise<Record<string, string | undefined>> {
  if (!envCache || Date.now() - envCache.at > ENV_TTL_MS) {
    const connectors = loadResolvedConnectors()
    envCache = { at: Date.now(), connectors }
    connectors.catch(() => {
      if (envCache?.connectors === connectors) envCache = null
    })
  }
  const connectors = await envCache.connectors
  const env: Record<string, string | undefined> = {}
  for (const connector of connectors) {
    if (!isConnectorEnabledForSpace(connector, spaceId)) {
      for (const key of Object.keys(connector.env)) {
        if (!(key in env) && baseEnv[key] === undefined) env[key] = undefined
      }
    }
  }
  const givenBy: Record<string, string[]> = {}
  for (const connector of connectors) {
    if (!isConnectorEnabledForSpace(connector, spaceId)) continue
    for (const [key, value] of Object.entries(connector.env)) {
      if (isReservedEnvKey(key)) warnReserved(key)
      else if (baseEnv[key] === undefined) {
        env[key] = value
        ;(givenBy[key] ??= []).push(connector.name)
      }
    }
  }
  warnClashes(spaceId, givenBy)
  return env
}

// A reserved name a connector holds anyway (set before the list grew, or
// written around the form): dropped, and logged once by name, never value.
const warnedReserved = new Set<string>()

function warnReserved(key: string): void {
  if (warnedReserved.has(key)) return
  warnedReserved.add(key)
  console.warn(`[connectors] ignoring ${JSON.stringify(key)} from a connector: ${APP_NAME} reserves that name.`)
}

// Two enabled connectors giving one space the same env name: the later one
// wins, which is easy to get wrong without noticing. Warned once per space and
// clash, with key and connector names only, never a value (local miso warns
// the same way).
const warnedClashes = new Set<string>()

function warnClashes(spaceId: string, givenBy: Record<string, string[]>): void {
  for (const [key, names] of Object.entries(givenBy)) {
    if (names.length < 2) continue
    const signature = [spaceId, key, ...names].join('\0')
    if (warnedClashes.has(signature)) continue
    warnedClashes.add(signature)
    console.warn(
      `[connectors] ${key} comes from ${names.length} connectors in space ${spaceId}: ` +
        `${names.map(n => `"${n}"`).join(', ')}; the last one wins.`
    )
  }
}

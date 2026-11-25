// Runs a space's server function: the hosted twin of local miso's function
// workers. The browser stub (app/build/plugins.ts) posts devalue-encoded args
// to /api/rpc/<folder>/<module>/<fn>; this looks the module up in the registry
// the build generated, and calls the export inside the calling space's env.
import { parse, stringify } from 'devalue'
import { connectorEnvForSpace } from './connectors'
import { hostedDtoToken } from './dto-session'
import { withEnv } from './env'
import { VAULT_ENV_KEYS } from './supabase'
import { CALLER_EMAIL_ENV, CALLER_ID_ENV } from './caller'
import { ACCESS_TOKEN_ENV, SECRET_KEY_ENV } from '../vendor/dto-core/session'

export type ServerModules = Record<string, () => Promise<Record<string, unknown>>>

export class RpcError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

const MAX_BODY_BYTES = 1024 * 1024
const MAX_ERROR_CHARS = 500

export function spaceErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return (message || 'The server function failed.').slice(0, MAX_ERROR_CHARS)
}

export function spaceCallEnv(options: {
  connectorEnv: Record<string, string | undefined>
  spaceId: string
  folder: string
  dtoToken: string | null
  // The verified member behind the call (id and email only, never their
  // access token). Absent when nobody is signed in.
  caller?: { id: string; email: string | null } | null
}): Record<string, string | undefined> {
  return {
    ...options.connectorEnv,
    // Space code never sees the vault login or the Supabase secret key: only
    // the API itself holds them.
    ...Object.fromEntries(VAULT_ENV_KEYS.map(key => [key, undefined])),
    [SECRET_KEY_ENV]: undefined,
    ...(options.dtoToken ? { [ACCESS_TOKEN_ENV]: options.dtoToken } : {}),
    // Set after the connector values and masked when absent, so a connector
    // (or the server's own process env) can never pose as the caller.
    [CALLER_ID_ENV]: options.caller?.id,
    [CALLER_EMAIL_ENV]: options.caller?.email ?? undefined,
    MISO_SPACE_ID: options.spaceId,
    MISO_SPACE_FOLDER: options.folder,
    MISO_HOSTED: '1'
  }
}

export async function callServerFunction(options: {
  modules: ServerModules
  folder: string
  moduleKey: string
  fn: string
  spaceId: string
  body: string
  // The authenticated member; only id and email reach the function's env.
  caller?: { id: string; email: string | null } | null
}): Promise<string> {
  const { modules, folder, moduleKey, fn, spaceId, body, caller } = options
  if (body.length > MAX_BODY_BYTES) throw new RpcError('Arguments are larger than 1 MB.', 413)
  const load = modules[`${folder}/${moduleKey}`]
  if (!load) throw new RpcError(`No server module ${folder}/${moduleKey}.server.ts in this build.`, 404)

  let args: unknown
  try {
    args = body ? parse(body) : []
  } catch {
    throw new RpcError('Arguments are not valid devalue.', 400)
  }
  if (!Array.isArray(args)) throw new RpcError('Arguments must be a list.', 400)

  // Independent; on a cold instance each mints its own session.
  const [connectorEnv, dtoToken] = await Promise.all([connectorEnvForSpace(spaceId), hostedDtoToken()])
  const env = spaceCallEnv({
    connectorEnv,
    spaceId,
    folder,
    dtoToken,
    caller: caller ? { id: caller.id, email: caller.email } : null
  })
  return withEnv(env, async () => {
    const mod = await load()
    const target = mod[fn]
    if (typeof target !== 'function') {
      throw new RpcError(`${folder}/${moduleKey}.server.ts has no function "${fn}".`, 404)
    }
    let result: unknown
    try {
      result = await (target as (...a: unknown[]) => Promise<unknown>)(...args)
    } catch (err) {
      // The space's own words reach the person (README, "Server functions"); the shell's plumbing
      // around the call (module load, env, connectors) stays behind the generic 500.
      console.error(`${folder}/${moduleKey}.${fn} threw:`, err)
      throw new RpcError(spaceErrorMessage(err), 500)
    }
    return stringify(result)
  })
}

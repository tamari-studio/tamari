/**
 * The verified member behind a server-function call.
 *
 *   import { callerEmail, requireCaller } from '@miso/caller'
 *   const { email } = requireCaller()
 *
 * The hosted app authenticates every request and puts the member's email and
 * user id into the call's env as MISO_CALLER_EMAIL / MISO_CALLER_ID (see
 * app/server/rpc.ts). Connectors can't set `MISO_*` names, so a value here can
 * only have come from the app. The member's access token is never passed on.
 *
 * Server-side only — call it from a `*.server.ts` file. Outside the hosted app
 * (local miso) nobody is signed in, so the helpers return null and
 * `requireCaller()` throws.
 *
 * Call it inside the function body, never at module top level (modules are
 * cached and the caller is scoped per call).
 *
 * Identity is for attribution only: writes still run as the spaces account (MISO_SPACES_EMAIL)
 * and row-level security does not see the caller.
 */

export const CALLER_EMAIL_ENV = 'MISO_CALLER_EMAIL'
export const CALLER_ID_ENV = 'MISO_CALLER_ID'

function read(key: string): string | null {
  const value = process.env[key]
  return value ? value : null
}

export function callerEmail(): string | null {
  return read(CALLER_EMAIL_ENV)
}

export function callerId(): string | null {
  return read(CALLER_ID_ENV)
}

export function requireCaller(): { email: string; id: string } {
  const email = callerEmail()
  const id = callerId()
  if (!email || !id) throw new Error('This action needs a signed-in member')
  return { email, id }
}

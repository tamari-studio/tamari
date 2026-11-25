// Test helper: the @miso/caller functions as space code sees them. The real package from the
// spaces checkout when it has one; otherwise a mirror of it, so these tests also run against
// spaces that predate the package.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '../lib/roots'
import { CALLER_EMAIL_ENV, CALLER_ID_ENV } from './caller'

/** packages/caller/index.ts in the spaces checkout, or null when this checkout has none. */
export function callerPackagePath(): string | null {
  try {
    const path = join(APP_ROOT, 'packages', 'caller', 'index.ts')
    return existsSync(path) ? path : null
  } catch {
    return null
  }
}

export type CallerModule = {
  CALLER_EMAIL_ENV: string
  CALLER_ID_ENV: string
  callerEmail(): string | null
  callerId(): string | null
  requireCaller(): { email: string; id: string }
}

const read = (key: string) => process.env[key] || null

export const callerMirror: CallerModule = {
  CALLER_EMAIL_ENV,
  CALLER_ID_ENV,
  callerEmail: () => read(CALLER_EMAIL_ENV),
  callerId: () => read(CALLER_ID_ENV),
  requireCaller() {
    const email = read(CALLER_EMAIL_ENV)
    const id = read(CALLER_ID_ENV)
    if (!email || !id) throw new Error('This action needs a signed-in member')
    return { email, id }
  }
}

export async function loadCaller(): Promise<CallerModule> {
  const path = callerPackagePath()
  return path ? ((await import(path)) as CallerModule) : callerMirror
}

import { InputError } from './connectors'

// Matches the check on miso.org_settings.name (migration 20261122000100_org_name).
export const ORG_NAME_MAX = 60

// The workspace name from PUT /api/settings/name: trimmed, and null (or only spaces) clears it.
export function parseOrgName(body: unknown): string | null {
  const { name } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (name === null) return null
  if (typeof name !== 'string') throw new InputError('Send a name, or null to clear it.')
  const trimmed = name.trim()
  if (!trimmed) return null
  // Control characters have no place in a name shown to everyone.
  if (trimmed.length > ORG_NAME_MAX || /[\u0000-\u001f\u007f]/.test(trimmed)) throw new InputError(`A workspace name is at most ${ORG_NAME_MAX} characters, on one line.`)
  return trimmed
}

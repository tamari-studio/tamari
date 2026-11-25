// Invites (miso.invitations, read by the sign-up trigger app.app_user_bootstrap): an admin or owner
// invites an email address at a role; when that person signs up they land active at it. Open
// invites expire after 14 days. Nothing is emailed: the page hands the admin a link to send.
import type { MemberTier } from '../lib/types'
import { TIER_ORDER } from '../vendor/dto-core/tier'
import { InputError } from './connectors'

// Loose on purpose: the sign-in proves the address, this only catches typos.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function parseInvite(input: unknown, assignable: readonly MemberTier[]): { email: string; tier: MemberTier } {
  const { email, tier } = (input ?? {}) as { email?: unknown; tier?: unknown }
  const address = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (address.length > 320 || !EMAIL.test(address)) throw new InputError('Type an email address, like jane@example.com.')
  if (typeof tier !== 'string' || !(TIER_ORDER as readonly string[]).includes(tier)) throw new InputError('Pick a role for them.')
  if (!assignable.includes(tier as MemberTier)) throw new InputError('Only an owner can invite an owner.')
  return { email: address, tier: tier as MemberTier }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parseInviteId(input: unknown): string {
  if (typeof input !== 'string' || !UUID.test(input)) throw new InputError('There is no such invite.')
  return input
}

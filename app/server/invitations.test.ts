import { expect, test } from 'bun:test'

import { InputError } from './connectors'
import { parseInvite, parseInviteId } from './invitations'

const ADMIN_TIERS = ['admin', 'manager', 'member'] as const
const OWNER_TIERS = ['owner', 'admin', 'manager', 'member'] as const

test('an address is trimmed and lower-cased, any domain', () => {
  expect(parseInvite({ email: '  Jane.Doe@Gmail.COM ', tier: 'manager' }, ADMIN_TIERS)).toEqual({ email: 'jane.doe@gmail.com', tier: 'manager' })
})

test('anything that is not an address is refused', () => {
  for (const email of [undefined, 42, '', 'jane', 'jane@', '@acme.com', 'jane@acme', 'ja ne@acme.com', `${'a'.repeat(320)}@acme.com`]) {
    expect(() => parseInvite({ email, tier: 'member' }, ADMIN_TIERS)).toThrow(InputError)
  }
  expect(() => parseInvite(null, ADMIN_TIERS)).toThrow(InputError)
})

test('the role must be a real one the inviter may grant', () => {
  expect(() => parseInvite({ email: 'j@acme.com' }, ADMIN_TIERS)).toThrow('Pick a role')
  expect(() => parseInvite({ email: 'j@acme.com', tier: 'god' }, OWNER_TIERS)).toThrow('Pick a role')
  expect(() => parseInvite({ email: 'j@acme.com', tier: 'owner' }, ADMIN_TIERS)).toThrow('Only an owner')
  expect(parseInvite({ email: 'j@acme.com', tier: 'owner' }, OWNER_TIERS).tier).toBe('owner')
})

test('an invite id is a uuid', () => {
  expect(parseInviteId('3f2c1a9e-1b2c-4d5e-8f90-0123456789ab')).toBe('3f2c1a9e-1b2c-4d5e-8f90-0123456789ab')
  for (const id of [undefined, '', '1', 'x;drop']) expect(() => parseInviteId(id)).toThrow(InputError)
})

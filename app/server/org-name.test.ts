import { expect, test } from 'bun:test'
import { InputError } from './connectors'
import { ORG_NAME_MAX, parseOrgName } from './org-name'

test('a workspace name is trimmed, and null or blank clears it', () => {
  expect(parseOrgName({ name: '  Acme  ' })).toBe('Acme')
  expect(parseOrgName({ name: 'x'.repeat(ORG_NAME_MAX) })).toBe('x'.repeat(ORG_NAME_MAX))
  expect(parseOrgName({ name: null })).toBeNull()
  expect(parseOrgName({ name: '' })).toBeNull()
  expect(parseOrgName({ name: '   ' })).toBeNull()
})

test('anything else is refused', () => {
  for (const body of [{}, { name: 5 }, { name: ['a'] }, null, 'Acme', { name: 'x'.repeat(ORG_NAME_MAX + 1) }, { name: 'a\nb' }]) {
    expect(() => parseOrgName(body)).toThrow(InputError)
  }
})

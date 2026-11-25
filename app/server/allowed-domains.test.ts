import { expect, test } from 'bun:test'

import { normalizeDomain, parseDomain } from './allowed-domains'
import { InputError } from './connectors'

test('a domain is trimmed, lowercased and loses a leading @', () => {
  expect(parseDomain('  @Acme.COM ')).toBe('acme.com')
  expect(parseDomain('mail.acme.co.uk')).toBe('mail.acme.co.uk')
  expect(parseDomain('xn--bcher-kva.de')).toBe('xn--bcher-kva.de')
})

test('anything that is not a hostname with a dot is refused', () => {
  const long = `${'a'.repeat(60)}.`.repeat(5) + 'com'
  for (const input of [undefined, null, 42, '', 'acme', 'acme.', '.acme.com', 'acme..com', 'jane@acme.com', 'ac me.com', '-acme.com', 'acme.c0m.1', long]) {
    expect(() => parseDomain(input)).toThrow(InputError)
  }
})

test('public mail providers are refused, however they are typed', () => {
  for (const domain of ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com', 'aol.com']) {
    expect(() => parseDomain(domain)).toThrow('would let anyone in')
  }
  expect(() => parseDomain(' @Gmail.COM ')).toThrow('would let anyone in')
})

test('normalizeDomain checks the format only, so a public domain listed earlier can be removed', () => {
  expect(normalizeDomain('@Gmail.com')).toBe('gmail.com')
  expect(() => normalizeDomain('nope')).toThrow(InputError)
})

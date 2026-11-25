// The checker's offline rules.
import { describe, expect, test } from 'bun:test'

import { checkSyntax, verdictFor, verdictForSyntaxFailure } from './_bounce-core'
import { DISPOSABLE_DOMAINS, ROLE_PREFIXES } from './_bounce-lists'

const okSyntax = (raw: string) => {
  const r = checkSyntax(raw)
  if (!r.ok) throw new Error(`expected ${raw} to pass: ${r.detail}`)
  return r
}

describe('the vendored lists', () => {
  test('are loaded, lowercase, without comments', () => {
    expect(DISPOSABLE_DOMAINS.size).toBeGreaterThan(8000)
    expect(DISPOSABLE_DOMAINS.has('mailinator.com')).toBe(true)
    expect(ROLE_PREFIXES.has('info')).toBe(true)
    for (const entry of [...DISPOSABLE_DOMAINS, ...ROLE_PREFIXES]) {
      expect(entry).toBe(entry.toLowerCase())
      expect(entry.startsWith('#')).toBe(false)
    }
  })
})

describe('checkSyntax', () => {
  test.each(['jo@example.org', 'Ana.Silva@acme-fund.example', 'kim@example.com', "o'brien+news@example.ie", 'jørgen@søster.example', 'रमेश@example.in'])(
    'accepts %s',
    address => {
      expect(checkSyntax(address).ok).toBe(true)
    }
  )

  test.each(['', '   ', 'not-an-email', 'eve@@double.com', '@nolocal.com', 'nodomain@', 'a b@c.com', '"quoted"@x.com', 'x@localhost', 'x@example.com.', 'x@1.2.3.4', 'x@-bad.com', 'x@a..com', `${'a'.repeat(65)}@x.com`])(
    'refuses %p as invalid_syntax',
    address => {
      const r = checkSyntax(address)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('invalid_syntax')
    }
  )

  test('refuses reserved TLDs', () => {
    expect(checkSyntax('info@nonexistentzzz9.invalid').ok).toBe(false)
    expect(checkSyntax('a@b.test').ok).toBe(false)
  })

  test('lowercases the domain, keeps the local part, trims', () => {
    expect(okSyntax('Alice.Andersen@Example.COM').normalized).toBe('Alice.Andersen@example.com')
    expect(okSyntax('  bo@bvv.de  ').normalized).toBe('bo@bvv.de')
  })

  test('looks up an internationalised domain in its xn-- form', () => {
    const r = okSyntax('jørgen@søster.example')
    expect(r.asciiDomain).toBe('xn--sster-vua.example')
    expect(r.normalized).toBe('jørgen@søster.example')
  })

  test('throwaway domains are refused as disposable, whatever the case', () => {
    for (const address of ['someone@mailinator.com', 'someone@MAILINATOR.COM']) {
      const r = checkSyntax(address)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('disposable')
    }
  })

  test.each(['info', 'INFO', 'kontakt', 'no-reply', 'presse'])('flags %s@ as a shared inbox', local => {
    expect(okSyntax(`${local}@example.com`).isRole).toBe(true)
  })

  test.each(['administration', 'mailbox', 'information', 'salesforce'])('does not flag %s@: exact matches only', local => {
    expect(okSyntax(`${local}@example.com`).isRole).toBe(false)
  })

  test('a named person is not a shared inbox', () => {
    expect(okSyntax('ana.silva@acme-fund.example').isRole).toBe(false)
  })
})

describe('verdicts', () => {
  const mx = { ok: true as const, hosts: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'], source: 'mx' as const }

  test('a clean address with a mail server is ok, with the preferred host', () => {
    expect(verdictFor(okSyntax('jo@example.org'), mx)).toEqual({
      email_normalized: 'jo@example.org',
      verdict: 'ok',
      reason_code: '',
      mx_host: 'aspmx.l.google.com'
    })
  })

  test('a shared inbox is review', () => {
    expect(verdictFor(okSyntax('info@example.org'), mx)).toMatchObject({ verdict: 'review', reason_code: 'role_account' })
  })

  test('a dead domain is skip, a failed lookup is review', () => {
    for (const reason of ['domain_not_found', 'no_mail_server', 'null_mx'] as const) {
      expect(verdictFor(okSyntax('a@b.com'), { ok: false, reason, detail: '' })).toMatchObject({ verdict: 'skip', reason_code: reason, mx_host: '' })
    }
    expect(verdictFor(okSyntax('a@b.com'), { ok: false, reason: 'dns_error', detail: '' })).toMatchObject({ verdict: 'review', reason_code: 'dns_error' })
  })

  test('a syntax failure is skip with its reason', () => {
    const bad = checkSyntax('someone@mailinator.com')
    if (bad.ok) throw new Error('expected a failure')
    expect(verdictForSyntaxFailure(bad)).toEqual({
      email_normalized: 'someone@mailinator.com',
      verdict: 'skip',
      reason_code: 'disposable',
      mx_host: ''
    })
  })
})

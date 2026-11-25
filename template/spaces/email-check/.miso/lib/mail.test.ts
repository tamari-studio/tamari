import { describe, expect, test } from 'bun:test'

import { REASON } from './contacts'
import { isDomainName, type MxResult } from './dns'
import { SHARED_INBOXES, THROWAWAY_DOMAINS, checkAddress, isThrowaway, verdictFor } from './mail'

const ok = (address: string) => {
  const checked = checkAddress(address)
  if (checked.kind !== 'ok') throw new Error(`${address} was ${checked.kind}`)
  return checked
}
const detail = (address: string) => {
  const checked = checkAddress(address)
  return checked.kind === 'invalid' ? checked.detail : checked.kind
}

describe('checkAddress: the form of an address', () => {
  test('a good address is kept as typed, with the domain in lower case', () => {
    expect(ok('  Ida.Larsen+news@Example.ORG ')).toEqual({ kind: 'ok', email: 'Ida.Larsen+news@example.org', local: 'Ida.Larsen+news', domain: 'example.org', asciiDomain: 'example.org', shared: false })
    expect(ok('o\'brien@sub.example.co.uk').domain).toBe('sub.example.co.uk')
    expect(ok("!#$%&'*+/=?^_`{|}~-@example.org").local).toBe("!#$%&'*+/=?^_`{|}~-")
  })

  test('an address that is not written right is refused, with the reason in words', () => {
    expect(detail('')).toBe('it is empty')
    expect(detail('   ')).toBe('it is empty')
    for (const bad of ['ida', 'ida@', '@example.org', 'ida@@example.org', 'a@b@example.org']) expect(['needs one @ with text on both sides', 'more than one @']).toContain(detail(bad))
    expect(detail('ida@@example.org')).toBe('more than one @')
    expect(detail('a b@example.org')).toBe('the part before the @ has characters an address cannot have')
    expect(detail('.ida@example.org')).toContain('the part before the @')
    expect(detail('ida.@example.org')).toContain('the part before the @')
    expect(detail('i..da@example.org')).toContain('the part before the @')
    expect(detail('"ida larsen"@example.org')).toContain('the part before the @')
    expect(detail('ida@example')).toBe('the domain has no dot')
    expect(detail('ida@example.org.')).toBe('the domain ends with a dot')
    expect(detail('ida@-example.org')).toBe('the domain is not valid')
    expect(detail('ida@example-.org')).toBe('the domain is not valid')
    expect(detail('ida@exa..mple.org')).toBe('the domain is not valid')
    expect(detail('ida@.org')).toBe('the domain is not valid')
    expect(detail(`ida@${'a'.repeat(64)}.org`)).toBe('the domain is not valid')
    expect(detail('ida@example.c')).toBe('the domain does not end in a real ending, like .com')
    expect(detail('ida@example.c0m')).toBe('the domain does not end in a real ending, like .com')
  })

  test('an IP address or an ending that never takes mail is refused', () => {
    for (const bad of ['ida@1.2.3.4', 'ida@127.1', 'ida@example.123']) expect(detail(bad)).toBe('the domain is an IP address or ends in a number')
    expect(detail('ida@[1.2.3.4]')).toBe('the domain has characters it cannot have')
    for (const ending of ['test', 'local', 'localhost', 'invalid', 'onion', 'internal', 'alt']) expect(detail(`ida@host.${ending}`)).toBe(`.${ending} addresses never receive mail`)
    expect(detail('ida@home.arpa')).toBe('.arpa addresses never receive mail')
  })

  test('nothing that a URL would read as more than a name gets past the form', () => {
    for (const bad of ['ida@example.org/path', 'ida@example.org:25', 'ida@example.org?x=1', 'ida@example.org#x', 'ida@exa%6dple.org', 'ida@example.org\\evil.com', 'ida@user:pw@example.org', 'ida@exa_mple.org', 'ida@exa mple.org', 'ida@example.org\n', 'ida@exam​ple.org', 'ida@😀.org']) {
      const checked = checkAddress(bad)
      // A trailing line break is trimmed, so that one is fine; the others are refused.
      if (bad.endsWith('\n')) expect(checked.kind).toBe('ok')
      else expect({ bad, kind: checked.kind }).toEqual({ bad, kind: 'invalid' })
    }
  })

  test('very long input is refused, and a huge string is never read', () => {
    const local = 'a'.repeat(64)
    // 64 + @ + 189 = 254 characters: the longest address there is.
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`
    expect(`${local}@${domain}`).toHaveLength(254)
    expect(checkAddress(`${local}@${domain}`).kind).toBe('ok')
    expect(detail(`${local}x@${domain}`)).toBe('longer than 254 characters')
    expect(detail(`${'a'.repeat(300)}@example.org`)).toBe('longer than 254 characters')
    expect(detail(`${'a'.repeat(65)}@example.org`)).toBe('the part before the @ is longer than 64 characters')
    const huge = `${'a'.repeat(5_000_000)}@example.org`
    const started = performance.now()
    expect(detail(huge)).toBe('longer than 254 characters')
    expect(performance.now() - started).toBeLessThan(200)
    // White space may pad a good address, but not past the limit that is read.
    expect(checkAddress(`${' '.repeat(900)}ida@example.org`).kind).toBe('ok')
    expect(detail(`${' '.repeat(1100)}ida@example.org`)).toBe('longer than 254 characters')
  })

  test('anything that is not text is refused, never thrown on', () => {
    for (const value of [undefined, null, 42, {}, [], ['a@example.org'], true, Symbol.iterator]) expect(checkAddress(value)).toEqual({ kind: 'invalid', detail: 'it is not text' })
  })

  test('unicode: letters of any alphabet are fine, and the domain gets its xn-- form for the lookup', () => {
    const german = ok('jürgen@münchen.example')
    expect(german.email).toBe('jürgen@münchen.example')
    expect(german.asciiDomain).toBe('xn--mnchen-3ya.example')
    const russian = ok('тест@пример.рф')
    expect(russian.asciiDomain).toBe('xn--e1afmkfd.xn--p1ai')
    // The same letter, written as one character or as a letter and a mark, is the same address.
    expect(ok('réné@example.org').email).toBe('réné@example.org')
    expect(ok('IDA@MÜNCHEN.example').domain).toBe('münchen.example')
  })
})

describe('checkAddress: throwaway domains and shared inboxes', () => {
  test('the list is about forty well-known services, all real domain names', () => {
    expect(THROWAWAY_DOMAINS.size).toBeGreaterThanOrEqual(40)
    expect(THROWAWAY_DOMAINS.size).toBeLessThanOrEqual(60)
    for (const domain of THROWAWAY_DOMAINS) expect({ domain, name: isDomainName(domain) }).toEqual({ domain, name: true })
  })

  test('a throwaway domain is found, in any capitals and under any sub-domain, but a look-alike is not', () => {
    expect(checkAddress('x@mailinator.com')).toEqual({ kind: 'throwaway', email: 'x@mailinator.com', domain: 'mailinator.com' })
    expect(checkAddress('X@MAILINATOR.COM').kind).toBe('throwaway')
    expect(checkAddress('x@inbox.guerrillamail.net').kind).toBe('throwaway')
    expect(checkAddress('x@notmailinator.com').kind).toBe('ok')
    expect(checkAddress('x@mailinator.com.example.org').kind).toBe('ok')
    expect(isThrowaway('yopmail.com')).toBe(true)
    expect(isThrowaway('com')).toBe(false)
  })

  test('a shared inbox is flagged on the exact name only, in any capitals', () => {
    for (const name of ['info', 'Sales', 'SUPPORT', 'admin', 'contact', 'hello', 'office', 'team']) expect({ name, shared: ok(`${name}@example.org`).shared }).toEqual({ name, shared: true })
    for (const name of ['administration', 'info.ida', 'ida', 'infos', 'team-ida']) expect({ name, shared: ok(`${name}@example.org`).shared }).toEqual({ name, shared: false })
    expect(SHARED_INBOXES.has('info')).toBe(true)
  })
})

describe('verdictFor', () => {
  const found: MxResult = { ok: true, hosts: ['mx1.example.org', 'mx2.example.org'], source: 'mx' }
  const failed = (reason: Extract<MxResult, { ok: false }>['reason']): MxResult => ({ ok: false, reason, detail: 'x' })

  test('a written-wrong address and a throwaway domain are "don\'t send" without any lookup', () => {
    expect(verdictFor(checkAddress('ida@@example.org'), null)).toEqual({ verdict: 'skip', reason: 'Not a valid address: more than one @', mxHost: '' })
    expect(verdictFor(checkAddress('x@mailinator.com'), null)).toEqual({ verdict: 'skip', reason: REASON.throwaway, mxHost: '' })
  })

  test('a domain with a mail server is good, and its first host is kept', () => {
    expect(verdictFor(checkAddress('ida@example.org'), found)).toEqual({ verdict: 'ok', reason: REASON.ok, mxHost: 'mx1.example.org' })
    expect(verdictFor(checkAddress('ida@example.org'), { ok: true, hosts: ['example.org'], source: 'a_fallback' }).verdict).toBe('ok')
  })

  test('a shared inbox on a working domain is "check first"', () => {
    expect(verdictFor(checkAddress('info@example.org'), found)).toEqual({ verdict: 'review', reason: REASON.shared, mxHost: 'mx1.example.org' })
  })

  test('a domain that takes no mail is "don\'t send", also for a shared inbox', () => {
    for (const address of ['ida@example.org', 'info@example.org']) {
      expect(verdictFor(checkAddress(address), failed('domain_not_found'))).toEqual({ verdict: 'skip', reason: REASON.notFound, mxHost: '' })
      expect(verdictFor(checkAddress(address), failed('no_mail_server'))).toEqual({ verdict: 'skip', reason: REASON.noServer, mxHost: '' })
      expect(verdictFor(checkAddress(address), failed('null_mx'))).toEqual({ verdict: 'skip', reason: REASON.nullMx, mxHost: '' })
    }
  })

  test('a lookup that failed on our side is "check first", never "don\'t send"', () => {
    expect(verdictFor(checkAddress('ida@example.org'), failed('dns_error'))).toEqual({ verdict: 'review', reason: REASON.lookupFailed, mxHost: '' })
  })

  test('an address that needs a lookup cannot get a verdict without one', () => {
    expect(() => verdictFor(checkAddress('ida@example.org'), null)).toThrow('needs a lookup')
  })
})

describe('no mail server is ever contacted', () => {
  test('the files that look things up use no socket, no SMTP and no other module', async () => {
    for (const file of ['./dns.ts', './mail.ts']) {
      const source = await Bun.file(new URL(file, import.meta.url)).text()
      const code = source.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, '$1')
      expect({ file, hit: /node:|Bun\.(connect|listen)|\bsmtp\b|\bnet\.|\bsocket/i.exec(code)?.[0] ?? null }).toEqual({ file, hit: null })
    }
  })
})

// The email checker's rules. Pure: no DNS, no I/O. bouncer.server.ts adds the domain lookup
// (_dns.ts); every rule here has a test in _bounce-core.test.ts.
//
// Order matters: syntax first (a malformed address has no
// domain worth looking up), then the throwaway-domain list (a hard skip), then
// the mail-server lookup, then the shared-inbox flag. Nothing ever talks to a
// mail server: there is no SMTP probe, so "ok" means "deliverable as far as the
// address and its domain can tell", never "this mailbox exists".
import { domainToASCII } from 'node:url'

import { DISPOSABLE_DOMAINS, ROLE_PREFIXES } from './_bounce-lists'
import type { EmailVerdict } from './_bounce-shared'
import type { MxResult } from './_dns'

export type SyntaxResult =
  | { ok: true; normalized: string; local: string; domain: string; asciiDomain: string; isRole: boolean }
  | { ok: false; normalized: string; reason: 'invalid_syntax' | 'disposable'; detail: string; asciiDomain?: string }

// RFC 5322 atext, plus any Unicode letter, combining mark or digit (internationalised addresses,
// which email-validator accepts by default). Quoted local parts are refused, as
// email-validator does unless told otherwise: nobody sends to "john doe"@x.com.
const ATOM = String.raw`[\p{L}\p{M}\p{N}!#$%&'*+/=?^_\x60{|}~-]+`
const LOCAL_PART = new RegExp(`^${ATOM}(\\.${ATOM})*$`, 'u')
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

// Special-use names (RFC 6761 and friends) that never receive mail, which
// email-validator refuses too.
const SPECIAL_USE = new Set(['arpa', 'invalid', 'local', 'localhost', 'onion', 'test', 'internal', 'alt'])

/** Anything longer than this is refused unread: an address is at most 254 characters, and white space may pad it. */
const MAX_INPUT_CHARS = 1000

function bad(detail: string): SyntaxResult {
  return { ok: false, normalized: '', reason: 'invalid_syntax', detail }
}

/** Syntax, the throwaway-domain list and the shared-inbox flag for one address. Offline. */
export function checkSyntax(raw: string): SyntaxResult {
  // The check on the length comes first so a huge string is never trimmed or normalised.
  if (typeof raw === 'string' && raw.length > MAX_INPUT_CHARS) return bad('longer than 254 characters')
  const text = (raw ?? '').trim().normalize('NFC')
  if (!text) return bad('empty')
  if (text.length > 254) return bad('longer than 254 characters')

  const at = text.lastIndexOf('@')
  if (at <= 0 || at === text.length - 1) return bad('needs one @ with text on both sides')
  const local = text.slice(0, at)
  const domainInput = text.slice(at + 1)
  if (local.includes('@')) return bad('more than one @')
  if (local.length > 64) return bad('the part before @ is longer than 64 characters')
  if (!LOCAL_PART.test(local)) return bad('the part before @ has characters an address cannot have')

  // The domain as typed, lowercased (domains are case-insensitive), and its
  // xn-- form for the lookup. domainToASCII returns '' for an invalid host name.
  if (domainInput.endsWith('.')) return bad('the domain ends with a dot')
  const domain = domainInput.toLowerCase()
  const asciiDomain = domainToASCII(domain)
  if (!asciiDomain || asciiDomain.length > 253) return bad('the domain is not valid')
  const labels = asciiDomain.split('.')
  if (labels.length < 2) return bad('the domain has no dot')
  if (!labels.every(label => LABEL.test(label))) return bad('the domain is not valid')
  const tld = labels[labels.length - 1]!
  if (/^\d+$/.test(tld)) return bad('the domain is an IP address or ends in a number')
  if (SPECIAL_USE.has(tld) || asciiDomain === 'home.arpa') return bad(`.${tld} addresses never receive mail`)

  const normalized = `${local}@${domain}`

  if (DISPOSABLE_DOMAINS.has(asciiDomain) || DISPOSABLE_DOMAINS.has(domain)) {
    return { ok: false, normalized, reason: 'disposable', detail: `${domain} is a throwaway-mail domain`, asciiDomain }
  }

  return { ok: true, normalized, local, domain, asciiDomain, isRole: ROLE_PREFIXES.has(local.toLowerCase()) }
}

/**
 * The verdict for an address that passed checkSyntax, given what DNS said about
 * its domain. A lookup that failed on our side (dns_error) is "review", not
 * "skip": it says nothing about the address, and treating it as a skip would
 * silently lose good leads.
 */
export function verdictFor(syntax: Extract<SyntaxResult, { ok: true }>, mx: MxResult): EmailVerdict {
  if (!mx.ok) {
    return {
      email_normalized: syntax.normalized,
      verdict: mx.reason === 'dns_error' ? 'review' : 'skip',
      reason_code: mx.reason,
      mx_host: ''
    }
  }
  return {
    email_normalized: syntax.normalized,
    verdict: syntax.isRole ? 'review' : 'ok',
    reason_code: syntax.isRole ? 'role_account' : '',
    mx_host: mx.hosts[0] ?? ''
  }
}

/** The verdict for an address that failed checkSyntax: always a skip. */
export function verdictForSyntaxFailure(syntax: Extract<SyntaxResult, { ok: false }>): EmailVerdict {
  return { email_normalized: syntax.normalized, verdict: 'skip', reason_code: syntax.reason, mx_host: '' }
}

// The rules for one address. Pure: no lookups and no data access, so every rule has a test.
//
// The order matters. First the address is read (a badly written one has no domain worth looking
// up), then the throwaway-domain list (a certain "don't send", also without a lookup), then, in
// dns.ts, whether the domain has a mail server, and last the shared-inbox flag. Nothing here ever
// talks to a mail server, so "good to send" means "written correctly, and the domain takes mail".
// It never means "this mailbox exists".
import { REASON, invalidReason, type Verdict } from './contacts'
import type { MxResult } from './dns'

export type Checked =
  | { kind: 'invalid'; detail: string }
  | { kind: 'throwaway'; email: string; domain: string }
  | { kind: 'ok'; email: string; local: string; domain: string; asciiDomain: string; shared: boolean }

/** Well-known throwaway-mail services. A short list: it catches the common ones, not all of them. */
export const THROWAWAY_DOMAINS: ReadonlySet<string> = new Set([
  '10minutemail.com',
  '10minutemail.net',
  'burnermail.io',
  'dispostable.com',
  'discard.email',
  'emailondeck.com',
  'emailfake.com',
  'fakeinbox.com',
  'fakemail.net',
  'getairmail.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamail.org',
  'harakirimail.com',
  'inboxkitten.com',
  'jetable.org',
  'maildrop.cc',
  'mailcatch.com',
  'mailforspam.com',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spam4.me',
  'spambox.us',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempinbox.com',
  'tempmail.com',
  'tempmailo.com',
  'throwawaymail.com',
  'tmpmail.net',
  'tmpmail.org',
  'trashmail.com',
  'trashmail.net',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net'
])

/** Local parts that go to a shared mailbox. Matched exactly, so "administration@" is not "admin@". */
export const SHARED_INBOXES: ReadonlySet<string> = new Set([
  'abuse',
  'accounts',
  'admin',
  'billing',
  'booking',
  'bookings',
  'contact',
  'enquiries',
  'finance',
  'help',
  'hello',
  'hi',
  'hr',
  'info',
  'jobs',
  'legal',
  'mail',
  'marketing',
  'office',
  'orders',
  'postmaster',
  'press',
  'reception',
  'sales',
  'security',
  'service',
  'support',
  'team',
  'webmaster'
])

// RFC 5322 atext, plus any Unicode letter, mark or digit (internationalised addresses). A quoted
// local part is refused: nobody sends to "john doe"@x.com.
const ATOM = String.raw`[\p{L}\p{M}\p{N}!#$%&'*+/=?^_\x60{|}~-]+`
const LOCAL_PART = new RegExp(`^${ATOM}(\\.${ATOM})*$`, 'u')
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const DOMAIN_CHARS = /^[\p{L}\p{M}\p{N}.-]+$/u
// A real ending is letters (or xn-- for a non-Latin one). A number at the end means an IP address.
const ENDING = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/
// Names that never receive mail (RFC 6761 and friends).
const SPECIAL_USE = new Set(['arpa', 'invalid', 'local', 'localhost', 'onion', 'test', 'internal', 'alt'])

/** Anything longer is refused unread: an address has 254 characters at most, and white space may pad it. */
const MAX_INPUT = 1000

const invalid = (detail: string): Checked => ({ kind: 'invalid', detail })

/** The xn-- form of a domain name, or '' when it is not a host name. Only called with letters, digits, dots and hyphens. */
function toAscii(domain: string): string {
  try {
    return new URL(`http://${domain}`).hostname
  } catch {
    return ''
  }
}

/** True for a listed domain and for any name under one (`x.mailinator.com`). */
export function isThrowaway(asciiDomain: string): boolean {
  const labels = asciiDomain.split('.')
  for (let i = 0; i < labels.length - 1; i++) if (THROWAWAY_DOMAINS.has(labels.slice(i).join('.'))) return true
  return false
}

/** Reads one address: the form, the throwaway list and the shared-inbox flag. Offline. */
export function checkAddress(raw: unknown): Checked {
  if (typeof raw !== 'string') return invalid('it is not text')
  // The length comes first, so a huge string is never trimmed or normalised.
  if (raw.length > MAX_INPUT) return invalid('longer than 254 characters')
  const address = raw.trim().normalize('NFC')
  if (!address) return invalid('it is empty')
  if (address.length > 254) return invalid('longer than 254 characters')

  const at = address.lastIndexOf('@')
  if (at <= 0 || at === address.length - 1) return invalid('needs one @ with text on both sides')
  const local = address.slice(0, at)
  const domainInput = address.slice(at + 1)
  if (local.includes('@')) return invalid('more than one @')
  if (local.length > 64) return invalid('the part before the @ is longer than 64 characters')
  if (!LOCAL_PART.test(local)) return invalid('the part before the @ has characters an address cannot have')

  if (domainInput.endsWith('.')) return invalid('the domain ends with a dot')
  // Only these characters get as far as the URL reader, which would decode % and read : / ? # @ as more than a name.
  if (!DOMAIN_CHARS.test(domainInput)) return invalid('the domain has characters it cannot have')
  const domain = domainInput.toLowerCase()
  if (/\.\d+$/.test(domain)) return invalid('the domain is an IP address or ends in a number')
  const asciiDomain = toAscii(domain)
  if (!asciiDomain || asciiDomain.length > 253) return invalid('the domain is not valid')
  const labels = asciiDomain.split('.')
  if (labels.length < 2) return invalid('the domain has no dot')
  if (!labels.every(label => LABEL.test(label))) return invalid('the domain is not valid')
  const ending = labels[labels.length - 1]!
  if (!ENDING.test(ending)) return invalid('the domain does not end in a real ending, like .com')
  if (SPECIAL_USE.has(ending) || asciiDomain === 'home.arpa') return invalid(`.${ending} addresses never receive mail`)

  const email = `${local}@${domain}`
  if (isThrowaway(asciiDomain)) return { kind: 'throwaway', email, domain }
  return { kind: 'ok', email, local, domain, asciiDomain, shared: SHARED_INBOXES.has(local.toLowerCase()) }
}

export type Outcome = { verdict: Exclude<Verdict, 'unchecked'>; reason: string; mxHost: string }

/**
 * The verdict for an address that was read, given what DNS said about its domain (`mx` is only
 * needed for an address that got past `checkAddress`). A lookup that failed on our side is "check
 * first", not "don't send": it says nothing about the address, and a "don't send" would lose a
 * good contact.
 */
export function verdictFor(checked: Checked, mx: MxResult | null): Outcome {
  if (checked.kind === 'invalid') return { verdict: 'skip', reason: invalidReason(checked.detail), mxHost: '' }
  if (checked.kind === 'throwaway') return { verdict: 'skip', reason: REASON.throwaway, mxHost: '' }
  if (!mx) throw new Error('The domain needs a lookup first.')
  if (!mx.ok) {
    if (mx.reason === 'dns_error') return { verdict: 'review', reason: REASON.lookupFailed, mxHost: '' }
    const reason = mx.reason === 'domain_not_found' ? REASON.notFound : mx.reason === 'null_mx' ? REASON.nullMx : REASON.noServer
    return { verdict: 'skip', reason, mxHost: '' }
  }
  const mxHost = mx.hosts[0] ?? ''
  return checked.shared ? { verdict: 'review', reason: REASON.shared, mxHost } : { verdict: 'ok', reason: REASON.ok, mxHost }
}

// The contact list: what a contact holds, the check every row goes through, the numbers the page
// and the widget show, the words for each verdict, and how pasted text becomes addresses. No data
// access here (that is contacts.server.ts) and no lookups (that is dns.ts), so the view can import it.
import { choice, day, fields, rowKey, text } from './check'
import { MAX_ROWS } from './rows'

export const VERDICTS = ['unchecked', 'ok', 'review', 'skip'] as const
export type Verdict = (typeof VERDICTS)[number]

export const VERDICT_LABEL: Record<Verdict, string> = { unchecked: 'Not checked', ok: 'Good to send', review: 'Check first', skip: "Don't send" }

/** The reason shown next to a verdict, in plain words. mail.ts picks one; the examples use the same ones. */
export const REASON = {
  ok: 'The domain has a mail server',
  throwaway: 'Throwaway mail domain',
  shared: 'Shared inbox, like info@ or sales@',
  notFound: "The domain doesn't exist",
  noServer: 'The domain has no mail server',
  nullMx: 'The domain says it takes no mail',
  lookupFailed: "Couldn't look up the domain. Check again later"
} as const

export const invalidReason = (detail: string) => `Not a valid address: ${detail}`

/** Addresses in one paste. */
export const MAX_PER_ADD = 200
/** Contacts in one check. A check is one server call, which has a time limit. */
export const MAX_PER_CHECK = 100
/** Contacts in the list. The shared-records list (lib/rows.ts) reads this many and no more. */
export const MAX_CONTACTS = MAX_ROWS
/** An address is 254 characters at most. */
export const MAX_ADDRESS = 254
/** Pasted text: room for MAX_PER_ADD addresses of full length and what separates them. */
export const MAX_TEXT = 60_000

export type Contact = {
  email: string
  /** Who it is, when known. */
  name: string
  note: string
  verdict: Verdict
  /** Why the verdict is what it is, in a short sentence. */
  reason: string
  /** The mail server that takes the domain's mail, when one was found. */
  mxHost: string
  /** The day of the last check, YYYY-MM-DD, or ''. */
  checkedAt: string
}

/** Shape checks only. Whether an address is good is mail.ts's job, so a row never drops out of the list for it. */
export function parseContact(input: unknown): Contact {
  const raw = fields(input)
  return {
    email: text(raw.email, 'Email address', { required: true, max: MAX_ADDRESS }),
    name: text(raw.name, 'Name', { max: 80 }),
    note: text(raw.note, 'Note', { max: 160 }),
    verdict: choice(raw.verdict ?? 'unchecked', 'Verdict', VERDICTS),
    reason: text(raw.reason, 'Reason', { max: 160 }),
    mxHost: text(raw.mxHost, 'Mail server', { max: 253 }),
    checkedAt: day(raw.checkedAt, 'Checked on')
  }
}

export type Asked = { addresses: string[]; ignored: number }

const WRAPPERS = /^[<("'[]+|[>)"'\],]+$/g

/**
 * The addresses in pasted text: pieces separated by white space, commas or semicolons, that have an
 * @. Pieces without one (a name, a heading) and pieces longer than an address can be are counted as
 * `ignored`. The same address twice counts once. Throws for text that is too long or has more than
 * MAX_PER_ADD addresses, before anything is looked at.
 */
export function parseAddresses(input: unknown): Asked {
  if (typeof input !== 'string') throw new Error('Paste the addresses as text.')
  if (input.length > MAX_TEXT) throw new Error(`That is too much text. Add ${MAX_PER_ADD} addresses at most at a time.`)
  const seen = new Set<string>()
  const addresses: string[] = []
  let ignored = 0
  for (const piece of input.split(/[\s,;]+/)) {
    const token = piece.replace(WRAPPERS, '').replace(/^mailto:/i, '')
    if (!token) continue
    if (!token.includes('@') || token.length > MAX_ADDRESS) {
      ignored += 1
      continue
    }
    const id = token.normalize('NFC').toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)
    if (seen.size > MAX_PER_ADD) throw new Error(`That is more than ${MAX_PER_ADD} addresses. Add ${MAX_PER_ADD} at most at a time.`)
    addresses.push(token)
  }
  return { addresses, ignored }
}

/** The keys of contacts to check: a list of at most MAX_PER_CHECK, each a plain row key, none twice. */
export function parseKeys(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('That could not be read. Reload the page and try again.')
  if (input.length > MAX_PER_CHECK) throw new Error(`Check ${MAX_PER_CHECK} contacts at most at a time. You sent ${input.length}.`)
  return [...new Set(input.map(rowKey))]
}

/** The same address in any capitals is the same contact. */
export const sameAddress = (email: string) => email.normalize('NFC').toLowerCase()

/** The key of a contact, made from its address, so adding it twice, even at the same moment, writes one row. */
export async function contactKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sameAddress(email)))
  return `c-${[...new Uint8Array(digest).slice(0, 16)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export type Summary = { total: number; ok: number; review: number; skip: number; unchecked: number; checked: number; share: number | null }

/** `share` is the part of the checked contacts that are good to send, as a whole percent. It is null before anything is checked. */
export function summary(contacts: Pick<Contact, 'verdict'>[]): Summary {
  const count = { ok: 0, review: 0, skip: 0, unchecked: 0 }
  for (const contact of contacts) count[contact.verdict] += 1
  const checked = count.ok + count.review + count.skip
  return { total: contacts.length, ...count, checked, share: checked === 0 ? null : Math.round((count.ok / checked) * 100) }
}

/** By address, so the list stays where it is while checks change the rows. */
export function sortContacts<T extends Pick<Contact, 'email'>>(contacts: T[]): T[] {
  return [...contacts].sort((a, b) => a.email.localeCompare(b.email))
}

/** The addresses to copy into a mailing tool: only the good ones, one per line. */
export const goodAddresses = (contacts: Pick<Contact, 'email' | 'verdict'>[]): string[] => sortContacts(contacts.filter(c => c.verdict === 'ok')).map(c => c.email)

/**
 * Invented contacts, with the verdicts the checker would give them already filled in, so loading
 * them needs no lookup. None is left unchecked for the same reason.
 */
export function exampleContacts(today: string): Contact[] {
  const checked = (email: string, name: string, note: string, mxHost: string): Contact => ({ email, name, note, verdict: 'ok', reason: REASON.ok, mxHost, checkedAt: today })
  return [
    checked('ida.larsen@example.org', 'Ida Larsen', 'Met at the spring fair', 'mx1.example.org'),
    checked('oskar.brandt@acme.example', 'Oskar Brandt', 'Asked for the price list', 'mx.acme.example'),
    checked('maja.holm@example.net', 'Maja Holm', '', 'mail.example.net'),
    checked('lars.vik@harbour.example', 'Lars Vik', 'Customer since 2024', 'mx1.harbour.example'),
    checked('nora.berg@example.com', 'Nora Berg', '', 'mx.example.com'),
    { email: 'info@acme.example', name: 'Acme front desk', note: '', verdict: 'review', reason: REASON.shared, mxHost: 'mx.acme.example', checkedAt: today },
    { email: 'sales@harbour.example', name: '', note: 'From a business card', verdict: 'review', reason: REASON.shared, mxHost: 'mx1.harbour.example', checkedAt: today },
    { email: 'ola.tmp@mailinator.com', name: 'Ola', note: 'Signed up at the stand', verdict: 'skip', reason: REASON.throwaway, mxHost: '', checkedAt: today },
    { email: 'eva.lund@acme-mail.example', name: 'Eva Lund', note: 'Typed in by hand', verdict: 'skip', reason: REASON.notFound, mxHost: '', checkedAt: today },
    { email: 'jonas@@example.org', name: 'Jonas', note: '', verdict: 'skip', reason: invalidReason('more than one @'), mxHost: '', checkedAt: today }
  ]
}

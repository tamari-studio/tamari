// What one "add" and one "check" do to the list, with the list handed in (a shared-records
// collection on the server, a list in memory in the tests). contacts.ts has checked every argument
// before it gets here; the server file only wires them together.
import { MAX_CONTACTS, contactKey, invalidReason, parseContact, sameAddress, type Asked, type Contact } from './contacts'
import { lookupDomains, type ManyOptions } from './dns'
import { checkAddress, verdictFor } from './mail'
import type { Saved, Store } from './rows'

export type AddResult = {
  /** New contacts in the list. */
  added: number
  /** Of those, written wrongly: they are "don't send" from the start. */
  invalid: number
  /** Addresses that were in the list already. */
  duplicates: number
  /** Pieces of the text that were not addresses (no @, or too long). */
  ignored: number
}

export type CheckResult = {
  /** Contacts that got a verdict now. */
  checked: number
  /** Contacts the call ran out of time for. They stay unchecked. */
  left: number
  /** Keys that are not in the list (removed meanwhile). */
  missing: number
}

/** A store error is logged on the server, and the person gets a plain sentence (rows.ts does the same). */
async function saveAll(store: Store<Contact>, entries: { key: string; data: Contact }[]): Promise<void> {
  if (entries.length === 0) return
  try {
    await store.putMany(entries)
  } catch (err) {
    console.error('[starter template] save the contacts:', err)
    throw new Error('Could not save that. Try again; if it keeps happening, tell an admin.')
  }
}

/**
 * Adds the addresses that are not in `existing` yet. A badly written one is "don't send" at once;
 * the rest wait, unchecked, for a check. Refuses before it writes anything when the list would get
 * too long.
 */
export async function addAddresses(store: Store<Contact>, existing: Saved<Contact>[], asked: Asked, today: string): Promise<AddResult> {
  const known = new Set(existing.map(contact => sameAddress(contact.email)))
  const entries: { key: string; data: Contact }[] = []
  let invalid = 0
  let duplicates = 0
  for (const address of asked.addresses) {
    const checked = checkAddress(address)
    const email = checked.kind === 'invalid' ? address : checked.email
    if (known.has(sameAddress(email))) {
      duplicates += 1
      continue
    }
    known.add(sameAddress(email))
    if (checked.kind === 'invalid') invalid += 1
    const data = parseContact(checked.kind === 'invalid' ? { email, verdict: 'skip', reason: invalidReason(checked.detail), checkedAt: today } : { email })
    entries.push({ key: await contactKey(email), data })
  }
  if (existing.length + entries.length > MAX_CONTACTS) {
    throw new Error(`The list holds ${MAX_CONTACTS} contacts at most and has ${existing.length}. Remove some contacts, or add fewer addresses.`)
  }
  await saveAll(store, entries)
  return { added: entries.length, invalid, duplicates, ignored: asked.ignored }
}

/**
 * Checks the contacts with these keys: each address is read and tested against the throwaway list
 * first, and only then is one lookup made for each distinct domain left. A contact whose domain the
 * call ran out of time for is not changed. Only the domains of the addresses are ever looked up.
 */
export async function checkKeys(store: Store<Contact>, existing: Saved<Contact>[], keys: string[], options: { today: string; dns?: ManyOptions }): Promise<CheckResult> {
  const byKey = new Map(existing.map(contact => [contact.key, contact]))
  const asked = [...new Set(keys)]
  const found = asked.flatMap(key => byKey.get(key) ?? [])
  const read = found.map(contact => ({ contact, checked: checkAddress(contact.email) }))
  const looked = await lookupDomains(
    read.flatMap(({ checked }) => (checked.kind === 'ok' ? [checked.asciiDomain] : [])),
    options.dns
  )

  const entries: { key: string; data: Contact }[] = []
  let left = 0
  for (const { contact, checked } of read) {
    const mx = checked.kind === 'ok' ? (looked.get(checked.asciiDomain) ?? null) : null
    if (checked.kind === 'ok' && !mx) {
      left += 1
      continue
    }
    const outcome = verdictFor(checked, mx)
    entries.push({ key: contact.key, data: parseContact({ ...contact, ...outcome, checkedAt: options.today }) })
  }
  await saveAll(store, entries)
  return { checked: entries.length, left, missing: asked.length - found.length }
}

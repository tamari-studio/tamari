// Server functions for the contact list. Rows live in the shared-records collection
// `email-check-contacts` (no table of its own). Every argument comes from the browser, so each one
// is checked (lib/check.ts, lib/contacts.ts) before anything is looked up or saved.
//
// A check looks up the DNS records of the contacts' domains and nothing else: it never connects to a
// mail server, and the part of an address before the @ never leaves this server (lib/dns.ts).
import { requireCaller } from '@miso/caller'
import { collection } from '@miso/store'
import { addAddresses, checkKeys, type AddResult, type CheckResult } from './batch'
import { day } from './check'
import { exampleContacts, parseAddresses, parseContact, parseKeys, type Contact } from './contacts'
import { rows, type Saved } from './rows'

const store = () => collection<Contact>('email-check-contacts')
const contacts = () => rows(store(), { parse: parseContact, examples: exampleContacts })

export async function listContacts(): Promise<Saved<Contact>[]> {
  requireCaller()
  return contacts().list()
}

/**
 * Adds the addresses in pasted text: 200 at most. A badly written one is "don't send" at once, the
 * rest wait for a check. `today` is the person's own day (YYYY-MM-DD).
 */
export async function addContacts(text: unknown, today: unknown): Promise<AddResult> {
  requireCaller()
  const asked = parseAddresses(text)
  const when = day(today, 'Today', { required: true })
  if (asked.addresses.length === 0) return { added: 0, invalid: 0, duplicates: 0, ignored: asked.ignored }
  return addAddresses(store(), await contacts().list(), asked, when)
}

/** Checks the contacts with these keys: 100 at most in one call. */
export async function checkContacts(keys: unknown): Promise<CheckResult> {
  requireCaller()
  const asked = parseKeys(keys)
  if (asked.length === 0) return { checked: 0, left: 0, missing: 0 }
  return checkKeys(store(), await contacts().list(), asked, { today: new Date().toISOString().slice(0, 10) })
}

export async function removeContact(key: unknown): Promise<void> {
  requireCaller()
  await contacts().remove(key)
}

/** `today` is the person's own day (YYYY-MM-DD). */
export async function loadExampleContacts(today: unknown): Promise<number> {
  requireCaller()
  return contacts().loadExamples(day(today, 'Today', { required: true }))
}

export async function removeExampleContacts(): Promise<number> {
  requireCaller()
  return contacts().removeExamples()
}

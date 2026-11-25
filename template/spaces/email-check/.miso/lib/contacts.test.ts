import { afterEach, describe, expect, test } from 'bun:test'

import { addAddresses, checkKeys } from './batch'
import { rowKey } from './check'
import {
  MAX_ADDRESS,
  MAX_CONTACTS,
  MAX_PER_ADD,
  MAX_PER_CHECK,
  MAX_TEXT,
  REASON,
  VERDICTS,
  contactKey,
  exampleContacts,
  goodAddresses,
  invalidReason,
  parseAddresses,
  parseContact,
  parseKeys,
  sortContacts,
  summary,
  type Contact
} from './contacts'
import { addContacts, checkContacts, listContacts, loadExampleContacts, removeContact, removeExampleContacts } from './contacts.server'
import { DOH_ENDPOINTS, type DohFetch, type MxResult } from './dns'
import { checkAddress, verdictFor } from './mail'
import { memoryStore, rows, type Saved } from './rows'

const TODAY = '2026-03-04'
const contact = (patch: Partial<Contact> = {}): Contact => ({ email: 'ida@example.org', name: '', note: '', verdict: 'unchecked', reason: '', mxHost: '', checkedAt: '', ...patch })
const setup = () => {
  const store = memoryStore<Contact>()
  return { store, list: rows(store, { parse: parseContact, examples: exampleContacts }) }
}
const lines = (count: number, domain = 'example.org') => Array.from({ length: count }, (_, i) => `person${i}@${domain}`).join('\n')

describe('parseContact', () => {
  test('keeps the known fields, cleaned, and drops the rest', () => {
    expect(parseContact({ email: '  ida@example.org ', name: ' Ida   Larsen ', verdict: 'ok', reason: REASON.ok, mxHost: 'mx1.example.org', checkedAt: TODAY, key: 'r-1', admin: true })).toEqual({
      email: 'ida@example.org',
      name: 'Ida Larsen',
      note: '',
      verdict: 'ok',
      reason: REASON.ok,
      mxHost: 'mx1.example.org',
      checkedAt: TODAY
    })
  })

  test('a row saved before a field existed gets a default for it', () => {
    expect(parseContact({ email: 'ida@example.org' })).toEqual(contact())
    expect(parseContact({ email: 'ida@example.org', verdict: null, checkedAt: null })).toEqual(contact())
  })

  test('checks every field', () => {
    expect(() => parseContact({ email: '' })).toThrow('Email address is needed.')
    expect(() => parseContact({})).toThrow('Email address is needed.')
    expect(() => parseContact({ email: 'a'.repeat(MAX_ADDRESS + 1) })).toThrow('too long')
    expect(() => parseContact({ email: 42 })).toThrow('must be text')
    expect(() => parseContact({ email: 'a@example.org', name: 'x'.repeat(81) })).toThrow('Name is too long')
    expect(() => parseContact({ email: 'a@example.org', note: 'x'.repeat(161) })).toThrow('Note is too long')
    expect(() => parseContact({ email: 'a@example.org', verdict: 'maybe' })).toThrow('Verdict must be one of')
    expect(() => parseContact({ email: 'a@example.org', verdict: '__proto__' })).toThrow('Verdict must be one of')
    expect(() => parseContact({ email: 'a@example.org', reason: 'x'.repeat(161) })).toThrow('Reason is too long')
    expect(() => parseContact({ email: 'a@example.org', mxHost: 'x'.repeat(254) })).toThrow('Mail server is too long')
    expect(() => parseContact({ email: 'a@example.org', checkedAt: 'yesterday' })).toThrow('Checked on must be a date.')
    for (const bad of [null, 'ida@example.org', 3, [1]]) expect(() => parseContact(bad)).toThrow('could not be read')
  })

  test('an address that is written wrong is still a row: the check on the form is mail.ts\'s job', () => {
    expect(parseContact({ email: 'jonas@@example.org', verdict: 'skip' }).email).toBe('jonas@@example.org')
    expect(VERDICTS).toEqual(['unchecked', 'ok', 'review', 'skip'])
  })
})

describe('parseAddresses', () => {
  test('finds addresses between lines, commas, semicolons and spaces, and cleans what wraps them', () => {
    const asked = parseAddresses('ida@example.org, oskar@acme.example;maja@example.net\n\tlars@harbour.example  <nora@example.com> "eva@example.org" mailto:jonas@example.org (olav@example.org),')
    expect(asked.addresses).toEqual(['ida@example.org', 'oskar@acme.example', 'maja@example.net', 'lars@harbour.example', 'nora@example.com', 'eva@example.org', 'jonas@example.org', 'olav@example.org'])
    expect(asked.ignored).toBe(0)
  })

  test('pieces without an @ and pieces that are too long to be an address are left out and counted', () => {
    const asked = parseAddresses(`Ida Larsen <ida@example.org> ${'a'.repeat(MAX_ADDRESS + 1)}@example.org plain-text`)
    expect(asked.addresses).toEqual(['ida@example.org'])
    expect(asked.ignored).toBe(4)
    expect(parseAddresses('').addresses).toEqual([])
    expect(parseAddresses('  \n ,; ').ignored).toBe(0)
  })

  test('the same address in other capitals is one address', () => {
    expect(parseAddresses('Ida@Example.org ida@example.ORG IDA@EXAMPLE.ORG').addresses).toEqual(['Ida@Example.org'])
  })

  test('200 addresses at most: one more is refused, and a repeat is not one more', () => {
    expect(parseAddresses(lines(MAX_PER_ADD)).addresses).toHaveLength(200)
    expect(() => parseAddresses(lines(MAX_PER_ADD + 1))).toThrow('more than 200 addresses')
    expect(parseAddresses(`${lines(MAX_PER_ADD)}\n${lines(MAX_PER_ADD)}`).addresses).toHaveLength(200)
    expect(parseAddresses(Array(3000).fill('a@example.org').join(' ')).addresses).toEqual(['a@example.org'])
  })

  test('text that is too long is refused before it is split', () => {
    expect(() => parseAddresses('a'.repeat(MAX_TEXT + 1))).toThrow('too much text')
    expect(() => parseAddresses(' '.repeat(MAX_TEXT + 1))).toThrow('too much text')
    expect(MAX_TEXT).toBeGreaterThanOrEqual(MAX_PER_ADD * (MAX_ADDRESS + 1))
    const started = performance.now()
    parseAddresses(`${'a@b.co '.repeat(8000)}`)
    expect(performance.now() - started).toBeLessThan(500)
  })

  test('anything but text is refused', () => {
    for (const bad of [undefined, null, 5, {}, ['a@example.org']]) expect(() => parseAddresses(bad)).toThrow('as text')
  })
})

describe('parseKeys', () => {
  test('a list of plain row keys, none twice', () => {
    expect(parseKeys(['r-1', 'c-ab', 'r-1'])).toEqual(['r-1', 'c-ab'])
    expect(parseKeys([])).toEqual([])
  })

  test('100 keys at most: one more is refused with the number', () => {
    const keys = (count: number) => Array.from({ length: count }, (_, i) => `r-${i}`)
    expect(parseKeys(keys(MAX_PER_CHECK))).toHaveLength(100)
    expect(() => parseKeys(keys(MAX_PER_CHECK + 1))).toThrow('100 contacts at most at a time. You sent 101.')
    expect(() => parseKeys(keys(5000))).toThrow('You sent 5000')
  })

  test('anything that is not a list of keys is refused', () => {
    for (const bad of [undefined, null, 'r-1', { length: 1 }, 5]) expect(() => parseKeys(bad)).toThrow('could not be read')
    for (const bad of [[1], ['../x'], ['R-1'], [''], [null], ['r-1', 'a b'], ['x'.repeat(65)]]) expect(() => parseKeys(bad)).toThrow('could not be found')
  })
})

describe('contactKey', () => {
  test('is a plain row key made from the address, the same in any capitals', async () => {
    const key = await contactKey('Ida@Example.org')
    expect(rowKey(key)).toBe(key)
    expect(key).toMatch(/^c-[0-9a-f]{32}$/)
    expect(await contactKey('ida@example.ORG')).toBe(key)
    expect(await contactKey('oskar@example.org')).not.toBe(key)
  })
})

describe('summary and lists', () => {
  test('counts each verdict, and the share is of the contacts that were checked', () => {
    const rowsOf = (...verdicts: Contact['verdict'][]) => verdicts.map(verdict => contact({ verdict }))
    expect(summary([])).toEqual({ total: 0, ok: 0, review: 0, skip: 0, unchecked: 0, checked: 0, share: null })
    expect(summary(rowsOf('unchecked', 'unchecked'))).toEqual({ total: 2, ok: 0, review: 0, skip: 0, unchecked: 2, checked: 0, share: null })
    expect(summary(rowsOf('ok', 'ok', 'review', 'skip', 'unchecked'))).toEqual({ total: 5, ok: 2, review: 1, skip: 1, unchecked: 1, checked: 4, share: 50 })
    expect(summary(rowsOf('ok', 'ok', 'review')).share).toBe(67)
    expect(summary(rowsOf('ok', 'ok', 'ok')).share).toBe(100)
    expect(summary(rowsOf('skip')).share).toBe(0)
  })

  test('the good addresses are only the "ok" ones, by address', () => {
    const all = [contact({ email: 'z@example.org', verdict: 'ok' }), contact({ email: 'info@example.org', verdict: 'review' }), contact({ email: 'a@example.org', verdict: 'ok' }), contact({ email: 'x@example.org', verdict: 'skip' }), contact({ email: 'u@example.org' })]
    expect(goodAddresses(all)).toEqual(['a@example.org', 'z@example.org'])
    expect(sortContacts(all).map(c => c.email)[0]).toBe('a@example.org')
    expect(all[0]!.email).toBe('z@example.org')
  })
})

describe('the examples', () => {
  const examples = exampleContacts(TODAY)

  test('are eight to ten invented contacts that pass the check, at example domains', () => {
    expect(examples.length).toBeGreaterThanOrEqual(8)
    expect(examples.length).toBeLessThanOrEqual(10)
    expect(examples.map(parseContact)).toEqual(examples)
    for (const { email } of examples) expect({ email, domain: /@(?:example\.(?:org|net|com)|[a-z-]+\.example|mailinator\.com)$/.test(email) }).toEqual({ email, domain: true })
    expect(new Set(examples.map(c => c.email)).size).toBe(examples.length)
  })

  test('already have their verdicts, so loading them needs no lookup', () => {
    expect(examples.every(c => c.verdict !== 'unchecked' && c.reason !== '' && c.checkedAt === TODAY)).toBe(true)
    expect(summary(examples)).toEqual({ total: 10, ok: 5, review: 2, skip: 3, unchecked: 0, checked: 10, share: 50 })
    for (const verdict of ['ok', 'review', 'skip'] as const) expect(examples.some(c => c.verdict === verdict)).toBe(true)
  })

  test('are what the checker would say, so a check never changes them', () => {
    for (const c of examples) {
      const checked = checkAddress(c.email)
      // The lookup is the one thing not run here: the example says what it would have found.
      const found: MxResult = c.reason === REASON.notFound ? { ok: false, reason: 'domain_not_found', detail: '' } : { ok: true, hosts: [c.mxHost], source: 'mx' }
      const got = { email: c.email, ...verdictFor(checked, checked.kind === 'ok' ? found : null) }
      expect(got).toEqual({ email: c.email, verdict: c.verdict, reason: c.reason, mxHost: c.mxHost } as typeof got)
    }
    expect(invalidReason('more than one @')).toBe(examples.find(c => c.email === 'jonas@@example.org')!.reason)
  })

  test('load and go away together through the list, and never touch the lookup', async () => {
    const { store, list } = setup()
    await list.loadExamples(TODAY)
    expect(store.data.size).toBe(examples.length)
    expect((await list.list()).every(c => c.example && c.verdict !== 'unchecked')).toBe(true)
    expect(await list.removeExamples()).toBe(examples.length)
    expect(store.data.size).toBe(0)
  })
})

/** A fake resolver: every domain in `mail` has a mail server, every other one does not exist. */
function resolver(mail: string[], { status = 200 } = {}) {
  const urls: string[] = []
  const fetchFn: DohFetch = async url => {
    urls.push(url)
    const name = new URL(url).searchParams.get('name')!
    if (status !== 200) return new Response('no', { status })
    return new Response(JSON.stringify(mail.includes(name) ? { Status: 0, Answer: [{ type: 15, data: `10 mx.${name}.` }] } : { Status: 3 }), { status: 200 })
  }
  return { fetchFn, urls }
}

describe('adding and checking, over a list in memory', () => {
  test('adding keeps new addresses unchecked, marks the ones written wrong, and skips what is there', async () => {
    const { store, list } = setup()
    const asked = parseAddresses('ida@example.org, jonas@@example.org\nINFO@Acme.example; not-an-address; ida@example.org')
    expect(await addAddresses(store, await list.list(), asked, TODAY)).toEqual({ added: 3, invalid: 1, duplicates: 0, ignored: 1 })

    const saved = await list.list()
    expect(sortContacts(saved).map(c => [c.email, c.verdict, c.checkedAt])).toEqual([
      ['ida@example.org', 'unchecked', ''],
      ['INFO@acme.example', 'unchecked', ''],
      ['jonas@@example.org', 'skip', TODAY]
    ])
    expect(saved.find(c => c.email === 'jonas@@example.org')!.reason).toBe('Not a valid address: more than one @')
    expect(saved.every(c => /^c-[0-9a-f]{32}$/.test(c.key) && !c.example)).toBe(true)

    // The same again, in other capitals: nothing new, nothing doubled.
    expect(await addAddresses(store, saved, parseAddresses('IDA@example.org info@ACME.example new@example.org'), TODAY)).toEqual({ added: 1, invalid: 0, duplicates: 2, ignored: 0 })
    expect(store.data.size).toBe(4)
  })

  test('an example already in the list counts as there', async () => {
    const { store, list } = setup()
    await list.loadExamples(TODAY)
    const before = store.data.size
    expect(await addAddresses(store, await list.list(), parseAddresses('Ida.Larsen@example.org'), TODAY)).toMatchObject({ added: 0, duplicates: 1 })
    expect(store.data.size).toBe(before)
  })

  test('the list holds 500 contacts at most: an add that would pass it is refused, and writes nothing', async () => {
    expect(MAX_CONTACTS).toBe(500)
    const { store } = setup()
    const full = (count: number): Saved<Contact>[] => Array.from({ length: count }, (_, i) => ({ ...contact({ email: `old${i}@example.org` }), key: `r-${i}`, example: false }))
    await expect(addAddresses(store, full(MAX_CONTACTS - 1), parseAddresses('a@example.org b@example.org'), TODAY)).rejects.toThrow('holds 500 contacts at most and has 499')
    await expect(addAddresses(store, full(MAX_CONTACTS), parseAddresses('a@example.org'), TODAY)).rejects.toThrow('500 contacts at most')
    expect(store.data.size).toBe(0)
    expect(await addAddresses(store, full(MAX_CONTACTS - 1), parseAddresses('a@example.org'), TODAY)).toMatchObject({ added: 1 })
    // Nothing new to add is fine in a full list.
    expect(await addAddresses(store, full(MAX_CONTACTS), parseAddresses('old1@example.org'), TODAY)).toMatchObject({ added: 0, duplicates: 1 })
  })

  test('a check gives each address its verdict, with one lookup for each domain and no address in it', async () => {
    const { store, list } = setup()
    await addAddresses(store, [], parseAddresses('secret.ida@example.org private.oskar@example.org info@acme.example x@mailinator.com lost@nowhere.example'), TODAY)
    const dns = resolver(['example.org', 'acme.example'])
    const result = await checkKeys(store, await list.list(), (await list.list()).map(c => c.key), { today: '2026-03-05', dns: { fetchFn: dns.fetchFn } })
    expect(result).toEqual({ checked: 5, left: 0, missing: 0 })

    const by = Object.fromEntries((await list.list()).map(c => [c.email, c]))
    expect(by['secret.ida@example.org']).toMatchObject({ verdict: 'ok', reason: REASON.ok, mxHost: 'mx.example.org', checkedAt: '2026-03-05' })
    expect(by['info@acme.example']).toMatchObject({ verdict: 'review', reason: REASON.shared })
    expect(by['x@mailinator.com']).toMatchObject({ verdict: 'skip', reason: REASON.throwaway })
    expect(by['lost@nowhere.example']).toMatchObject({ verdict: 'skip', reason: REASON.notFound })

    // Three domains were looked up, once each: not the throwaway one, and not twice for example.org.
    const asked = dns.urls.map(url => new URL(url).searchParams.get('name')).sort()
    expect(asked).toEqual(['acme.example', 'example.org', 'nowhere.example'])
    for (const url of dns.urls) {
      expect(DOH_ENDPOINTS.some(endpoint => url.startsWith(endpoint))).toBe(true)
      for (const secret of ['secret', 'private', 'ida', 'oskar', 'info', 'lost', '@', '%40']) expect({ url, secret, found: url.includes(secret) }).toEqual({ url, secret, found: false })
    }
  })

  test('a lookup that failed is "check first", and a contact the time ran out for stays as it was', async () => {
    const { store, list } = setup()
    await addAddresses(store, [], parseAddresses('ida@example.org oskar@acme.example'), TODAY)
    const keys = (await list.list()).map(c => c.key)

    const down = resolver([], { status: 500 })
    expect(await checkKeys(store, await list.list(), keys, { today: TODAY, dns: { fetchFn: down.fetchFn } })).toEqual({ checked: 2, left: 0, missing: 0 })
    expect((await list.list()).map(c => [c.verdict, c.reason])).toEqual([['review', REASON.lookupFailed], ['review', REASON.lookupFailed]])

    const { store: fresh, list: freshList } = setup()
    await addAddresses(fresh, [], parseAddresses('ida@example.org oskar@acme.example bad@@example.org'), TODAY)
    const none = resolver(['example.org'])
    const out = await checkKeys(fresh, await freshList.list(), (await freshList.list()).map(c => c.key), { today: '2026-03-05', dns: { fetchFn: none.fetchFn, budgetMs: 0 } })
    // The one written wrong needs no lookup, so it is settled; the other two wait for the next try.
    expect(out).toEqual({ checked: 1, left: 2, missing: 0 })
    expect(none.urls).toHaveLength(0)
    expect((await freshList.list()).filter(c => c.verdict === 'unchecked')).toHaveLength(2)
  })

  test('keys that are gone are counted, a key twice is one contact, and only the saved fields are written', async () => {
    const { store, list } = setup()
    await addAddresses(store, [], parseAddresses('ida@example.org'), TODAY)
    const [row] = await list.list()
    const dns = resolver(['example.org'])
    expect(await checkKeys(store, [row!], [row!.key, row!.key, 'r-gone'], { today: TODAY, dns: { fetchFn: dns.fetchFn } })).toEqual({ checked: 1, left: 0, missing: 1 })
    expect(Object.keys(store.data.get(row!.key)!).sort()).toEqual(['checkedAt', 'email', 'mxHost', 'name', 'note', 'reason', 'verdict'])
    expect(dns.urls).toHaveLength(1)
  })

  test('a check of 100 contacts at 100 different domains stays inside the lookup limits', async () => {
    const { store, list } = setup()
    await addAddresses(store, [], parseAddresses(Array.from({ length: 100 }, (_, i) => `a@d${i}.example`).join(' ')), TODAY)
    let running = 0
    let peak = 0
    const fetchFn: DohFetch = async url => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise(done => setTimeout(done, 2))
      running -= 1
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 15, data: `10 mx.${new URL(url).searchParams.get('name')}.` }] }), { status: 200 })
    }
    const keys = (await list.list()).map(c => c.key)
    expect(keys).toHaveLength(MAX_PER_CHECK)
    expect(await checkKeys(store, await list.list(), keys, { today: TODAY, dns: { fetchFn } })).toEqual({ checked: 100, left: 0, missing: 0 })
    expect(peak).toBe(16)
  })

  test('a store that fails gives the person a plain sentence, not its own message', async () => {
    const { store } = setup()
    store.putMany = async () => {
      throw new Error('[@miso/store] putMany email-check-contacts: permission denied for table records')
    }
    const logged = console.error
    console.error = () => {}
    try {
      await expect(addAddresses(store, [], parseAddresses('ida@example.org'), TODAY)).rejects.toThrow('Could not save that. Try again; if it keeps happening, tell an admin.')
    } finally {
      console.error = logged
    }
  })
})

// The server functions: nobody signed in, nothing happens; a bad argument stops before the store.
const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})
const signIn = () => {
  process.env.MISO_CALLER_EMAIL = 'a@example.com'
  process.env.MISO_CALLER_ID = 'u1'
}

describe('the server functions', () => {
  test('every one needs a signed-in member', async () => {
    delete process.env.MISO_CALLER_EMAIL
    delete process.env.MISO_CALLER_ID
    await expect(listContacts()).rejects.toThrow('signed-in member')
    await expect(addContacts('ida@example.org', TODAY)).rejects.toThrow('signed-in member')
    await expect(checkContacts(['r-1'])).rejects.toThrow('signed-in member')
    await expect(removeContact('r-1')).rejects.toThrow('signed-in member')
    await expect(loadExampleContacts(TODAY)).rejects.toThrow('signed-in member')
    await expect(removeExampleContacts()).rejects.toThrow('signed-in member')
  })

  test('a bad argument is refused before the list or any lookup is touched', async () => {
    signIn()
    await expect(addContacts(lines(MAX_PER_ADD + 1), TODAY)).rejects.toThrow('more than 200 addresses')
    await expect(addContacts('a'.repeat(MAX_TEXT + 1), TODAY)).rejects.toThrow('too much text')
    await expect(addContacts(42, TODAY)).rejects.toThrow('as text')
    await expect(addContacts('ida@example.org', 'yesterday')).rejects.toThrow('Today must be a date.')
    await expect(addContacts('ida@example.org', undefined)).rejects.toThrow('Today is needed.')
    await expect(checkContacts(Array.from({ length: MAX_PER_CHECK + 1 }, (_, i) => `r-${i}`))).rejects.toThrow('100 contacts at most at a time')
    await expect(checkContacts('r-1')).rejects.toThrow('could not be read')
    await expect(checkContacts(['../x'])).rejects.toThrow('could not be found')
    await expect(checkContacts([{ key: 'r-1' }])).rejects.toThrow('could not be found')
    await expect(removeContact('../x')).rejects.toThrow('could not be found')
    await expect(removeContact({ key: 'r-1' })).rejects.toThrow('could not be found')
    await expect(loadExampleContacts('yesterday')).rejects.toThrow('Today must be a date.')
  })
})

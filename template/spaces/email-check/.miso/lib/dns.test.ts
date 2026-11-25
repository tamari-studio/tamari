// The lookup against a fake resolver: no network, and no clock but the ones the tests hand in.
import { describe, expect, test } from 'bun:test'

import { DOH_ENDPOINTS, MAX_DOMAINS, MAX_IN_FLIGHT, isDomainName, lookupDomains, lookupMx, type DohFetch } from './dns'

type Reply = { Status: number; Answer?: { type: number; data: string }[] }
type Zone = Record<string, Partial<Record<'MX' | 'A' | 'AAAA', Reply>>>

const MX = 15
const A = 1
const AAAA = 28
const withMx = (...hosts: string[]): Reply => ({ Status: 0, Answer: hosts.map((data, i) => ({ type: MX, data: `${(i + 1) * 10} ${data}` })) })

type Options = {
  /** Hosts of resolvers that fail to connect. */
  down?: string[]
  /** A resolver that never answers, until the request is cut. */
  hang?: boolean
  /** Real milliseconds each answer takes. */
  delay?: number
  /** A clock the fake moves on by this much on each request, instead of waiting. */
  clock?: { t: number; step: number }
}

/** A fake DNS-over-HTTPS resolver that knows `zone`. It keeps every request, and how many ran at once. */
function fakeDoh(zone: Zone, { down = [], hang = false, delay = 0, clock }: Options = {}) {
  const calls: { host: string; type: string; name: string; url: string; init: RequestInit }[] = []
  let running = 0
  let peak = 0
  const fetchFn: DohFetch = async (url, init) => {
    const u = new URL(url)
    calls.push({ host: u.host, type: u.searchParams.get('type')!, name: u.searchParams.get('name')!, url, init })
    running += 1
    peak = Math.max(peak, running)
    try {
      if (hang) await new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('cut'), { name: 'TimeoutError' }))))
      if (delay) await new Promise(done => setTimeout(done, delay))
      if (clock) clock.t += clock.step
      if (down.includes(u.host)) throw new Error(`${u.host} unreachable`)
      const name = u.searchParams.get('name')!
      const type = u.searchParams.get('type') as 'MX' | 'A' | 'AAAA'
      const answer = zone[name]?.[type] ?? (zone[name] ? { Status: 0 } : { Status: 3 })
      return new Response(JSON.stringify(answer), { status: 200 })
    } finally {
      running -= 1
    }
  }
  return { fetchFn, calls, peak: () => peak }
}

const names = (count: number) => Array.from({ length: count }, (_, i) => `d${i}.example`)
const zoneOf = (domains: string[]): Zone => Object.fromEntries(domains.map(d => [d, { MX: withMx('mx.example.net.') }]))
const FIRST = new URL(DOH_ENDPOINTS[0]).host
const SECOND = new URL(DOH_ENDPOINTS[1]).host

describe('lookupMx: what DNS says about a domain', () => {
  test('MX hosts are sorted by preference, lower case, without the dot at the end', async () => {
    const { fetchFn } = fakeDoh({
      'example.org': { MX: { Status: 0, Answer: [{ type: MX, data: '10 ALT3.ASPMX.L.GOOGLE.COM.' }, { type: MX, data: '1 aspmx.l.google.com.' }, { type: 5, data: 'cname.example.' }] } }
    })
    expect(await lookupMx('example.org', { fetchFn })).toEqual({ ok: true, hosts: ['aspmx.l.google.com', 'alt3.aspmx.l.google.com'], source: 'mx' })
  })

  test('a domain that does not exist (NXDOMAIN) is domain_not_found', async () => {
    const { fetchFn, calls } = fakeDoh({})
    expect(await lookupMx('nothing-here.example', { fetchFn })).toMatchObject({ ok: false, reason: 'domain_not_found' })
    expect(calls).toHaveLength(1)
  })

  test('a null MX (RFC 7505) is null_mx', async () => {
    const { fetchFn } = fakeDoh({ 'example.com': { MX: { Status: 0, Answer: [{ type: MX, data: '0 .' }] } } })
    expect(await lookupMx('example.com', { fetchFn })).toMatchObject({ ok: false, reason: 'null_mx' })
  })

  test('no MX but an A record: the domain takes its own mail', async () => {
    const { fetchFn, calls } = fakeDoh({ 'site.example': { MX: { Status: 0 }, A: { Status: 0, Answer: [{ type: A, data: '192.0.2.10' }] } } })
    expect(await lookupMx('site.example', { fetchFn })).toEqual({ ok: true, hosts: ['site.example'], source: 'a_fallback' })
    expect(calls.map(c => c.type)).toEqual(['MX', 'A'])
  })

  test('no MX, no A, but an AAAA record is also a mail host', async () => {
    const { fetchFn } = fakeDoh({ 'six.example': { MX: { Status: 0 }, A: { Status: 0 }, AAAA: { Status: 0, Answer: [{ type: AAAA, data: '2001:db8::1' }] } } })
    expect(await lookupMx('six.example', { fetchFn })).toMatchObject({ ok: true, source: 'a_fallback' })
  })

  test('no MX and no address at all is no_mail_server', async () => {
    const { fetchFn, calls } = fakeDoh({ 'parked.example': { MX: { Status: 0 } } })
    expect(await lookupMx('parked.example', { fetchFn })).toMatchObject({ ok: false, reason: 'no_mail_server' })
    expect(calls.map(c => c.type)).toEqual(['MX', 'A', 'AAAA'])
  })

  test('SERVFAIL from both resolvers is a dns_error, which says nothing about the domain', async () => {
    const servfail: DohFetch = async () => new Response(JSON.stringify({ Status: 2 }), { status: 200 })
    expect(await lookupMx('odd.example', { fetchFn: servfail })).toMatchObject({ ok: false, reason: 'dns_error' })
  })

  test('REFUSED on the address lookup is a dns_error, not no_mail_server', async () => {
    const { fetchFn } = fakeDoh({ 'odd.example': { MX: { Status: 0 }, A: { Status: 5 } } })
    expect(await lookupMx('odd.example', { fetchFn })).toMatchObject({ ok: false, reason: 'dns_error' })
  })

  test('the second resolver answers when the first is down, says SERVFAIL, or sends rubbish', async () => {
    const zone: Zone = { 'example.org': { MX: withMx('aspmx.l.google.com.') } }
    const down = fakeDoh(zone, { down: [FIRST] })
    expect(await lookupMx('example.org', { fetchFn: down.fetchFn })).toMatchObject({ ok: true })
    expect(down.calls.map(c => c.host)).toEqual([FIRST, SECOND])

    let n = 0
    const servfailFirst: DohFetch = async () => new Response(JSON.stringify(n++ === 0 ? { Status: 2 } : zone['example.org']!.MX), { status: 200 })
    expect(await lookupMx('example.org', { fetchFn: servfailFirst })).toMatchObject({ ok: true })

    for (const first of ['not json', '{"Status":"x"}', 'null', '[]', '', 'x'.repeat(70_000)]) {
      let m = 0
      const rubbishFirst: DohFetch = async () => new Response(m++ === 0 ? first : JSON.stringify(zone['example.org']!.MX), { status: 200 })
      expect({ first: first.slice(0, 12), result: (await lookupMx('example.org', { fetchFn: rubbishFirst })).ok }).toEqual({ first: first.slice(0, 12), result: true })
    }
  })

  test('both resolvers failing is a dns_error, never a throw', async () => {
    const down = fakeDoh({}, { down: [FIRST, SECOND] })
    expect(await lookupMx('example.org', { fetchFn: down.fetchFn })).toMatchObject({ ok: false, reason: 'dns_error' })
    expect(down.calls).toHaveLength(2)
    // An answer that says it is huge is not read.
    const huge: DohFetch = async () => new Response('{"Status":0}', { status: 200, headers: { 'content-length': '5000000' } })
    expect(await lookupMx('example.org', { fetchFn: huge })).toMatchObject({ ok: false, reason: 'dns_error' })
    const http500: DohFetch = async () => new Response('no', { status: 500 })
    expect(await lookupMx('example.org', { fetchFn: http500 })).toMatchObject({ ok: false, reason: 'dns_error' })
    const throwsRubbish: DohFetch = async () => {
      throw 'a string, not an Error'
    }
    expect(await lookupMx('example.org', { fetchFn: throwsRubbish })).toMatchObject({ ok: false, reason: 'dns_error' })
  })

  test('a resolver that hangs is cut by the request timeout, and the next one is tried', async () => {
    const { fetchFn, calls } = fakeDoh({}, { hang: true })
    const started = Date.now()
    const result = await lookupMx('slow.example', { fetchFn, timeoutMs: 30 })
    expect(result).toMatchObject({ ok: false, reason: 'dns_error' })
    expect(result.ok === false && result.outOfTime).toBeUndefined()
    expect(calls.map(c => c.host)).toEqual([FIRST, SECOND])
    expect(Date.now() - started).toBeLessThan(2000)
  })

  test('the whole lookup of one domain has its own time: no new request once it is used up', async () => {
    // Every request takes 150 ms of the fake clock and finds no MX, so the lookup would go on to A and AAAA.
    const clock = { t: 0, step: 150 }
    const { fetchFn, calls } = fakeDoh({ 'slow.example': { MX: { Status: 0 } } }, { clock })
    const result = await lookupMx('slow.example', { fetchFn, lookupMs: 250, now: () => clock.t })
    expect(result).toMatchObject({ ok: false, reason: 'dns_error' })
    expect(result.ok === false && result.outOfTime).toBeUndefined()
    expect(calls.map(c => c.type)).toEqual(['MX', 'A'])
  })

  test('nothing starts once the call\'s deadline has passed', async () => {
    const { fetchFn, calls } = fakeDoh({})
    const result = await lookupMx('late.example', { fetchFn, deadline: 1000, now: () => 1000 })
    expect(result).toMatchObject({ ok: false, reason: 'dns_error', outOfTime: true })
    expect(calls).toHaveLength(0)
  })

  test('a request cut to the time left in the call, and then timing out, is out of time', async () => {
    const { fetchFn } = fakeDoh({}, { hang: true })
    const started = Date.now()
    const result = await lookupMx('slow.example', { fetchFn, timeoutMs: 5000, deadline: started + 200 })
    expect(result).toMatchObject({ ok: false, reason: 'dns_error', outOfTime: true })
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('what is sent, and where', () => {
  test('only the two fixed resolvers are asked, with the domain alone in the request, and no redirect is followed', async () => {
    const domains = names(5)
    const { fetchFn, calls } = fakeDoh(zoneOf(domains), { down: [FIRST] })
    await lookupDomains(domains, { fetchFn })
    expect(calls.length).toBeGreaterThan(0)
    for (const { url, host, init, name } of calls) {
      expect([FIRST, SECOND]).toContain(host)
      expect(DOH_ENDPOINTS.some(endpoint => url.startsWith(`${endpoint}?name=${name}&type=`))).toBe(true)
      expect(domains).toContain(name)
      expect(url).not.toContain('@')
      expect(init.redirect).toBe('error')
      expect((init.headers as Record<string, string>).accept).toBe('application/dns-json')
    }
    expect(new Set(DOH_ENDPOINTS).size).toBe(2)
  })

  test('a name that is not a plain host name is never looked up', async () => {
    const { fetchFn, calls } = fakeDoh({})
    const bad = ['', 'a b.example', 'ida@example.org', '../etc/passwd', 'example.org/x', 'example.org?x=1', 'example.org:25', 'exa%6dple.org', 'EXAMPLE.ORG', 'a'.repeat(64) + '.org', `${'a.'.repeat(130)}org`, 'localhost', 'a..org', '-a.org', 'a-.org', 'münchen.example']
    const found = await lookupDomains(bad, { fetchFn })
    expect(calls).toHaveLength(0)
    for (const name of bad) expect({ name, reason: (found.get(name) as { reason: string }).reason }).toEqual({ name, reason: 'domain_not_found' })
    expect(await lookupMx(42 as unknown as string, { fetchFn })).toMatchObject({ ok: false })
    expect(isDomainName('example.org')).toBe(true)
    expect(isDomainName('xn--mnchen-3ya.example')).toBe(true)
  })
})

describe('lookupDomains: the limits of one call', () => {
  test('one lookup for each distinct domain, however many contacts share it', async () => {
    const { fetchFn, calls } = fakeDoh(zoneOf(['a.example', 'b.example', 'c.example']))
    const found = await lookupDomains(['a.example', 'b.example', 'a.example', 'a.example', 'b.example', 'c.example'], { fetchFn })
    expect([...found.keys()].sort()).toEqual(['a.example', 'b.example', 'c.example'])
    expect(calls.map(c => c.name).sort()).toEqual(['a.example', 'b.example', 'c.example'])
  })

  test('at most 16 lookups run at the same time, whatever is asked for', async () => {
    const domains = names(60)
    for (const concurrency of [undefined, 99, 1e9, Infinity, NaN]) {
      const { fetchFn, peak, calls } = fakeDoh(zoneOf(domains), { delay: 3 })
      const found = await lookupDomains(domains, { fetchFn, concurrency })
      expect({ concurrency, peak: peak(), done: found.size, calls: calls.length }).toEqual({ concurrency, peak: MAX_IN_FLIGHT, done: 60, calls: 60 })
    }
    expect(MAX_IN_FLIGHT).toBe(16)
  })

  test('a lower limit is kept, and nothing below one', async () => {
    const domains = names(20)
    for (const [asked, peak] of [[4, 4], [1, 1], [0, 1], [-5, 1], [2.9, 2]] as const) {
      const fake = fakeDoh(zoneOf(domains), { delay: 2 })
      await lookupDomains(domains, { fetchFn: fake.fetchFn, concurrency: asked })
      expect({ asked, peak: fake.peak() }).toEqual({ asked, peak })
    }
  })

  test('more than 100 distinct domains are refused before anything is looked up', async () => {
    const { fetchFn, calls } = fakeDoh({})
    await expect(lookupDomains(names(MAX_DOMAINS + 1), { fetchFn })).rejects.toThrow('100 domains at most')
    expect(calls).toHaveLength(0)
    // The same domain over and over is one domain.
    const same = Array.from({ length: 500 }, () => 'a.example')
    expect((await lookupDomains(same, { fetchFn: fakeDoh(zoneOf(['a.example'])).fetchFn })).size).toBe(1)
    expect((await lookupDomains(names(MAX_DOMAINS), { fetchFn: fakeDoh(zoneOf(names(MAX_DOMAINS))).fetchFn })).size).toBe(MAX_DOMAINS)
    await expect(lookupDomains('a.example' as unknown as string[], { fetchFn })).rejects.toThrow('list of domains')
    expect((await lookupDomains([], { fetchFn })).size).toBe(0)
  })

  test('the deadline stops new lookups, and a domain it left alone comes back as null', async () => {
    const domains = names(10)
    // Each request takes 2 s of the fake clock, and the call has 5 s: three lookups start, the rest do not.
    const clock = { t: 0, step: 2000 }
    const { fetchFn, calls } = fakeDoh(zoneOf(domains), { clock })
    const found = await lookupDomains(domains, { fetchFn, concurrency: 1, budgetMs: 5000, now: () => clock.t })
    expect(calls).toHaveLength(3)
    expect(domains.map(d => found.get(d) === null)).toEqual([false, false, false, true, true, true, true, true, true, true])
    expect(found.get('d0.example')).toMatchObject({ ok: true })
  })

  test('with no time at all, nothing is looked up and nothing is given a verdict', async () => {
    const { fetchFn, calls } = fakeDoh(zoneOf(names(5)))
    const found = await lookupDomains(names(5), { fetchFn, budgetMs: 0 })
    expect(calls).toHaveLength(0)
    expect([...found.values()]).toEqual([null, null, null, null, null])
  })

  test('a lookup the deadline cuts in the middle is null too, while a failed one is a dns_error', async () => {
    const { fetchFn } = fakeDoh({}, { hang: true })
    const started = Date.now()
    const found = await lookupDomains(['slow.example'], { fetchFn, timeoutMs: 5000, budgetMs: 250 })
    expect(found.get('slow.example')).toBeNull()
    expect(Date.now() - started).toBeLessThan(2000)
    const failing = fakeDoh({}, { down: [FIRST, SECOND] })
    expect((await lookupDomains(['down.example'], { fetchFn: failing.fetchFn })).get('down.example')).toMatchObject({ ok: false, reason: 'dns_error' })
  })
})

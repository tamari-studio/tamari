// The DoH lookup against a fake resolver.
import { describe, expect, test } from 'bun:test'

import { DOH_ENDPOINTS, lookupMx, type DohFetch } from './_dns'

type Answer = { Status: number; Answer?: { type: number; data: string }[] }
type Zone = Record<string, Partial<Record<'MX' | 'A' | 'AAAA', Answer>>>

/** A fake DoH resolver. `down` lists endpoint hosts that fail; every call is recorded. */
function fakeDoh(zone: Zone, { down = [] as string[], hang = false } = {}) {
  const calls: string[] = []
  const fetchFn: DohFetch = async (url, init) => {
    const u = new URL(url)
    calls.push(`${u.host} ${u.searchParams.get('type')} ${u.searchParams.get('name')}`)
    expect((init.headers as Record<string, string>).accept).toBe('application/dns-json')
    if (hang) {
      await new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))))
    }
    if (down.includes(u.host)) throw new Error(`${u.host} unreachable`)
    const name = u.searchParams.get('name')!
    const type = u.searchParams.get('type') as 'MX' | 'A' | 'AAAA'
    const answer = zone[name]?.[type] ?? (zone[name] ? { Status: 0 } : { Status: 3 })
    return new Response(JSON.stringify(answer), { status: 200 })
  }
  return { fetchFn, calls }
}

const MX = 15
const A = 1

describe('lookupMx', () => {
  test('sorts hosts by preference, strips the trailing dot, lowercases', async () => {
    const { fetchFn } = fakeDoh({
      'example.org': {
        MX: { Status: 0, Answer: [{ type: MX, data: '10 ALT3.ASPMX.L.GOOGLE.COM.' }, { type: MX, data: '1 aspmx.l.google.com.' }, { type: 5, data: 'cname.example.' }] }
      }
    })
    expect(await lookupMx('example.org', { fetchFn })).toEqual({ ok: true, hosts: ['aspmx.l.google.com', 'alt3.aspmx.l.google.com'], source: 'mx' })
  })

  test('NXDOMAIN is domain_not_found', async () => {
    const { fetchFn } = fakeDoh({})
    expect(await lookupMx('nonexistent-zz9.com', { fetchFn })).toMatchObject({ ok: false, reason: 'domain_not_found' })
  })

  test('a null MX (RFC 7505) is null_mx', async () => {
    const { fetchFn } = fakeDoh({ 'example.com': { MX: { Status: 0, Answer: [{ type: MX, data: '0 .' }] } } })
    expect(await lookupMx('example.com', { fetchFn })).toMatchObject({ ok: false, reason: 'null_mx' })
  })

  test('no MX but an A record falls back to the domain itself', async () => {
    const { fetchFn } = fakeDoh({ 'github.io': { MX: { Status: 0 }, A: { Status: 0, Answer: [{ type: A, data: '185.199.108.153' }] } } })
    expect(await lookupMx('github.io', { fetchFn })).toEqual({ ok: true, hosts: ['github.io'], source: 'a_fallback' })
  })

  test('no MX and no A/AAAA is no_mail_server', async () => {
    const { fetchFn, calls } = fakeDoh({ 'parked.example': { MX: { Status: 0 } } })
    expect(await lookupMx('parked.example', { fetchFn })).toMatchObject({ ok: false, reason: 'no_mail_server' })
    expect(calls.map(c => c.split(' ')[1])).toEqual(['MX', 'A', 'AAAA'])
  })

  test('falls back to the second resolver when the first is down or answers SERVFAIL', async () => {
    const first = new URL(DOH_ENDPOINTS[0]).host
    const zone = { 'example.org': { MX: { Status: 0, Answer: [{ type: MX, data: '1 aspmx.l.google.com.' }] } } }
    const down = fakeDoh(zone, { down: [first] })
    expect(await lookupMx('example.org', { fetchFn: down.fetchFn })).toMatchObject({ ok: true })
    expect(down.calls).toHaveLength(2)

    let n = 0
    const servfailThenOk: DohFetch = async () =>
      new Response(JSON.stringify(n++ === 0 ? { Status: 2 } : zone['example.org'].MX), { status: 200 })
    expect(await lookupMx('example.org', { fetchFn: servfailThenOk })).toMatchObject({ ok: true })
  })

  test('every resolver failing is a dns_error, never a throw', async () => {
    const hosts = DOH_ENDPOINTS.map(e => new URL(e).host)
    const { fetchFn } = fakeDoh({}, { down: hosts })
    expect(await lookupMx('example.org', { fetchFn })).toMatchObject({ ok: false, reason: 'dns_error' })
    const http500: DohFetch = async () => new Response('no', { status: 500 })
    expect(await lookupMx('example.org', { fetchFn: http500 })).toMatchObject({ ok: false, reason: 'dns_error' })
  })

  test('an A/AAAA answer other than NOERROR or NXDOMAIN (REFUSED) is a dns_error, not no_mail_server', async () => {
    const { fetchFn } = fakeDoh({ 'odd.example': { MX: { Status: 0 }, A: { Status: 5 } } })
    expect(await lookupMx('odd.example', { fetchFn })).toMatchObject({ ok: false, reason: 'dns_error' })
  })

  test('nothing starts once the batch deadline has passed', async () => {
    const { fetchFn, calls } = fakeDoh({})
    const result = await lookupMx('late.example', { fetchFn, deadline: 1000, now: () => 1000 })
    expect(result).toMatchObject({ ok: false, reason: 'dns_error', outOfTime: true })
    expect(calls).toHaveLength(0)
  })

  test('a query cut to the time left, then timing out, is out of time rather than a DNS failure', async () => {
    const { fetchFn } = fakeDoh({}, { hang: true })
    const start = Date.now()
    const result = await lookupMx('slow.example', { fetchFn, timeoutMs: 5000, deadline: start + 400 })
    expect(result).toMatchObject({ ok: false, reason: 'dns_error', outOfTime: true })
    expect(Date.now() - start).toBeLessThan(2000)
  })

  test('a resolver that hangs times out into a dns_error', async () => {
    const { fetchFn } = fakeDoh({}, { hang: true })
    const result = await lookupMx('slow.example', { fetchFn, timeoutMs: 20 })
    expect(result).toMatchObject({ ok: false, reason: 'dns_error' })
  })
})

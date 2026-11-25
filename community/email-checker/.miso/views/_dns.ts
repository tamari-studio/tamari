// Does a domain accept mail, and through which host. Server-only (bouncer.server.ts).
//
// Looks up MX records over DNS-over-HTTPS (Cloudflare, then Google if Cloudflare
// can't be reached) rather than node:dns. Bun's node:dns answers ENOTFOUND both
// for a domain that doesn't exist and for one that exists without an MX record,
// and those need different answers here (checked 2026-10-11 with github.io).
// DoH returns the DNS status itself, and it is plain fetch, which the hosted
// app's functions can always make. Only domain names leave the server, never an
// address.
//
// The outcomes:
// - MX hosts found                       -> ok, hosts sorted by preference
// - null MX (RFC 7505, a single ".")     -> null_mx: the domain refuses all mail
// - no MX but an A/AAAA record           -> ok via the RFC 5321 §5.1 fallback
// - no MX and no A/AAAA                  -> no_mail_server
// - the domain doesn't exist (NXDOMAIN)  -> domain_not_found
// - SERVFAIL, REFUSED, timeout, unreachable -> dns_error: about us, not the address
//
// A lookup never runs past `deadline` (the batch's end): each query's timeout is
// cut to the time left, and one cut short comes back with `outOfTime`, so the
// batch can hand the address back unchecked instead of giving it a verdict.

export type MxResult =
  | { ok: true; hosts: string[]; source: 'mx' | 'a_fallback' }
  | {
      ok: false
      reason: 'domain_not_found' | 'no_mail_server' | 'null_mx' | 'dns_error'
      detail: string
      /** The batch's time ran out mid-lookup: says nothing about the domain. */
      outOfTime?: boolean
    }

type DohAnswer = { type: number; data: string }
type DohResponse = { Status: number; Answer?: DohAnswer[] }

export type DohFetch = (url: string, init: RequestInit) => Promise<Response>

export const DOH_ENDPOINTS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve'
] as const

const TYPE = { A: 1, MX: 15, AAAA: 28 } as const
const NOERROR = 0
const SERVFAIL = 2
const NXDOMAIN = 3

class LookupFailed extends Error {}
class OutOfTime extends Error {}

/** Below this much time left, a query isn't started. */
const MIN_QUERY_MS = 300

type Clock = { timeoutMs: number; deadline: number; now: () => number }

async function query(domain: string, type: keyof typeof TYPE, fetchFn: DohFetch, clock: Clock): Promise<DohResponse> {
  let last = ''
  for (const endpoint of DOH_ENDPOINTS) {
    const left = clock.deadline - clock.now()
    if (left < MIN_QUERY_MS) throw new OutOfTime(`ran out of time looking up ${domain}`)
    const cut = left < clock.timeoutMs
    const url = `${endpoint}?name=${encodeURIComponent(domain)}&type=${type}`
    try {
      const res = await fetchFn(url, {
        headers: { accept: 'application/dns-json' },
        signal: AbortSignal.timeout(cut ? left : clock.timeoutMs)
      })
      if (!res.ok) {
        last = `${new URL(endpoint).host} answered HTTP ${res.status}`
        continue
      }
      const body = (await res.json()) as DohResponse
      if (typeof body?.Status !== 'number') {
        last = `${new URL(endpoint).host} sent an unreadable answer`
        continue
      }
      // SERVFAIL from one resolver can be that resolver's bad moment; ask the next.
      if (body.Status === SERVFAIL) {
        last = `SERVFAIL for ${domain}`
        continue
      }
      return body
    } catch (err) {
      const timedOut = (err as Error).name === 'TimeoutError'
      if (timedOut && cut) throw new OutOfTime(`ran out of time looking up ${domain}`)
      last = timedOut ? `timed out looking up ${domain}` : (err as Error).message
    }
  }
  throw new LookupFailed(last || `could not look up ${domain}`)
}

const records = (body: DohResponse, type: number) => (body.Answer ?? []).filter(a => a.type === type)

export type LookupOptions = {
  fetchFn?: DohFetch
  /** Per query, per resolver. */
  timeoutMs?: number
  /** Epoch ms after which nothing new starts and running queries are cut. */
  deadline?: number
  now?: () => number
}

/** One domain's mail setup. Never throws: a failure on our side is a dns_error result. */
export async function lookupMx(
  domain: string,
  { fetchFn = fetch as DohFetch, timeoutMs = 5000, deadline = Infinity, now = Date.now }: LookupOptions = {}
): Promise<MxResult> {
  const clock: Clock = { timeoutMs, deadline, now }
  try {
    const mx = await query(domain, 'MX', fetchFn, clock)
    if (mx.Status === NXDOMAIN) return { ok: false, reason: 'domain_not_found', detail: `${domain} does not exist` }
    if (mx.Status !== NOERROR) return { ok: false, reason: 'dns_error', detail: `DNS status ${mx.Status} for ${domain}` }

    const answers = records(mx, TYPE.MX)
    if (answers.length > 0) {
      const hosts = answers
        .map(a => {
          const [pref, host = ''] = a.data.trim().split(/\s+/)
          return { pref: Number(pref), host: host.replace(/\.$/, '').toLowerCase() }
        })
        .sort((a, b) => a.pref - b.pref)
        .map(a => a.host)
        .filter(Boolean)
      if (hosts.length === 0) return { ok: false, reason: 'null_mx', detail: `${domain} refuses all mail (null MX)` }
      return { ok: true, hosts, source: 'mx' }
    }

    // No MX: the A or AAAA record is the implicit mail host (RFC 5321 §5.1).
    for (const type of ['A', 'AAAA'] as const) {
      const addr = await query(domain, type, fetchFn, clock)
      if (addr.Status === NOERROR && records(addr, TYPE[type]).length > 0) {
        return { ok: true, hosts: [domain], source: 'a_fallback' }
      }
      if (addr.Status !== NOERROR && addr.Status !== NXDOMAIN) {
        return { ok: false, reason: 'dns_error', detail: `DNS status ${addr.Status} for ${domain} (${type})` }
      }
    }
    return { ok: false, reason: 'no_mail_server', detail: `${domain} has no MX and no A/AAAA record` }
  } catch (err) {
    return { ok: false, reason: 'dns_error', detail: (err as Error).message, ...(err instanceof OutOfTime ? { outOfTime: true } : {}) }
  }
}

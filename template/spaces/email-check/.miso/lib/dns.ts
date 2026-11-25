// Does a domain take mail, and through which host. Server-side only (contacts.server.ts).
//
// What leaves the server, and where to:
// - Only domain names, never an address and never the part before the @.
// - Only to the two resolvers in DOH_ENDPOINTS, over HTTPS (DNS over HTTPS). A redirect is refused,
//   so nothing else is ever asked.
// - Nothing is ever sent to a mail server: no connection to port 25, no SMTP. DNS only.
//
// Limits, so a long list can't tie the server up:
// - one lookup per distinct domain, however many contacts share it
// - at most MAX_IN_FLIGHT lookups at the same time
// - at most MAX_DOMAINS domains in one call
// - each request times out (`timeoutMs`), each domain's whole lookup times out (`lookupMs`), and the
//   call has a deadline (`budgetMs`) after which nothing new starts and running requests are cut.
//   A domain the deadline cut short comes back as null: it says nothing about the domain, so the
//   contact stays unchecked and can be sent again.
//
// The outcomes for one domain:
// - MX hosts found                          -> ok, hosts sorted by preference
// - a null MX (RFC 7505, a single ".")      -> null_mx: the domain takes no mail
// - no MX but an A or AAAA record           -> ok, the domain itself takes the mail (RFC 5321, 5.1)
// - no MX and no A or AAAA record           -> no_mail_server
// - the domain does not exist (NXDOMAIN)    -> domain_not_found
// - SERVFAIL, REFUSED, a timeout, no answer -> dns_error: about the lookup, not about the address

export type MxResult =
  | { ok: true; hosts: string[]; source: 'mx' | 'a_fallback' }
  | {
      ok: false
      reason: 'domain_not_found' | 'no_mail_server' | 'null_mx' | 'dns_error'
      detail: string
      /** The call's time ran out in the middle of the lookup. */
      outOfTime?: boolean
    }

export type DohFetch = (url: string, init: RequestInit) => Promise<Response>

export const DOH_ENDPOINTS = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'] as const

/** Lookups in flight at once, whatever the caller asks for. */
export const MAX_IN_FLIGHT = 16
/** Distinct domains in one call. */
export const MAX_DOMAINS = 100

const TYPE = { A: 1, MX: 15, AAAA: 28 } as const
const NOERROR = 0
const SERVFAIL = 2
const NXDOMAIN = 3
/** A resolver's answer is small. Anything bigger is not read. */
const MAX_ANSWER_CHARS = 65_536
/** With less time than this left, a request is not started. */
const MIN_REQUEST_MS = 100

class LookupFailed extends Error {}
class OutOfTime extends Error {}

type Answer = { type: number; data: string }
type Reply = { Status: number; Answer?: Answer[] }

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/** A plain lowercase host name with at least two labels: all that is ever put in a lookup. */
export function isDomainName(name: unknown): name is string {
  if (typeof name !== 'string' || name.length > 253) return false
  const labels = name.split('.')
  return labels.length >= 2 && labels.every(label => LABEL.test(label))
}

type Clock = { now: () => number; deadline: number; lookupEnd: number; timeoutMs: number }

async function query(domain: string, type: keyof typeof TYPE, fetchFn: DohFetch, clock: Clock): Promise<Reply> {
  let last = ''
  for (const endpoint of DOH_ENDPOINTS) {
    const callLeft = clock.deadline - clock.now()
    if (callLeft < MIN_REQUEST_MS) throw new OutOfTime(`ran out of time looking up ${domain}`)
    const lookupLeft = clock.lookupEnd - clock.now()
    if (lookupLeft < MIN_REQUEST_MS) throw new LookupFailed(`timed out looking up ${domain}`)
    // Cut by the call's deadline when that is what ends it first.
    const cutByCall = callLeft <= lookupLeft && callLeft < clock.timeoutMs
    const ms = Math.min(clock.timeoutMs, callLeft, lookupLeft)
    try {
      const res = await fetchFn(`${endpoint}?name=${encodeURIComponent(domain)}&type=${type}`, {
        headers: { accept: 'application/dns-json' },
        redirect: 'error',
        signal: AbortSignal.timeout(ms)
      })
      if (!res.ok) {
        last = `${new URL(endpoint).host} answered HTTP ${res.status}`
        continue
      }
      // An answer says how long it is, most of the time: a long one is not read at all.
      const body = Number(res.headers.get('content-length')) > MAX_ANSWER_CHARS ? '' : await res.text()
      const answer = body === '' || body.length > MAX_ANSWER_CHARS ? null : readAnswer(body)
      if (!answer) {
        last = `${new URL(endpoint).host} sent an answer that could not be read`
        continue
      }
      // SERVFAIL from one resolver can be that resolver's bad moment: ask the next.
      if (answer.Status === SERVFAIL) {
        last = `SERVFAIL for ${domain}`
        continue
      }
      return answer
    } catch (err) {
      const name = (err as Error | undefined)?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        if (cutByCall) throw new OutOfTime(`ran out of time looking up ${domain}`)
        last = `timed out looking up ${domain}`
      } else {
        last = String((err as Error | undefined)?.message ?? err).slice(0, 200)
      }
    }
  }
  throw new LookupFailed(last || `could not look up ${domain}`)
}

function readAnswer(body: string): Reply | null {
  try {
    const parsed = JSON.parse(body) as { Status?: unknown; Answer?: unknown } | null
    if (!parsed || typeof parsed.Status !== 'number') return null
    const list = Array.isArray(parsed.Answer) ? parsed.Answer : []
    const answers = list.filter((a): a is Answer => !!a && typeof a.type === 'number' && typeof a.data === 'string')
    return { Status: parsed.Status, Answer: answers }
  } catch {
    return null
  }
}

const records = (answer: Reply, type: number) => (answer.Answer ?? []).filter(a => a.type === type)

const HOST = /^[a-z0-9._-]{1,253}$/

export type LookupOptions = {
  /** Where requests go. For tests; the default is the global `fetch`. */
  fetchFn?: DohFetch
  /** Per request, to one resolver. */
  timeoutMs?: number
  /** For all the requests of one domain. */
  lookupMs?: number
  /** Epoch ms after which nothing new starts and running requests are cut. */
  deadline?: number
  now?: () => number
}

/** One domain's mail setup. Never throws: a failure on our side is a dns_error result. */
export async function lookupMx(domain: string, options: LookupOptions = {}): Promise<MxResult> {
  // Whatever reaches a lookup is checked once more here: only a plain host name is ever sent.
  if (!isDomainName(domain)) return { ok: false, reason: 'domain_not_found', detail: 'not a domain name' }
  const { fetchFn = (url, init) => fetch(url, init), timeoutMs = 4000, lookupMs = 8000, deadline = Infinity, now = Date.now } = options
  const clock: Clock = { now, deadline, lookupEnd: now() + lookupMs, timeoutMs }
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
        .filter(host => HOST.test(host))
        .slice(0, 10)
      if (hosts.length === 0) return { ok: false, reason: 'null_mx', detail: `${domain} takes no mail (null MX)` }
      return { ok: true, hosts, source: 'mx' }
    }

    // No MX: the A or AAAA record is the implicit mail host.
    for (const type of ['A', 'AAAA'] as const) {
      const addr = await query(domain, type, fetchFn, clock)
      if (addr.Status === NOERROR && records(addr, TYPE[type]).length > 0) return { ok: true, hosts: [domain], source: 'a_fallback' }
      if (addr.Status !== NOERROR && addr.Status !== NXDOMAIN) return { ok: false, reason: 'dns_error', detail: `DNS status ${addr.Status} for ${domain} (${type})` }
    }
    return { ok: false, reason: 'no_mail_server', detail: `${domain} has no MX and no A or AAAA record` }
  } catch (err) {
    return { ok: false, reason: 'dns_error', detail: (err as Error).message, ...(err instanceof OutOfTime ? { outOfTime: true } : {}) }
  }
}

export type ManyOptions = Omit<LookupOptions, 'deadline'> & {
  /** Lookups at once. At most MAX_IN_FLIGHT, whatever is asked. */
  concurrency?: number
  /** Time for the whole call, in ms. Keep it under the server's own limit. */
  budgetMs?: number
}

/**
 * One lookup for each distinct domain, MAX_IN_FLIGHT at a time at most, all done by the deadline.
 * A domain that was not finished in time is null: the caller leaves its contacts unchecked.
 */
export async function lookupDomains(domains: string[], options: ManyOptions = {}): Promise<Map<string, MxResult | null>> {
  if (!Array.isArray(domains)) throw new Error('Expected a list of domains.')
  const distinct = [...new Set(domains)]
  if (distinct.length > MAX_DOMAINS) throw new Error(`Look up ${MAX_DOMAINS} domains at most at a time. Got ${distinct.length}.`)
  const { now = Date.now, budgetMs = 40_000, concurrency, ...lookup } = options
  const asked = typeof concurrency === 'number' && Number.isFinite(concurrency) ? Math.floor(concurrency) : MAX_IN_FLIGHT
  const workers = Math.min(MAX_IN_FLIGHT, Math.max(1, asked), distinct.length)
  const deadline = now() + budgetMs

  const results = new Map<string, MxResult | null>()
  let next = 0
  async function worker() {
    while (next < distinct.length) {
      const domain = distinct[next++]!
      if (now() >= deadline) {
        results.set(domain, null)
        continue
      }
      const result = await lookupMx(domain, { ...lookup, now, deadline })
      results.set(domain, !result.ok && result.outOfTime ? null : result)
    }
  }
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

// One batch of the email checker: syntax for every address, one lookup per
// distinct domain (several at a time), then a verdict per address. Server-only;
// bouncer.server.ts is the thin wrapper the view calls. Tested with a fake lookup
// in _bounce-run.test.ts.
import { checkSyntax, verdictFor, verdictForSyntaxFailure } from './_bounce-core'
import { MAX_PER_CALL, type EmailVerdict } from './_bounce-shared'
import type { MxResult } from './_dns'

/** `deadline` is when the batch must be done (epoch ms); a lookup cut short by it says `outOfTime`. */
export type Lookup = (domain: string, deadline: number) => Promise<MxResult>

/** The most lookups in flight at once. */
export const MAX_CONCURRENCY = 16

export type RunOptions = {
  lookup: Lookup
  /** Lookups in flight at once (at most MAX_CONCURRENCY). */
  concurrency?: number
  /** The batch's time. Lookups not finished by then come back unchecked (null). Under the 60 s function cap. */
  budgetMs?: number
  now?: () => number
}

/**
 * Verdicts for `emails`, in the same order. An address whose domain couldn't be
 * looked up before the batch's time ran out is null: unchecked, for the caller
 * to send again. Throws only on a batch that is too large.
 */
export async function checkBatch(emails: string[], options: RunOptions): Promise<(EmailVerdict | null)[]> {
  // Every argument comes from the browser: check the list and each address before any lookup.
  if (!Array.isArray(emails)) throw new Error('Expected a list of email addresses')
  if (emails.length > MAX_PER_CALL) {
    throw new Error(`At most ${MAX_PER_CALL} addresses per call, got ${emails.length}`)
  }
  if (emails.some(email => typeof email !== 'string')) throw new Error('Each address must be text')
  const { lookup, budgetMs = 40_000, now = Date.now } = options
  // At most MAX_CONCURRENCY lookups in flight, whatever the caller asks for.
  const concurrency = Math.min(Math.max(1, Math.floor(options.concurrency ?? 16)), MAX_CONCURRENCY)
  const deadline = now() + budgetMs

  const syntax = emails.map(email => checkSyntax(email))
  const domains = [...new Set(syntax.flatMap(s => (s.ok ? [s.asciiDomain] : [])))]

  const results = new Map<string, MxResult | null>()
  let next = 0
  async function worker() {
    while (next < domains.length) {
      const domain = domains[next++]!
      if (now() >= deadline) {
        results.set(domain, null)
        continue
      }
      const result = await lookup(domain, deadline)
      results.set(domain, !result.ok && result.outOfTime ? null : result)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, domains.length) }, worker))

  return syntax.map(s => {
    if (!s.ok) return verdictForSyntaxFailure(s)
    const mx = results.get(s.asciiDomain)
    return mx ? verdictFor(s, mx) : null
  })
}

/**
 * Remembers lookups across batches for a while, so a 2,000-row file with 40
 * domains asks DNS 40 times, not once per batch. Failures on our side are not
 * remembered: the next batch tries again.
 */
export function cachedLookup(lookup: Lookup, { ttlMs = 10 * 60_000, max = 5000, now = Date.now } = {}): Lookup {
  const cache = new Map<string, { at: number; result: MxResult }>()
  return async (domain, deadline) => {
    const hit = cache.get(domain)
    if (hit && now() - hit.at < ttlMs) return hit.result
    const result = await lookup(domain, deadline)
    if (result.ok || result.reason !== 'dns_error') {
      if (cache.size >= max) cache.delete(cache.keys().next().value!)
      cache.set(domain, { at: now(), result })
    }
    return result
  }
}

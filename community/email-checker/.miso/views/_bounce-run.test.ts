// A batch: one lookup per distinct domain, order kept, the time budget, the cache.
import { describe, expect, test } from 'bun:test'

import { MAX_CONCURRENCY, cachedLookup, checkBatch, type Lookup } from './_bounce-run'
import { MAX_PER_CALL } from './_bounce-shared'
import type { MxResult } from './_dns'

const GOOD: MxResult = { ok: true, hosts: ['mx.example.org'], source: 'mx' }

function fakeLookup(answers: Record<string, MxResult> = {}) {
  const asked: string[] = []
  const lookup: Lookup = async domain => {
    asked.push(domain)
    return answers[domain] ?? GOOD
  }
  return { lookup, asked }
}

describe('checkBatch', () => {
  test('answers in order, one lookup per distinct domain, none for bad syntax', async () => {
    const { lookup, asked } = fakeLookup({ 'dead.example': { ok: false, reason: 'domain_not_found', detail: '' } })
    const out = await checkBatch(['a@example.org', 'not-an-email', 'B@Example.org', 'info@example.org', 'x@dead.example', 'y@mailinator.com'], { lookup })
    expect(out.map(v => `${v!.verdict}:${v!.reason_code}`)).toEqual([
      'ok:',
      'skip:invalid_syntax',
      'ok:',
      'review:role_account',
      'skip:domain_not_found',
      'skip:disposable'
    ])
    expect(asked.sort()).toEqual(['dead.example', 'example.org'])
  })

  test('refuses an oversized batch', async () => {
    const { lookup, asked } = fakeLookup()
    await expect(checkBatch(Array(MAX_PER_CALL + 1).fill('a@b.com'), { lookup })).rejects.toThrow(/At most/)
    expect(asked).toEqual([])
  })

  test('takes a full batch at the cap', async () => {
    const { lookup } = fakeLookup()
    const out = await checkBatch(Array.from({ length: MAX_PER_CALL }, (_, i) => `a${i}@example.org`), { lookup })
    expect(out).toHaveLength(MAX_PER_CALL)
  })

  test('refuses what is not a list of text, before any lookup', async () => {
    const { lookup, asked } = fakeLookup()
    await expect(checkBatch('a@example.org' as unknown as string[], { lookup })).rejects.toThrow(/list/)
    await expect(checkBatch(['a@example.org', 42 as unknown as string], { lookup })).rejects.toThrow(/text/)
    await expect(checkBatch([null as unknown as string], { lookup })).rejects.toThrow(/text/)
    expect(asked).toEqual([])
  })

  test('an address of a million characters is invalid and costs no lookup', async () => {
    const { lookup, asked } = fakeLookup()
    const out = await checkBatch([`${'a'.repeat(1_000_000)}@example.org`], { lookup })
    expect(out[0]).toMatchObject({ verdict: 'skip', reason_code: 'invalid_syntax' })
    expect(asked).toEqual([])
  })

  test('never has more lookups in flight than the cap, whatever is asked for', async () => {
    let live = 0
    let peak = 0
    const lookup: Lookup = async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise(resolve => setTimeout(resolve, 2))
      live--
      return GOOD
    }
    const emails = Array.from({ length: 60 }, (_, i) => `a@domain${i}.example`)
    await checkBatch(emails, { lookup, concurrency: 1000 })
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENCY)
  })

  test('domains not started before the budget runs out come back unchecked (null)', async () => {
    let t = 0
    const deadlines: number[] = []
    const lookup: Lookup = async (_domain, deadline) => {
      deadlines.push(deadline)
      t += 1000
      return GOOD
    }
    const emails = ['a@one.example', 'b@two.example', 'c@three.example', 'not-an-email']
    const out = await checkBatch(emails, { lookup, concurrency: 1, budgetMs: 1500, now: () => t })
    expect(out.map(v => v?.verdict ?? null)).toEqual(['ok', 'ok', null, 'skip'])
    expect(deadlines).toEqual([1500, 1500])
  })

  test('a lookup cut short by the deadline is unchecked; a real DNS failure is a verdict', async () => {
    const { lookup } = fakeLookup({
      'slow.example': { ok: false, reason: 'dns_error', detail: 'ran out of time', outOfTime: true },
      'broken.example': { ok: false, reason: 'dns_error', detail: 'SERVFAIL' }
    })
    const out = await checkBatch(['a@slow.example', 'b@broken.example'], { lookup })
    expect(out[0]).toBeNull()
    expect(out[1]).toMatchObject({ verdict: 'review', reason_code: 'dns_error' })
  })
})

describe('cachedLookup', () => {
  test('remembers answers for a while, but never a failure on our side', async () => {
    let t = 0
    const { lookup, asked } = fakeLookup({ 'flaky.example': { ok: false, reason: 'dns_error', detail: '' } })
    const cached = cachedLookup(lookup, { ttlMs: 100, now: () => t })
    await cached('example.org', 0)
    await cached('example.org', 0)
    await cached('flaky.example', 0)
    await cached('flaky.example', 0)
    t = 200
    await cached('example.org', 0)
    expect(asked).toEqual(['example.org', 'flaky.example', 'flaky.example', 'example.org'])
  })
})

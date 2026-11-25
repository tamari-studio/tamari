import { describe, expect, test } from 'bun:test'

import type { Catalog } from '../lib/types'
import { InputError } from './connectors'
import { createRuleCache, parseAccess, parseTiers, spaceAccessEntries } from './space-access'

const catalog: Catalog = {
  spaces: [
    { id: 'sp-data', slug: 'data', folder: 'dto', previousSlugs: [], position: 0, name: 'Data', theme: {} },
    { id: 'sp-kpis', slug: 'kpis', folder: 'management', previousSlugs: [], position: 1, name: 'KPIs', theme: {}, minTier: 'manager' }
  ],
  applets: []
}

describe('parseTiers', () => {
  test('keeps known tiers in ladder order, once each, and drops owner', () => {
    expect(parseTiers({ tiers: ['member', 'owner', 'admin', 'member'] })).toEqual(['admin', 'member'])
    expect(parseTiers({ tiers: [] })).toEqual([])
  })

  test('null means back to the default', () => {
    expect(parseTiers({ tiers: null })).toBeNull()
  })

  test('anything else is an input error', () => {
    for (const body of [null, {}, { tiers: 'member' }, { tiers: ['boss'] }, { tiers: [1] }]) {
      expect(() => parseTiers(body)).toThrow(InputError)
    }
  })
})

describe('parseAccess', () => {
  const dept = '11111111-1111-4111-8111-111111111111'
  const person = '22222222-2222-4222-8222-222222222222'

  test('departments and people are ids, once each; left out, none', () => {
    expect(parseAccess({ tiers: ['member'], departments: [dept, dept], people: [person] })).toEqual({
      tiers: ['member'],
      departments: [dept],
      people: [person]
    })
    expect(parseAccess({ tiers: [] })).toEqual({ tiers: [], departments: [], people: [] })
    expect(parseAccess({ tiers: null, people: [person] })).toBeNull()
  })

  test('anything but a list of ids is an input error', () => {
    for (const body of [{ tiers: [], departments: 'x' }, { tiers: [], people: ['not-an-id'] }, { tiers: [], people: [1] }]) {
      expect(() => parseAccess(body)).toThrow(InputError)
    }
  })
})

describe('spaceAccessEntries', () => {
  test('one row per space, the rule or the spaces.json default, in the order given', () => {
    const res = spaceAccessEntries(
      [
        { id: 'sp-kpis', name: 'KPIs' },
        { id: 'sp-data', name: 'Data' },
        { id: 'sp-notes', name: 'Notes' }
      ],
      catalog,
      [{ spaceId: 'sp-kpis', tiers: ['member', 'admin'], departments: ['d1'], people: ['p1'], members: ['p1', 'p2'] }]
    )
    expect(res.tiers).toEqual(['admin', 'manager', 'member'])
    expect(res.spaces).toEqual([
      { id: 'sp-kpis', name: 'KPIs', tiers: ['admin', 'member'], departments: ['d1'], people: ['p1'], defaultTiers: ['admin', 'manager'], custom: true },
      { id: 'sp-data', name: 'Data', tiers: ['admin', 'manager', 'member'], departments: [], people: [], defaultTiers: ['admin', 'manager', 'member'], custom: false },
      { id: 'sp-notes', name: 'Notes', tiers: ['admin', 'manager', 'member'], departments: [], people: [], defaultTiers: ['admin', 'manager', 'member'], custom: false }
    ])
  })
})

describe('createRuleCache', () => {
  test('loads once per TTL, and again after forget', async () => {
    let clock = 0
    let loads = 0
    const cache = createRuleCache(1000, () => clock)
    const load = async () => {
      loads++
      return []
    }
    await cache.get(load)
    await cache.get(load)
    expect(loads).toBe(1)
    clock = 1001
    await cache.get(load)
    expect(loads).toBe(2)
    cache.forget()
    await cache.get(load)
    expect(loads).toBe(3)
  })

  test('a load that started before forget() is not cached', async () => {
    const cache = createRuleCache()
    let release: (rules: []) => void = () => {}
    const slow = cache.get(() => new Promise(resolve => (release = resolve)))
    cache.forget()
    release([])
    await slow
    let loads = 0
    await cache.get(async () => {
      loads++
      return []
    })
    expect(loads).toBe(1)
  })

  test('a failed load is not cached', async () => {
    const cache = createRuleCache()
    await expect(cache.get(async () => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(await cache.get(async () => [{ spaceId: 'x', tiers: [] }])).toEqual([{ spaceId: 'x', tiers: [] }])
  })
})

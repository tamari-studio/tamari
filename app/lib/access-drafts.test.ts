import { expect, test } from 'bun:test'

import { hiddenFor } from './access'
import type { Catalog } from './types'

const space = (id: string, extra = {}) => ({ id, slug: id, folder: id, previousSlugs: [], position: 0, name: id, theme: {}, ...extra })
const catalog: Catalog = {
  spaces: [space('open'), space('mos-draft', { draft: true as const, createdBy: 'u-mo' })],
  applets: [{ ref: 'mos-draft/home', folder: 'mos-draft', name: 'home', kind: 'view', file: '', title: 'Home', requiredEnv: [] }]
}
const viewer = (id: string, tier: 'owner' | 'admin' | 'manager' | 'member', status: 'active' | 'suspended' = 'active') => ({ id, tier, status })

test('a draft is hidden from every member but its creator, and seen by admins and owners', () => {
  expect(hiddenFor(catalog, viewer('u-mo', 'member')).folders.has('mos-draft')).toBe(false)
  for (const other of [viewer('u-eve', 'member'), viewer('u-eve', 'manager'), viewer('u-mo', 'member', 'suspended')]) {
    const hidden = hiddenFor(catalog, other)
    expect(hidden.folders.has('mos-draft')).toBe(true)
    expect(hidden.viewRefs.has('view:mos-draft/home')).toBe(true)
  }
  expect(hiddenFor(catalog, viewer('u-ada', 'admin')).folders.has('mos-draft')).toBe(false)
  expect(hiddenFor(catalog, viewer('u-own', 'owner')).folders.has('mos-draft')).toBe(false)
  expect(hiddenFor(catalog, viewer('u-eve', 'member')).folders.has('open')).toBe(false)
})

import { expect, test } from 'bun:test'

import type { Catalog, Space } from '../../lib/types'
import { appletAccess, isOthersDraft, listedSpaces } from './drafts'

const row = (id: string, folder: string | null) => ({ id, slug: id, folder, name: id }) as unknown as Space
const entry = (folder: string, extra = {}) => ({ id: folder, slug: folder, folder, previousSlugs: [], position: 0, name: folder, theme: {}, ...extra })
const catalog: Catalog = { spaces: [entry('open'), entry('mo-draft', { draft: true as const, createdBy: 'u-mo' })], applets: [] }
const spaces = [row('open', 'open'), row('mo-draft', 'mo-draft'), row('manual', null)]

test("a draft is listed for its author only; an admin who can see the row doesn't get it listed", () => {
  expect(listedSpaces(spaces, catalog, 'u-mo').map(s => s.id)).toEqual(['open', 'mo-draft', 'manual'])
  expect(listedSpaces(spaces, catalog, 'u-admin').map(s => s.id)).toEqual(['open', 'manual'])
  expect(isOthersDraft(row('mo-draft', 'mo-draft'), catalog, 'u-admin')).toBe(true)
  expect(isOthersDraft(row('mo-draft', 'mo-draft'), catalog, 'u-mo')).toBe(false)
  expect(isOthersDraft(row('open', 'open'), catalog, 'u-admin')).toBe(false)
})

test('without the catalog nothing is known to be a draft (App opens no space until the catalog is there)', () => {
  expect(isOthersDraft(row('mo-draft', 'mo-draft'), undefined, 'u-admin')).toBe(false)
})

test("someone else's draft applet loads only inside that draft's own space; unknown folders never load", () => {
  expect(appletAccess('mo-draft', 'open', catalog, 'u-admin')).toBe('others-draft')
  expect(appletAccess('mo-draft', 'mo-draft', catalog, 'u-admin')).toBe('run')
  expect(appletAccess('mo-draft', 'open', catalog, 'u-mo')).toBe('run')
  expect(appletAccess('open', 'open', catalog, 'u-admin')).toBe('run')
  expect(appletAccess('not-in-catalog', 'open', catalog, 'u-admin')).toBe('unknown')
  expect(appletAccess('mo-draft', 'open', undefined, 'u-admin')).toBe('wait')
  expect(appletAccess('mo-draft', 'open', catalog, undefined)).toBe('wait')
})

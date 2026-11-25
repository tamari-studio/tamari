import { expect, test } from 'bun:test'

import { catalogBehind } from './catalog-sync'

const ids = (...list: string[]) => ({ spaces: list.map(id => ({ id })) }) as never

test('the catalog is behind when the workspace has a space it lacks, or lost one it lists', () => {
  expect(catalogBehind(ids('a', 'b'), ids('a', 'b'))).toBe(false)
  expect(catalogBehind(ids('b', 'a'), ids('a', 'b'))).toBe(false)
  expect(catalogBehind(ids('a', 'b'), ids('a'))).toBe(true)
  expect(catalogBehind(ids('a'), ids('a', 'b'))).toBe(true)
})

test("a subspace (not in the catalog) doesn't make the catalog look behind", () => {
  const workspace = { spaces: [{ id: 'a' }, { id: 'sub-1', parentId: 'a' }] } as never
  expect(catalogBehind(workspace, ids('a'))).toBe(false)
})

test("a manual space (added on Settings, not in the catalog) doesn't make the catalog look behind", () => {
  const workspace = { spaces: [{ id: 'a' }, { id: 'space-0123456789abcdef0123456789abcdef' }] } as never
  expect(catalogBehind(workspace, ids('a'))).toBe(false)
})

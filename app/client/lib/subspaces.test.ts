import { expect, test } from 'bun:test'
import type { Space } from '../../lib/types'
import { childrenOf, homeFolder, inSidebarOrder, spaceLabel, topLevel } from './subspaces'

const space = (id: string, parentId: string | null = null, position = 0, folder: string | null = parentId ? null : id): Space => ({
  id, slug: id, name: id.toUpperCase(), folder, previousSlugs: [], position, theme: {}, icon: null, symbol: null, parentId
})

const spaces = [space('data'), space('b', 'data', 1), space('ops'), space('a', 'data', 0), space('x', 'ops')]

test('subspaces sit under their parent, in their own order', () => {
  expect(topLevel(spaces).map(s => s.id)).toEqual(['data', 'ops'])
  expect(childrenOf(spaces, 'data').map(s => s.id)).toEqual(['a', 'b'])
  expect(inSidebarOrder(spaces).map(s => s.id)).toEqual(['data', 'a', 'b', 'ops', 'x'])
})

test("a subspace is labelled with its parent and shares the parent's folder", () => {
  expect(spaceLabel(spaces, spaces[1])).toBe('DATA / B')
  expect(spaceLabel(spaces, spaces[0])).toBe('DATA')
  expect(homeFolder(spaces, spaces[1])).toBe('data')
  expect(homeFolder(spaces, space('orphan', 'gone'))).toBeNull()
})

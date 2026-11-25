import { expect, test } from 'bun:test'

import type { Catalog, Workspace } from '../../lib/types'
import { folderName, usageTargetLabel } from './labels'

test("a folder's name comes from its space, then the catalog, then the folder", () => {
  const workspace: Workspace = {
    spaces: [{ id: 'a', slug: 'a', name: 'Renamed', folder: 'a', previousSlugs: [], position: 0, theme: {}, icon: null, symbol: null, parentId: null }],
    tabs: [],
    layouts: []
  }
  const catalog: Catalog = {
    spaces: [{ id: 'b', slug: 'b', name: 'Board', folder: 'b', previousSlugs: [], position: 1, theme: {} }],
    applets: []
  }
  expect(folderName('a', workspace, catalog)).toBe('Renamed')
  expect(folderName('b', workspace, catalog)).toBe('Board')
  expect(folderName('c', workspace, catalog)).toBe('c')
})

test('usage targets read as names people know', () => {
  const applets = new Map([['view:open/board', { title: 'Board', name: 'board' }]])
  expect(usageTargetLabel('widgets', applets)).toBe('Widgets')
  expect(usageTargetLabel('view:open/board', applets)).toBe('Board')
  expect(usageTargetLabel('view:open/gone', applets)).toBe('gone')
  expect(usageTargetLabel('page:space-access', applets)).toBe('People & access (Spaces)')
  expect(usageTargetLabel('tab.move', applets)).toBe('Moved a tab to another space')
  expect(usageTargetLabel('something.new', applets)).toBe('something.new')
})

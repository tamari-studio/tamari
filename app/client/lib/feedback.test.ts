import { expect, test } from 'bun:test'

import { pageLabel, titleFrom } from './feedback'

test('the title is the first line that says something, within the server limit', () => {
  expect(titleFrom('\n  The export is empty  \nIt worked last week.')).toBe('The export is empty')
  expect(titleFrom('   \n ')).toBe('')
  const long = titleFrom('x'.repeat(500))
  expect(long.length).toBe(200)
  expect(long.endsWith('…')).toBe(true)
})

test('a page path reads as the space and view the person was on', () => {
  const spaces = [{ slug: 'sales', previousSlugs: ['deals'], name: 'Sales' }]
  const applets = new Map([['view:crm/pipeline', { title: 'Pipeline', name: 'pipeline' }]])
  expect(pageLabel('/', spaces, applets)).toBe('Home')
  expect(pageLabel('/sales', spaces, applets)).toBe('Sales')
  expect(pageLabel('/sales/widgets', spaces, applets)).toBe('Sales · Widgets')
  expect(pageLabel('/deals/crm/pipeline', spaces, applets)).toBe('Sales · Pipeline')
  expect(pageLabel('/members', spaces, applets)).toBe('People & access')
  expect(pageLabel('/shared-data', spaces, applets)).toBe('Data map')
  expect(pageLabel('/gone/a/b', spaces, applets)).toBe('/gone/a/b')
})

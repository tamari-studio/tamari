import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { APP_ROOT } from '../../lib/roots'
import { keepQuery, parseRoute, tabPath } from './router'

test('/data belongs to the data space, not the Shared data page', () => {
  expect(parseRoute('/data')).toEqual({ page: 'space', slug: 'data' })
  expect(parseRoute('/data/widgets')).toEqual({ page: 'space', slug: 'data', tab: 'widgets' })
  expect(parseRoute('/data/dto/contacts')).toEqual({ page: 'space', slug: 'data', tab: 'view:dto/contacts' })
})

test('Shared data lives at /shared-data', () => {
  expect(parseRoute('/shared-data')).toEqual({ page: 'shared-data', collection: undefined })
  expect(parseRoute('/shared-data/kpi%20snapshots')).toEqual({ page: 'shared-data', collection: 'kpi snapshots' })
})

test('a malformed % escape is kept as typed instead of throwing', () => {
  expect(parseRoute('/shared-data/100%')).toEqual({ page: 'shared-data', collection: '100%' })
})

test('the fixed pages and tab paths', () => {
  expect(parseRoute('/')).toEqual({ page: 'home' })
  expect(parseRoute('/connectors')).toEqual({ page: 'connectors' })
  expect(parseRoute('/members')).toEqual({ page: 'members' })
  expect(parseRoute('/members/departments')).toEqual({ page: 'members', tab: 'departments' })
  expect(parseRoute('/space-access')).toEqual({ page: 'space-access' })
  expect(parseRoute('/settings')).toEqual({ page: 'settings' })
  expect(parseRoute('/settings/organisation')).toEqual({ page: 'settings', tab: 'organisation' })
  expect(tabPath('kpis', 'widgets')).toBe('/kpis/widgets')
  expect(parseRoute(tabPath('kpis', 'view:management/kpi-ledger'))).toEqual({
    page: 'space',
    slug: 'kpis',
    tab: 'view:management/kpi-ledger'
  })
})

test('a view in the folder named like its space leaves the folder out of the path', () => {
  expect(tabPath('my-day', 'view:my-day/calendar')).toBe('/my-day/calendar')
  expect(tabPath('magic-button', 'view:magic-button/invite-finder-guide')).toBe('/magic-button/invite-finder-guide')
  expect(parseRoute('/my-day/calendar')).toEqual({ page: 'space', slug: 'my-day', tab: 'view:my-day/calendar' })
  // Links made before the change still open the same view.
  expect(parseRoute('/my-day/my-day/calendar')).toEqual({ page: 'space', slug: 'my-day', tab: 'view:my-day/calendar' })
  // A view from another space, or one that would read as the widgets tab, keeps its folder.
  expect(tabPath('my-day', 'view:dto/contacts')).toBe('/my-day/dto/contacts')
  expect(tabPath('my-day', 'view:my-day/widgets')).toBe('/my-day/my-day/widgets')
  expect(parseRoute(tabPath('my-day', 'view:my-day/widgets'))).toEqual({ page: 'space', slug: 'my-day', tab: 'view:my-day/widgets' })
})

// Slugs sit at the root of the URL next to the app's own pages, and those pages
// are matched first. Every slug a space answers to (current and previous) must
// still reach that space — and must not be a prefix the server keeps for itself.
test('no space slug is shadowed by an app page or a server prefix', () => {
  const file = JSON.parse(readFileSync(join(APP_ROOT, 'spaces.json'), 'utf8')) as {
    spaces: { slug: string; previousSlugs?: string[] }[]
  }
  const slugs = file.spaces.flatMap(s => [s.slug, ...(s.previousSlugs ?? [])])
  expect(slugs.length).toBeGreaterThan(0)
  for (const slug of slugs) {
    expect(parseRoute(`/${slug}`)).toEqual({ page: 'space', slug })
    // app/serve.ts sends /api/* to the API; the build puts its bundle in /assets/.
    expect(['api', 'assets']).not.toContain(slug)
  }
})

// The shell rewrites / (and old slugs) to a real path; a query such as the Gmail answer must survive.
test('keepQuery carries a query string over to the path the shell redirects to', () => {
  expect(keepQuery('/ops', '?gmail=connected')).toBe('/ops?gmail=connected')
  expect(keepQuery('/ops/ops/event', '?gmail=error&reason=denied')).toBe('/ops/ops/event?gmail=error&reason=denied')
  expect(keepQuery('/ops', '')).toBe('/ops')
  expect(keepQuery('/ops', '?')).toBe('/ops')
  expect(keepQuery('/ops', 'gmail=connected')).toBe('/ops?gmail=connected')
})

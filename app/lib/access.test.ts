import { expect, test } from 'bun:test'

import { catalogWorkspace, defaultTiers, hiddenFor, isManualSpace, visibleCatalog, visibleWorkspace } from './access'
import type { Catalog, Workspace } from './types'

const catalog: Catalog = {
  spaces: [
    { id: 'sp-data', slug: 'data', folder: 'dto', previousSlugs: [], position: 0, name: 'Data', theme: {} },
    { id: 'sp-kpis', slug: 'kpis', folder: 'management', previousSlugs: [], position: 1, name: 'KPIs', theme: {}, minTier: 'manager' }
  ],
  applets: [
    { ref: 'dto/data', folder: 'dto', name: 'data', kind: 'view', file: '', title: 'Data', requiredEnv: [] },
    { ref: 'management/kpi-flow', folder: 'management', name: 'kpi-flow', kind: 'view', file: '', title: 'KPI flow', requiredEnv: [] },
    { ref: 'management/scoreboard', folder: 'management', name: 'scoreboard', kind: 'widget', file: '', title: 'Scoreboard', requiredEnv: [] }
  ]
}

const space = (id: string, folder: string | null, parentId: string | null = null) => ({ id, slug: id, name: id, folder, previousSlugs: [], position: 0, theme: {}, icon: null, symbol: null, parentId })

const workspace: Workspace = {
  spaces: [space('sp-data', 'dto'), space('sp-kpis', 'management')],
  tabs: [
    { id: 't1', spaceId: 'sp-data', ref: 'view:dto/data', position: 0, params: null },
    { id: 't2', spaceId: 'sp-data', ref: 'view:management/kpi-flow', position: 1, params: null },
    { id: 't3', spaceId: 'sp-kpis', ref: 'widgets', position: 0, params: null }
  ],
  layouts: [
    { spaceId: 'sp-data', widgets: [{ ref: 'management/scoreboard' }, { ref: 'dto/other' }], activeTab: null },
    { spaceId: 'sp-kpis', widgets: [{ ref: 'management/scoreboard' }], activeTab: null }
  ]
}

test('a member does not see a manager space, its views or its widgets', () => {
  const hidden = hiddenFor(catalog, { tier: 'member', status: 'active' })
  expect([...hidden.folders]).toEqual(['management'])
  const seen = visibleWorkspace(workspace, hidden)
  expect(seen.spaces.map(s => s.id)).toEqual(['sp-data'])
  expect(seen.tabs.map(t => t.id)).toEqual(['t1'])
  expect(seen.layouts).toEqual([{ spaceId: 'sp-data', widgets: [{ ref: 'dto/other' }], activeTab: null }])
  expect(visibleCatalog(catalog, { tier: 'member', status: 'active' }).applets.map(a => a.ref)).toEqual(['dto/data'])
})

test('managers and up see everything', () => {
  for (const tier of ['manager', 'admin', 'owner'] as const) {
    const hidden = hiddenFor(catalog, { tier, status: 'active' })
    expect(hidden.folders.size).toBe(0)
    expect(visibleWorkspace(workspace, hidden)).toBe(workspace)
    expect(visibleCatalog(catalog, { tier, status: 'active' })).toBe(catalog)
  }
})

test('a tier only counts while the account is active', () => {
  expect(hiddenFor(catalog, { tier: 'owner', status: 'suspended' }).folders.has('management')).toBe(true)
  expect(hiddenFor(catalog, { tier: null, status: null }).folders.has('management')).toBe(true)
})

test('a view or widget with its own minTier is hidden below it, the rest of its space is not', () => {
  const withFeedback: Catalog = {
    spaces: [{ id: 'sp-health', slug: 'health', folder: 'health', previousSlugs: [], position: 0, name: 'Health', theme: {} }],
    applets: [
      { ref: 'health/systems-health', folder: 'health', name: 'systems-health', kind: 'view', file: '', title: 'Systems health', requiredEnv: [] },
      { ref: 'health/feedback', folder: 'health', name: 'feedback', kind: 'view', file: '', title: 'Feedback', requiredEnv: [], minTier: 'admin' },
      { ref: 'health/inbox', folder: 'health', name: 'inbox', kind: 'widget', file: '', title: 'Inbox', requiredEnv: [], minTier: 'admin' }
    ]
  }
  const healthWorkspace: Workspace = {
    spaces: [space('sp-health', 'health')],
    tabs: [
      { id: 't1', spaceId: 'sp-health', ref: 'view:health/systems-health', position: 0, params: null },
      { id: 't2', spaceId: 'sp-health', ref: 'view:health/feedback', position: 1, params: null }
    ],
    layouts: [{ spaceId: 'sp-health', widgets: [{ ref: 'health/inbox' }], activeTab: null }]
  }
  for (const viewer of [
    { tier: 'manager', status: 'active' },
    { tier: 'member', status: 'active' },
    { tier: 'admin', status: 'suspended' },
    { tier: null, status: null }
  ] as const) {
    const hidden = hiddenFor(withFeedback, viewer)
    expect(hidden.folders.size).toBe(0)
    expect([...hidden.viewRefs]).toEqual(['view:health/feedback'])
    expect([...hidden.widgetRefs]).toEqual(['health/inbox'])
    const seen = visibleWorkspace(healthWorkspace, hidden)
    expect(seen.spaces.map(s => s.id)).toEqual(['sp-health'])
    expect(seen.tabs.map(t => t.id)).toEqual(['t1'])
    expect(seen.layouts[0]!.widgets).toEqual([])
    expect(visibleCatalog(withFeedback, viewer).applets.map(a => a.ref)).toEqual(['health/systems-health'])
  }
  for (const tier of ['admin', 'owner'] as const) {
    expect(visibleWorkspace(healthWorkspace, hiddenFor(withFeedback, { tier, status: 'active' }))).toBe(healthWorkspace)
    expect(visibleCatalog(withFeedback, { tier, status: 'active' })).toBe(withFeedback)
  }
})

// --- Rules from the Space access page ---------------------------------------------

test('a rule replaces the minTier: exactly the tiers it names see the space', () => {
  const rules = [{ spaceId: 'sp-kpis', tiers: ['member' as const] }]
  expect(hiddenFor(catalog, { tier: 'member', status: 'active' }, rules).folders.size).toBe(0)
  expect([...hiddenFor(catalog, { tier: 'manager', status: 'active' }, rules).folders]).toEqual(['management'])
  expect([...hiddenFor(catalog, { tier: 'admin', status: 'active' }, rules).folders]).toEqual(['management'])
})

test('owners see every space whatever the rules say; a suspended owner does not', () => {
  const rules = [{ spaceId: 'sp-kpis', tiers: [] }, { spaceId: 'sp-data', tiers: [] }]
  expect(hiddenFor(catalog, { tier: 'owner', status: 'active' }, rules).folders.size).toBe(0)
  expect(hiddenFor(catalog, { tier: 'owner', status: 'suspended' }, rules).folders.size).toBe(2)
})

test('a rule hides a space from someone without a tier', () => {
  const rules = [{ spaceId: 'sp-data', tiers: ['member' as const] }]
  expect([...hiddenFor(catalog, { tier: null, status: 'pending' }, rules).spaceIds].sort()).toEqual(['sp-data', 'sp-kpis'])
})

test('a rule for a space this build has no folder for hides it by id', () => {
  const hidden = hiddenFor(catalog, { tier: 'member', status: 'active' }, [{ spaceId: 'sp-notes', tiers: ['admin'] }])
  expect(hidden.spaceIds.has('sp-notes')).toBe(true)
  expect(visibleWorkspace({ ...workspace, spaces: [...workspace.spaces, space('sp-notes', '')] }, hidden).spaces.map(s => s.id)).toEqual(['sp-data'])
})

test('a rule lets in the people it names, by id, if their account is active', () => {
  const rules = [{ spaceId: 'sp-kpis', tiers: [], members: ['u1'] }]
  expect(hiddenFor(catalog, { id: 'u1', tier: 'member', status: 'active' }, rules).folders.size).toBe(0)
  expect([...hiddenFor(catalog, { id: 'u2', tier: 'admin', status: 'active' }, rules).folders]).toEqual(['management'])
  expect([...hiddenFor(catalog, { id: 'u1', tier: 'member', status: 'suspended' }, rules).folders]).toEqual(['management'])
  // Without an id only the tier counts.
  expect([...hiddenFor(catalog, { tier: 'member', status: 'active' }, rules).folders]).toEqual(['management'])
})

test('the browser catalog follows the rules too', () => {
  const rules = [{ spaceId: 'sp-kpis', tiers: ['member' as const] }]
  expect(visibleCatalog(catalog, { tier: 'member', status: 'active' }, rules)).toBe(catalog)
})

test('defaultTiers reads a minTier as that tier and up, without owners', () => {
  expect(defaultTiers(undefined)).toEqual(['admin', 'manager', 'member'])
  expect(defaultTiers('manager')).toEqual(['admin', 'manager'])
  expect(defaultTiers('owner')).toEqual([])
})

test('a subspace stays in the workspace with its parent, and goes when its parent is hidden', () => {
  const withSubs: Workspace = {
    spaces: [...workspace.spaces, space('sub-a', null, 'sp-data'), space('sub-b', null, 'sp-kpis'), space('sub-gone', null, 'sp-removed')],
    tabs: [...workspace.tabs, { id: 't4', spaceId: 'sub-a', ref: 'view:dto/data', position: 0, params: null }, { id: 't5', spaceId: 'sub-b', ref: 'widgets', position: 0, params: null }],
    layouts: workspace.layouts
  }
  // A subspace of a space spaces.json no longer lists goes with it.
  const listed = catalogWorkspace(withSubs, catalog)
  expect(listed.spaces.map(s => s.id)).toEqual(['sp-data', 'sp-kpis', 'sub-a', 'sub-b'])
  expect(listed.tabs.map(t => t.id)).toEqual(['t1', 't2', 't3', 't4', 't5'])
  const seen = visibleWorkspace(listed, hiddenFor(catalog, { tier: 'member', status: 'active' }))
  expect(seen.spaces.map(s => s.id)).toEqual(['sp-data', 'sub-a'])
  expect(seen.tabs.map(t => t.id)).toEqual(['t1', 't4'])
})

test('a manual space (added on Settings) stays with its subspaces; a freed spaces.json row does not', () => {
  const manual = 'space-0123456789abcdef0123456789abcdef'
  const withManual: Workspace = {
    spaces: [...workspace.spaces, space(manual, null), space('sub-m', null, manual), space('sp-freed', null)],
    tabs: [...workspace.tabs, { id: 't6', spaceId: manual, ref: 'view:dto/data', position: 0, params: null }],
    layouts: workspace.layouts
  }
  const listed = catalogWorkspace(withManual, catalog)
  expect(listed.spaces.map(s => s.id)).toEqual(['sp-data', 'sp-kpis', manual, 'sub-m'])
  expect(listed.tabs.map(t => t.id)).toEqual(['t1', 't2', 't3', 't6'])
  // No rule: every member sees it. A rule hides it like any space.
  const member = { tier: 'member' as const, status: 'active' as const }
  expect(visibleWorkspace(listed, hiddenFor(catalog, member)).spaces.map(s => s.id)).toContain(manual)
  const ruled = visibleWorkspace(listed, hiddenFor(catalog, member, [{ spaceId: manual, tiers: ['admin'] }]))
  expect(ruled.spaces.map(s => s.id)).not.toContain(manual)
  expect(ruled.spaces.map(s => s.id)).not.toContain('sub-m')
  expect(isManualSpace({ id: 'space-xyz' })).toBe(false)
})

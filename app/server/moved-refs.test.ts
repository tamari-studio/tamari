import { describe, expect, test } from 'bun:test'
import type { CatalogApplet, TabRef } from '../lib/types'
import { hasRepairs, planRefRepairs, type RepairLayout, type RepairTab } from './moved-refs'

const applet = (kind: 'view' | 'widget', ref: string): CatalogApplet => {
  const [folder, name] = ref.split('/') as [string, string]
  return { kind, ref, folder, name, file: '', title: name, requiredEnv: [] }
}
const spaces = [
  { id: 'bb', folder: 'ops' },
  { id: 'mb', folder: 'magic-button' },
  { id: 'kp', folder: 'management' }
]
const tab = (id: string, space_id: string, ref: string, position: number): RepairTab => ({
  id,
  space_id,
  ref: ref as TabRef,
  position
})

describe('planRefRepairs', () => {
  // The Magic Button release: views moved out of ops, tabs left behind.
  const applets = [
    applet('view', 'ops/fondenradar'),
    applet('view', 'magic-button/events'),
    applet('view', 'magic-button/partners'),
    applet('widget', 'magic-button/booth'),
    applet('widget', 'management/scoreboard')
  ]

  test('nothing to do when every ref resolves', () => {
    const tabs = [tab('1', 'bb', 'widgets', 0), tab('2', 'bb', 'view:ops/fondenradar', 1)]
    const layouts: RepairLayout[] = [{ space_id: 'kp', widgets: [{ ref: 'management/scoreboard' }], active_tab: 'widgets' }]
    expect(hasRepairs(planRefRepairs(applets, spaces, tabs, layouts))).toBe(false)
  })

  test("a tab in the view's old home follows it to the new space, after that space's tabs", () => {
    const tabs = [tab('1', 'bb', 'view:ops/events', 1), tab('2', 'mb', 'view:magic-button/partners', 4)]
    const r = planRefRepairs(applets, spaces, tabs, [])
    expect(r.tabs).toEqual([{ id: '1', ref: 'view:magic-button/events', spaceId: 'mb', position: 5 }])
  })

  test('a tab shown from another space keeps its place and gets the new ref', () => {
    const r = planRefRepairs(applets, spaces, [tab('1', 'kp', 'view:ops/events', 2)], [])
    expect(r.tabs).toEqual([{ id: '1', ref: 'view:magic-button/events', spaceId: 'kp', position: 2 }])
  })

  test('a stale tab whose new home already has that tab is deleted', () => {
    const tabs = [tab('1', 'bb', 'view:ops/partners', 1), tab('2', 'mb', 'view:magic-button/partners', 0)]
    const r = planRefRepairs(applets, spaces, tabs, [])
    expect(r.deleteTabs).toEqual(['1'])
    expect(r.tabs).toEqual([])
  })

  test('ambiguous or vanished names are left alone', () => {
    const twice = [...applets, applet('view', 'management/events')]
    const tabs = [tab('1', 'bb', 'view:ops/events', 1), tab('2', 'bb', 'view:ops/gone', 2)]
    expect(hasRepairs(planRefRepairs(twice, spaces, tabs, []))).toBe(false)
  })

  test("a widget on its old home's grid moves to the new space's grid, which gets a widgets tab", () => {
    const layouts: RepairLayout[] = [
      { space_id: 'bb', widgets: [{ ref: 'ops/booth', x: 0, y: 0, w: 2, h: 2 }], active_tab: 'widgets' }
    ]
    const r = planRefRepairs(applets, spaces, [tab('1', 'bb', 'widgets', 0)], layouts)
    expect(r.layouts).toEqual([
      { spaceId: 'bb', widgets: [], activeTab: 'widgets' },
      { spaceId: 'mb', widgets: [{ ref: 'magic-button/booth' }], activeTab: null }
    ])
    expect(r.widgetTabs).toEqual(['mb'])
  })

  test('a widget borrowed by another space is renamed where it sits', () => {
    const layouts: RepairLayout[] = [
      { space_id: 'kp', widgets: [{ ref: 'ops/booth', x: 3, y: 1 }], active_tab: null }
    ]
    const r = planRefRepairs(applets, spaces, [], layouts)
    expect(r.layouts).toEqual([{ spaceId: 'kp', widgets: [{ ref: 'magic-button/booth', x: 3, y: 1 }], activeTab: null }])
    expect(r.widgetTabs).toEqual([])
  })

  test('an active tab follows a rename in place and falls back when its tab moved away', () => {
    const tabs = [tab('1', 'kp', 'view:ops/events', 0), tab('2', 'bb', 'view:ops/partners', 0)]
    const layouts: RepairLayout[] = [
      { space_id: 'kp', widgets: [], active_tab: 'view:ops/events' },
      { space_id: 'bb', widgets: [], active_tab: 'view:ops/partners' }
    ]
    const r = planRefRepairs(applets, spaces, tabs, layouts)
    expect(r.layouts).toEqual([
      { spaceId: 'kp', widgets: [], activeTab: 'view:magic-button/events' },
      { spaceId: 'bb', widgets: [], activeTab: null }
    ])
  })
})

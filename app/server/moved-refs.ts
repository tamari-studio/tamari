// Tabs and widget placements that point at a view or widget a release moved to
// another space. Space code moves by renaming its folder (`ops/events` →
// `magic-button/events`), but `miso.tabs` and `miso.space_layouts` keep the old
// ref, so after the deploy those tabs open nothing. A release can ship at any time, so the
// app repairs them itself the first time it loads the workspace after a deploy.
//
// A stale ref is repaired when exactly one applet of the same kind in this build
// has the same name. A tab or widget that sat in its old home space follows the
// applet to its new home; one shown from another space keeps its place and only
// gets the new ref. Anything ambiguous is left alone (the client already hides
// refs it can't resolve).
import type { CatalogApplet, TabRef, WidgetPlacement } from '../lib/types'

export type RepairSpace = { id: string; folder: string | null }
export type RepairTab = { id: string; space_id: string; ref: TabRef; position: number }
export type RepairLayout = { space_id: string; widgets: WidgetPlacement[] | null; active_tab: string | null }

export type RefRepairs = {
  // Point a tab at the new ref, in `spaceId` (its own space when it stays put).
  tabs: { id: string; ref: TabRef; spaceId: string; position: number }[]
  // Tabs whose repaired ref the target space already has a tab for.
  deleteTabs: string[]
  // The whole new widget list (and active tab) of each layout that changed.
  layouts: { spaceId: string; widgets: WidgetPlacement[]; activeTab: string | null }[]
  // Spaces that receive a widget and have no widgets tab yet.
  widgetTabs: string[]
}

function split(ref: string): { folder: string; name: string } | null {
  const slash = ref.indexOf('/')
  return slash > 0 ? { folder: ref.slice(0, slash), name: ref.slice(slash + 1) } : null
}

export function planRefRepairs(
  applets: CatalogApplet[],
  spaces: RepairSpace[],
  tabs: RepairTab[],
  layouts: RepairLayout[]
): RefRepairs {
  const known = new Set(applets.map(a => `${a.kind}:${a.ref}`))
  const byName = new Map<string, CatalogApplet[]>()
  for (const a of applets) byName.set(`${a.kind}:${a.name}`, [...(byName.get(`${a.kind}:${a.name}`) ?? []), a])
  const spaceOfFolder = new Map(spaces.filter(s => s.folder).map(s => [s.folder as string, s.id]))
  const folderOfSpace = new Map(spaces.map(s => [s.id, s.folder]))

  // The applet a stale `<folder>/<name>` ref now names, and the space it should
  // live in when `spaceId` was its old home.
  function resolve(kind: 'view' | 'widget', ref: string, spaceId: string): { ref: string; spaceId: string } | null {
    if (known.has(`${kind}:${ref}`)) return null
    const old = split(ref)
    if (!old) return null
    const matches = byName.get(`${kind}:${old.name}`) ?? []
    if (matches.length !== 1) return null
    const applet = matches[0] as CatalogApplet
    const wasHome = folderOfSpace.get(spaceId) === old.folder
    return { ref: applet.ref, spaceId: (wasHome && spaceOfFolder.get(applet.folder)) || spaceId }
  }

  const out: RefRepairs = { tabs: [], deleteTabs: [], layouts: [], widgetTabs: [] }

  // Tabs. Positions continue after each target space's last tab.
  const taken = new Set(tabs.map(t => `${t.space_id} ${t.ref}`))
  const nextPosition = new Map<string, number>()
  for (const t of tabs) nextPosition.set(t.space_id, Math.max(nextPosition.get(t.space_id) ?? -1, t.position) + 1)
  const renamedTab = new Map<string, string>() // `${spaceId} ${oldRef}` → new ref, when it stays in that space
  for (const tab of tabs) {
    if (tab.ref === 'widgets') continue
    const fixed = resolve('view', tab.ref.slice('view:'.length), tab.space_id)
    if (!fixed) continue
    const ref = `view:${fixed.ref}` as TabRef
    const key = `${fixed.spaceId} ${ref}`
    if (taken.has(key)) {
      out.deleteTabs.push(tab.id)
      continue
    }
    taken.add(key)
    const moves = fixed.spaceId !== tab.space_id
    const position = moves ? (nextPosition.get(fixed.spaceId) ?? 0) : tab.position
    if (moves) nextPosition.set(fixed.spaceId, position + 1)
    else renamedTab.set(`${tab.space_id} ${tab.ref}`, ref)
    out.tabs.push({ id: tab.id, ref, spaceId: fixed.spaceId, position })
  }

  // Widget placements, and each layout's active tab.
  const widgets = new Map(layouts.map(l => [l.space_id, [...(l.widgets ?? [])]]))
  const changed = new Set<string>()
  for (const layout of layouts) {
    for (const w of layout.widgets ?? []) {
      const fixed = resolve('widget', w.ref, layout.space_id)
      if (!fixed) continue
      const from = widgets.get(layout.space_id) as WidgetPlacement[]
      from.splice(from.findIndex(x => x.ref === w.ref), 1, ...(fixed.spaceId === layout.space_id ? [{ ...w, ref: fixed.ref }] : []))
      changed.add(layout.space_id)
      if (fixed.spaceId === layout.space_id) continue
      const to = widgets.get(fixed.spaceId) ?? []
      widgets.set(fixed.spaceId, to)
      // A placement belongs to its old grid; the new space puts it in the first free spot.
      if (!to.some(x => x.ref === fixed.ref)) to.push({ ref: fixed.ref })
      changed.add(fixed.spaceId)
      if (!taken.has(`${fixed.spaceId} widgets`)) {
        taken.add(`${fixed.spaceId} widgets`)
        out.widgetTabs.push(fixed.spaceId)
      }
    }
  }
  const activeOf = new Map(layouts.map(l => [l.space_id, l.active_tab]))
  for (const layout of layouts) {
    const active = layout.active_tab
    if (!active?.startsWith('view:') || known.has(active)) continue
    // Renamed in place: follow it. Moved away or unresolvable: fall back to the first tab.
    activeOf.set(layout.space_id, renamedTab.get(`${layout.space_id} ${active}`) ?? null)
    changed.add(layout.space_id)
  }
  for (const spaceId of changed) {
    out.layouts.push({ spaceId, widgets: widgets.get(spaceId) ?? [], activeTab: activeOf.get(spaceId) ?? null })
  }
  return out
}

export function hasRepairs(r: RefRepairs): boolean {
  return r.tabs.length + r.deleteTabs.length + r.layouts.length + r.widgetTabs.length > 0
}

// Spaces a tier may not see. A space in spaces.json can set `minTier`; anyone
// below it gets a workspace without that space, a catalog without its views
// and widgets, and refusals from its server functions and files. Same rule as
// app.has_at_least(): a tier only counts while the account is active.
//
// Owners and admins can override that per space on the Space access page
// (miso.space_access): a space with a rule is seen by exactly the tiers,
// departments and people it names, and by owners always, so nobody can lock
// the owners out of a space. A space without a rule keeps its spaces.json
// default.
//
// A single view or widget can set `config.minTier` too (e.g. the health
// space's feedback list, owners and admins only). Below it, that applet is left
// out of the catalog and the workspace and can't be added as a tab or widget;
// the rest of its space, and the space's server functions, stay as they are.
// The view's data is guarded by whatever it reads from, not by this.
//
// Shared by the server (which enforces it) and the browser (which only uses it
// to keep the space's views and widgets out of the add menus).
import { hasAtLeast, TIER_ORDER } from '../vendor/dto-core/tier'
import type { Catalog, Me, MemberTier, SpaceAccessRule, Workspace } from './types'

// Without an id, only the tier counts (e.g. "do admins see it").
export type Viewer = Pick<Me, 'tier' | 'status'> & { id?: string }

export type Hidden = {
  folders: Set<string>
  spaceIds: Set<string>
  viewRefs: Set<string>
  widgetRefs: Set<string>
}

// The tiers a rule can name, most privileged first. Owners see every space.
export const RULE_TIERS: readonly MemberTier[] = TIER_ORDER.filter(tier => tier !== 'owner')

// Who sees a space without a rule: its spaces.json minTier and up, or everyone.
export function defaultTiers(minTier: MemberTier | undefined): MemberTier[] {
  return RULE_TIERS.filter(tier => !minTier || hasAtLeast(tier, 'active', minTier))
}

export function seesSpace(
  viewer: Viewer,
  space: { id: string; minTier?: MemberTier; draft?: true; createdBy?: string },
  rules: ReadonlyMap<string, SpaceAccessRule>
): boolean {
  if (hasAtLeast(viewer.tier, viewer.status, 'owner')) return true
  // A draft, as miso.sees_space() has it: its creator, admins and owners. (The browser still opens it
  // for an admin only on an explicit step: app/client/lib/drafts.ts.)
  if (space.draft) {
    return hasAtLeast(viewer.tier, viewer.status, 'admin') || (viewer.id !== undefined && viewer.id === space.createdBy && viewer.status === 'active' && viewer.tier !== null)
  }
  const rule = rules.get(space.id)
  if (rule) {
    if (viewer.status !== 'active' || viewer.tier === null) return false
    return rule.tiers.includes(viewer.tier) || (viewer.id !== undefined && (rule.members ?? []).includes(viewer.id))
  }
  return !space.minTier || hasAtLeast(viewer.tier, viewer.status, space.minTier)
}

export function ruleMap(rules: readonly SpaceAccessRule[]): Map<string, SpaceAccessRule> {
  return new Map(rules.map(r => [r.spaceId, r]))
}

export function hiddenFor(catalog: Catalog, viewer: Viewer, rules: readonly SpaceAccessRule[] = []): Hidden {
  const byId = ruleMap(rules)
  const spaces = catalog.spaces.filter(s => !seesSpace(viewer, s, byId))
  const folders = new Set(spaces.map(s => s.folder))
  const applets = catalog.applets.filter(
    a => folders.has(a.folder) || (a.minTier !== undefined && !hasAtLeast(viewer.tier, viewer.status, a.minTier))
  )
  // A rule can also name a space this build has no folder for.
  const known = new Set(catalog.spaces.map(s => s.id))
  const extra = rules.filter(r => !known.has(r.spaceId) && !seesSpace(viewer, { id: r.spaceId }, byId)).map(r => r.spaceId)
  return {
    folders,
    spaceIds: new Set([...spaces.map(s => s.id), ...extra]),
    viewRefs: new Set(applets.filter(a => a.kind === 'view').map(a => `view:${a.ref}`)),
    widgetRefs: new Set(applets.filter(a => a.kind === 'widget').map(a => a.ref))
  }
}

// A subspace goes with its parent: hidden when the parent is.
export function isHiddenSpace(hidden: Hidden, space: { id: string; folder?: string | null; parentId?: string | null }): boolean {
  return (
    hidden.spaceIds.has(space.id) ||
    (space.folder != null && hidden.folders.has(space.folder)) ||
    (space.parentId != null && hidden.spaceIds.has(space.parentId))
  )
}

function hidesNothing(hidden: Hidden): boolean {
  return hidden.folders.size === 0 && hidden.viewRefs.size === 0 && hidden.widgetRefs.size === 0
}

export function visibleCatalog(catalog: Catalog, viewer: Viewer, rules: readonly SpaceAccessRule[] = []): Catalog {
  const hidden = hiddenFor(catalog, viewer, rules)
  if (hidesNothing(hidden)) return catalog
  return {
    spaces: catalog.spaces.filter(s => !hidden.folders.has(s.folder)),
    applets: catalog.applets.filter(
      a => !hidden.folders.has(a.folder) && !(a.kind === 'view' ? hidden.viewRefs.has(`view:${a.ref}`) : hidden.widgetRefs.has(a.ref))
    )
  }
}

// The workspace minus hidden spaces, and minus hidden views and widgets that
// were moved onto spaces the viewer does see.
export function visibleWorkspace(workspace: Workspace, hidden: Hidden): Workspace {
  if (hidesNothing(hidden)) return workspace
  const spaces = workspace.spaces.filter(s => !isHiddenSpace(hidden, s))
  const shown = new Set(spaces.map(s => s.id))
  return {
    spaces,
    tabs: workspace.tabs.filter(t => shown.has(t.spaceId) && !hidden.viewRefs.has(t.ref)),
    layouts: workspace.layouts
      .filter(l => shown.has(l.spaceId))
      .map(l => ({ ...l, widgets: l.widgets.filter(w => !hidden.widgetRefs.has(w.ref)) }))
  }
}

// A top-level space an admin added on Settings (miso.create_space): only a row,
// no folder, so it isn't in spaces.json. Its id says so; a spaces.json space
// that was dropped or freed keeps its own id.
export const isManualSpace = (space: { id: string }): boolean => /^space-[0-9a-f]{32}$/.test(space.id)

// Spaces the database still holds that this build's spaces.json doesn't list
// (a folder removed or renamed): no code here backs their views or widgets.
// Manual spaces stay, and so do subspaces of a listed or manual space.
export function catalogWorkspace(workspace: Workspace, catalog: Catalog): Workspace {
  const listed = new Set([...catalog.spaces.map(s => s.id), ...workspace.spaces.filter(isManualSpace).map(s => s.id)])
  const known = new Set(workspace.spaces.filter(s => listed.has(s.id) || (s.parentId != null && listed.has(s.parentId))).map(s => s.id))
  if (workspace.spaces.every(s => known.has(s.id))) return workspace
  return {
    spaces: workspace.spaces.filter(s => known.has(s.id)),
    tabs: workspace.tabs.filter(t => known.has(t.spaceId)),
    layouts: workspace.layouts.filter(l => known.has(l.spaceId))
  }
}

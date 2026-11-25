// Names the shell's screens show for tiers and space folders.
import type { Catalog, MemberTier, Workspace } from '../../lib/types'
import { USAGE_ACTION_LABEL, USAGE_PAGE_LABEL, type UsageAction, type UsagePage } from '../../lib/usage'

export const TIER_LABEL: Record<MemberTier, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', member: 'Member' }

// A space folder's name: the space's (it may have been renamed), else the catalog's, else the folder.
export function folderName(folder: string, workspace: Workspace, catalog: Catalog | undefined): string {
  return workspace.spaces.find(s => s.folder === folder)?.name ?? catalog?.spaces.find(s => s.folder === folder)?.name ?? folder
}

// A usage target (app/lib/usage.ts) as the Usage page shows it: a view's title, a page's or an
// action's name. Anything this build doesn't know shows as itself.
export function usageTargetLabel(target: string, applets: ReadonlyMap<string, { title: string; name: string }>): string {
  if (target === 'widgets') return 'Widgets'
  if (target.startsWith('view:')) return applets.get(target)?.title || target.split('/').pop() || target
  if (target.startsWith('page:')) return USAGE_PAGE_LABEL[target.slice(5) as UsagePage] ?? target.slice(5)
  return USAGE_ACTION_LABEL[target as UsageAction] ?? target
}

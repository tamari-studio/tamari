// The catalog is per person (GET /api/catalog), and so is the workspace. When access changes, the
// workspace learns first (Realtime, a refetch); a catalog that still lists other spaces would show
// a newly opened space's tabs as raw refs. App reads the catalog again when the two disagree.
import { isManualSpace } from '../../lib/access'
import type { Catalog, Workspace } from '../../lib/types'

// Subspaces and manual spaces aren't in the catalog (they have no code of their own), so they don't count.
export function catalogBehind(workspace: Pick<Workspace, 'spaces'>, catalog: Pick<Catalog, 'spaces'>): boolean {
  const seen = new Set(catalog.spaces.map(s => s.id))
  const spaces = workspace.spaces.filter(s => !s.parentId && !isManualSpace(s))
  return spaces.length !== seen.size || spaces.some(s => !seen.has(s.id))
}

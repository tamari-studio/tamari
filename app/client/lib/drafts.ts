// A draft space (a member's own, built over MCP) runs code nobody has reviewed. The database lets
// admins and owners see it, so they can review it, but opened by them it would run with their
// session. So the sidebar, the tab search and the menu list a draft only for its author, and the
// app opens someone else's draft only after an explicit step (components/DraftGate.tsx).
import type { Catalog, Space } from '../../lib/types'

/** Someone else's draft: the build's catalog says the space is a draft made by another person. */
export function isOthersDraft(space: Pick<Space, 'folder'>, catalog: Catalog | undefined, meId: string | undefined): boolean {
  const entry = space.folder ? catalog?.spaces.find(s => s.folder === space.folder) : undefined
  return entry?.draft === true && entry.createdBy !== meId
}

/** The spaces to list: everything the person sees, without other people's drafts. */
export function listedSpaces(spaces: Space[], catalog: Catalog | undefined, meId: string | undefined): Space[] {
  return spaces.filter(s => !isOthersDraft(s, catalog, meId))
}

/**
 * Whether a view or widget may load here, in the space `spaceId`. Someone else's draft runs only
 * inside its own space (where DraftGate came first), never placed in another space's tabs or grid.
 * Fails closed: a folder the catalog doesn't know isn't loaded.
 */
export function appletAccess(
  folder: string,
  spaceId: string,
  catalog: Catalog | undefined,
  meId: string | undefined
): 'wait' | 'run' | 'others-draft' | 'unknown' {
  if (!catalog || meId === undefined) return 'wait'
  const entry = catalog.spaces.find(s => s.folder === folder)
  if (!entry) return 'unknown'
  if (!entry.draft || entry.createdBy === meId || entry.id === spaceId) return 'run'
  return 'others-draft'
}

// Subspaces: a top-level space's child spaces (Space.parentId), one level deep. The sidebar shows
// them folded under their parent; everything else treats a subspace as an ordinary space.
import type { Space } from '../../lib/types'

export function topLevel(spaces: Space[]): Space[] {
  return spaces.filter(s => !s.parentId)
}

export function childrenOf(spaces: Space[], parentId: string): Space[] {
  return spaces.filter(s => s.parentId === parentId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

export function parentOf(spaces: Space[], space: Space): Space | undefined {
  return space.parentId ? spaces.find(s => s.id === space.parentId) : undefined
}

// "Data / Hiring" for a subspace, where its name alone could be any space's.
export function spaceLabel(spaces: Space[], space: Space): string {
  const parent = parentOf(spaces, space)
  return parent ? `${parent.name} / ${space.name}` : space.name
}

// The folder whose views and widgets are "this space's own": a subspace has no code of its own,
// so its parent's.
export function homeFolder(spaces: Space[], space: Space): string | null {
  return space.folder ?? parentOf(spaces, space)?.folder ?? null
}

// Every space in sidebar order: each top-level space followed by its subspaces.
export function inSidebarOrder(spaces: Space[]): Space[] {
  return topLevel(spaces).flatMap(s => [s, ...childrenOf(spaces, s.id)])
}

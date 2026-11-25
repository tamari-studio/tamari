// Where a view's or widget's `focusTab(tab, params)` lands (the bridge in App.tsx), and whether
// it can land at all (`canOpen`). A link to another space's view opens that view in its own
// space and goes there; everything else opens in the space on screen, as before.
import type { CatalogApplet, Space, TabRef } from '../../lib/types'

export type OpenTarget =
  // Open `ref` as a tab of `space` and show it.
  | { kind: 'open'; space: Pick<Space, 'id' | 'slug'>; ref: TabRef }
  // Say `message` instead: `tone` is 'error' when the link itself is wrong.
  | { kind: 'refuse'; message: string; tone: 'info' | 'error' }
  // Nothing to do (no space on screen, or not a tab reference).
  | { kind: 'ignore' }

export type OpenContext = {
  // The space on screen, if any.
  current: Pick<Space, 'id' | 'slug' | 'folder'> | undefined
  // The spaces this person sees.
  spaces: readonly Pick<Space, 'id' | 'slug' | 'folder' | 'name'>[]
  // Views this person may open, and every view the server sent them (GET /api/catalog leaves out
  // views of spaces they don't see), by `view:<folder>/<name>`.
  visible: ReadonlyMap<string, Pick<CatalogApplet, 'title'>>
  all: ReadonlyMap<string, Pick<CatalogApplet, 'title'>>
}

// `fromFolder` is the space folder whose code asked.
export function resolveOpen(fromFolder: string, tab: string, context: OpenContext): OpenTarget {
  const { current, spaces, visible, all } = context
  if (tab === 'agent' || tab === 'scratchpad') return { kind: 'refuse', message: "Chat and the scratchpad aren't part of this app yet.", tone: 'info' }
  if (tab === 'widgets') return current ? { kind: 'open', space: current, ref: 'widgets' } : { kind: 'ignore' }
  if (!tab.startsWith('view:')) return { kind: 'ignore' }

  const name = tab.slice(5)
  const [folder, view] = name.includes('/') ? name.split('/') : [fromFolder, name]
  const ref: TabRef = `view:${folder}/${view}`
  if (!visible.has(ref)) {
    const hidden = all.get(ref)
    return hidden
      ? { kind: 'refuse', message: `You don't have access to ${hidden.title}. Ask an admin or owner if you need it.`, tone: 'info' }
      : { kind: 'refuse', message: `That link points to a view you can't open (${name}): it isn't here any more, or you don't have access to it.`, tone: 'error' }
  }
  // Another space's view opens at home. Without a home this person sees, it opens here, as it always did.
  const home = folder === fromFolder ? undefined : spaces.find(s => s.folder === folder)
  const space = home ?? current
  return space ? { kind: 'open', space, ref } : { kind: 'ignore' }
}

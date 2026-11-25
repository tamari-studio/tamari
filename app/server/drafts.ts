// Server functions of a draft space (CatalogSpace.draft): code a member wrote that nobody has
// reviewed, next to the connector keys and SUPABASE_SECRET_KEY. Its views and widgets run in the
// browser; its *.server.ts functions don't, except a module the build found byte-identical to the
// live space's (`sameModules`, app/build/space-files.ts), which runs as the live space: the code is
// the one already approved. Used by POST /api/rpc (app.ts) and the MCP tools (mcp.ts, callSpace).
import type { Catalog } from '../lib/types'

export const NOT_YET = 'This server function runs once an admin has approved the space. Its views and widgets work already.'

/** null: not a draft, run as asked. 'refuse': a new or changed module of a draft. Otherwise where it runs. */
export function draftCall(catalog: Catalog, folder: string, moduleKey: string): null | 'refuse' | { folder: string; spaceId: string } {
  const space = catalog.spaces.find(s => s.folder === folder)
  if (!space?.draft) return null
  const live = space.draftOf ? catalog.spaces.find(s => s.folder === space.draftOf && !s.draft) : undefined
  if (!live || !space.sameModules?.includes(moduleKey)) return 'refuse'
  return { folder: live.folder, spaceId: live.id }
}

export const DRAFT_ELSEWHERE = "A draft space's views and widgets stay in that draft: nobody has reviewed their code yet."

/**
 * A draft's view or widget ref (`view:folder/name` or `folder/name`) placed in any space but that
 * draft. Refused for everyone: in a shared space it would run in the browser of whoever opens it,
 * with no DraftGate first. The browser refuses to load one there too (client/lib/drafts.ts).
 */
export function draftRefElsewhere(catalog: Catalog, ref: string, spaceId: string): boolean {
  const folder = ref.replace(/^view:/, '').split('/')[0]
  const space = catalog.spaces.find(s => s.folder === folder)
  return space?.draft === true && space.id !== spaceId
}

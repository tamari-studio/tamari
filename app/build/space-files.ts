// The source files of a space's .miso/ folder, for the build. Skips installs
// and dot-folders only: a folder named like `data` can hold code too.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { misoDir } from '../lib/catalog'
import type { Catalog } from '../lib/types'

const skipped = (name: string) => name === 'node_modules' || name.startsWith('.')

// Directories directly under a space's .miso/.
export function sourceDirs(root: string, folder: string): string[] {
  const dir = misoDir(root, folder)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(name => !skipped(name))
    .map(name => join(dir, name))
    .filter(path => statSync(path).isDirectory())
}

// Every `*.server.ts` in a space (not tests), as `<folder>/<module key>`.
export function serverFiles(root: string, folder: string): { key: string; path: string }[] {
  const out: { key: string; path: string }[] = []
  const base = misoDir(root, folder)
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skipped(name)) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.server.ts') && !name.includes('.test.')) {
        out.push({ key: `${folder}/${relative(base, path).replace(/\.server\.ts$/, '')}`, path })
      }
    }
  }
  for (const dir of sourceDirs(root, folder)) walk(dir)
  return out
}

/**
 * For each draft with a live space (`draftOf`), the server modules that are byte-identical to the
 * live space's: only those may run in a draft (server/drafts.ts). Hashed here, at build time, so a
 * request can never claim a module is unchanged.
 */
export function markSameModules(root: string, catalog: Catalog): void {
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
  const modules = (folder: string) => new Map(serverFiles(root, folder).map(f => [f.key.slice(folder.length + 1), hash(f.path)]))
  for (const space of catalog.spaces) {
    if (!space.draft) continue
    const live = space.draftOf ? modules(space.draftOf) : new Map<string, string>()
    space.sameModules = [...modules(space.folder)].filter(([key, sha]) => live.get(key) === sha).map(([key]) => key).sort()
  }
}

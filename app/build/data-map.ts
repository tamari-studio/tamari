// The data map: which space's code names which table, database function,
// shared-records collection or connector env var. Read from the spaces' source
// at build time and bundled with the server, which leaves out spaces the viewer
// doesn't see (GET /api/data-map); it is never part of the catalog (GET /api/catalog).
//
// shortcut: a text scan, so it misses names that aren't written as a literal
// in the call (`.from(table)`, `collection(ATTENDEE_COLLECTION)`) and tables
// reached through a shared package; upgrade to a declared list per space
// (e.g. `data` in spaces.json) if the map drifts from what spaces really use.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { misoDir } from '../lib/catalog'
import { isReservedEnvKey } from '../lib/connectors'
import type { Catalog, DataSourceKind, DataUse } from '../lib/types'
import { sourceDirs } from './space-files'

// `(^|\s)//` and not a bare `//`, which would cut 'https://…' strings short.
const COMMENTS = /\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm
// The closing `)` right after the name keeps `Buffer.from('abc', 'utf8')` out.
const TABLE = /(?:\.schema\(\s*['"`](\w+)['"`]\s*\)\s*)?(?<!\b(?:Array|Buffer|Uint8Array|storage)\s*)\.from\(\s*['"`]([a-z][a-z0-9_]*)['"`]\s*\)/g
const FUNCTION = /\.rpc\(\s*['"`]([a-z][a-z0-9_]*)['"`]/g
const COLLECTION = /\bcollection(?:<[^()]*>)?\(\s*['"`]([a-z0-9][a-z0-9._-]*)['"`]\s*\)/g
const ENV = /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g

export function scanSource(source: string): { kind: DataSourceKind; name: string }[] {
  const code = source.replace(COMMENTS, '$1')
  const found = new Map<string, { kind: DataSourceKind; name: string }>()
  const add = (kind: DataSourceKind, name: string) => found.set(`${kind}:${name}`, { kind, name })
  for (const [, schema, name] of code.matchAll(TABLE)) {
    // miso.records is where collections are kept, not a table of its own.
    if (!(schema === 'miso' && name === 'records')) add('table', name)
  }
  for (const [, name] of code.matchAll(FUNCTION)) add('function', name)
  for (const [, name] of code.matchAll(COLLECTION)) add('collection', name)
  for (const [, name] of code.matchAll(ENV)) add('env', name)
  return [...found.values()]
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    if (name === 'node_modules' || name.startsWith('.')) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !name.includes('.test.') ? [path] : []
  })
}

// One entry per source and space. `applets` are the views and widgets whose own
// file (or its `.server.ts`) names the source; code in shared helpers counts for
// the space only.
export function scanDataMap(root: string, catalog: Catalog): DataUse[] {
  const applets = new Set(catalog.applets.map(a => `${a.kind}:${a.ref}`))
  const uses = new Map<string, DataUse & { seen: Set<string> }>()
  const add = (kind: DataSourceKind, name: string, folder: string, applet?: string) => {
    // Only env names a connector can provide: the rest is the app's own wiring.
    if (kind === 'env' && isReservedEnvKey(name)) return
    const key = `${kind}:${name}:${folder}`
    const use = uses.get(key) ?? { kind, name, folder, applets: [], seen: new Set<string>() }
    uses.set(key, use)
    if (applet && applets.has(applet)) use.seen.add(applet)
  }
  for (const { folder } of catalog.spaces) {
    const base = misoDir(root, folder)
    for (const path of sourceDirs(root, folder).flatMap(sourceFiles)) {
      const [dir, file, ...deeper] = relative(base, path).split('/')
      const kind = dir === 'views' ? 'view' : dir === 'widgets' ? 'widget' : null
      const applet = kind && file && !deeper.length ? `${kind}:${folder}/${file.replace(/(\.server)?\.tsx?$/, '')}` : undefined
      for (const found of scanSource(readFileSync(path, 'utf8'))) add(found.kind, found.name, folder, applet)
    }
  }
  for (const applet of catalog.applets) {
    for (const name of applet.requiredEnv) add('env', name, applet.folder, `${applet.kind}:${applet.ref}`)
  }
  return [...uses.values()]
    .map(({ seen, ...use }) => ({ ...use, applets: [...seen].sort() }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.folder.localeCompare(b.folder))
}

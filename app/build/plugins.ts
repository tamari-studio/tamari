// Bun plugins that let the hosted build compile space code the way local miso
// does (server/bundler/build-applet.ts in the miso repo), but as one app:
//
//   • `.server` imports  → RPC stubs that call /api/rpc/<folder>/<module>/<fn>
//   • `miso` / `moi`      → a runtime bound to the importing file's space
//   • `@miso/dto-core/*`  → the vendored copy in app/vendor/dto-core
//   • `@miso/store`       → packages/store
//   • `@miso/caller`      → packages/caller there too, once the pinned spaces have it
//   • bare packages       → the repo root's node_modules first, so every space
//                           shares one React and the build doesn't depend on
//                           which spaces happen to have node_modules installed.
//                           What the root lacks is resolved from the importer: by
//                           this plugin in the server build, by the bundler itself
//                           in the browser build (see rootResolverPlugin)
import type { BunPlugin } from 'bun'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { APP_ROOT } from '../lib/roots'

export const ROOT = APP_ROOT
const WORKSPACES = join(APP_ROOT, 'workspaces')
const STORE = join(APP_ROOT, 'packages', 'store', 'index.ts')
const CALLER = join(APP_ROOT, 'packages', 'caller', 'index.ts')
const DTO_CORE = join(ROOT, 'app', 'vendor', 'dto-core')
const RUNTIME = join(ROOT, 'app', 'client', 'runtime', 'applet-runtime.ts')
export const RPC = join(ROOT, 'app', 'client', 'runtime', 'rpc.ts')

function real(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

// The space folder and `.miso`-relative path of a file under workspaces/, or
// null for files elsewhere (app code, node_modules).
export function spaceOf(path: string): { folder: string; misoRel: string } | null {
  const rel = relative(real(WORKSPACES), real(path)).split(sep).join('/')
  if (rel.startsWith('..')) return null
  const [folder, misoDir, ...rest] = rel.split('/')
  if (!folder || misoDir !== '.miso' || rest.length === 0) return null
  return { folder, misoRel: rest.join('/') }
}

// Exports of a `.server.ts` file, the way local miso validates them: every
// runtime export must be an async function.
const scanner = new Bun.Transpiler({ loader: 'ts' })
export function serverExports(path: string): string[] {
  const source = readFileSync(path, 'utf8')
  const { exports } = scanner.scan(source)
  return exports.filter(name => !new RegExp(`export\\s+(type|interface)\\s+${name}\\b`).test(source))
}

function resolveDtoCore(specifier: string): string | undefined {
  const sub = specifier === '@miso/dto-core' ? 'index' : specifier.slice('@miso/dto-core/'.length)
  const file = join(DTO_CORE, `${sub}.ts`)
  return existsSync(file) ? file : undefined
}

const BARE = /^(?![./]|[a-z]+:)(@[^/]+\/)?[^/]+/

const BROWSER_CONDITIONS = ['browser', 'import', 'module', 'default']

type ExportsValue = string | null | ExportsValue[] | { [key: string]: ExportsValue }

// The first target an `exports` entry names for the browser conditions, in the entry's own order.
function pickCondition(value: ExportsValue): string | undefined {
  if (typeof value === 'string') return value
  if (!value) return undefined
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = pickCondition(item)
      if (hit) return hit
    }
    return undefined
  }
  for (const [key, inner] of Object.entries(value)) {
    if (!BROWSER_CONDITIONS.includes(key)) continue
    const hit = pickCondition(inner)
    if (hit) return hit
  }
  return undefined
}

// `exports[subpath]`, including one-star patterns (`./icons/*`).
function exportsTarget(exports: ExportsValue, subpath: string): string | undefined {
  if (typeof exports === 'string' || Array.isArray(exports)) return subpath === '.' ? pickCondition(exports) : undefined
  if (!exports) return undefined
  const keys = Object.keys(exports)
  if (!keys.some(key => key.startsWith('.'))) return subpath === '.' ? pickCondition(exports) : undefined
  if (subpath in exports) return pickCondition(exports[subpath])
  for (const key of keys) {
    const star = key.indexOf('*')
    if (star < 0) continue
    const [head, tail] = [key.slice(0, star), key.slice(star + 1)]
    if (!subpath.startsWith(head) || !subpath.endsWith(tail) || subpath.length < head.length + tail.length) continue
    const match = subpath.slice(head.length, subpath.length - tail.length)
    return pickCondition(exports[key])?.replaceAll('*', match)
  }
  return undefined
}

// The ESM build of a root package for a browser bundle. `resolved` is where Bun.resolveSync put
// it (the node conditions, which for @tabler/icons-react is a CommonJS build the
// bundler can't tree-shake: the whole icon set ended up in the first page load). Falls back to
// `resolved` when the package says nothing more specific.
export function browserEntry(specifier: string, resolved: string): string {
  const name = specifier.match(/^(@[^/]+\/)?[^/]+/)![0]
  const subpath = specifier === name ? '.' : `.${specifier.slice(name.length)}`
  let dir = dirname(resolved)
  while (!dir.endsWith(`${sep}node_modules${sep}${name.split('/').join(sep)}`)) {
    const up = dirname(dir)
    if (up === dir) return resolved
    dir = up
  }
  let manifest: { exports?: ExportsValue; module?: string; browser?: unknown }
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  } catch {
    return resolved
  }
  const target =
    manifest.exports !== undefined
      ? exportsTarget(manifest.exports, subpath)
      : subpath === '.'
        ? (typeof manifest.browser === 'string' ? manifest.browser : undefined) ?? manifest.module
        : undefined
  if (!target) return resolved
  const file = join(dir, target)
  return existsSync(file) && statSync(file).isFile() ? file : resolved
}

const TABLER = /^@tabler\/icons-react$/
const TABLER_IMPORT = /\b(import|export)\s+(type\s+)?(\*|\{([^}]*)\})\s*(?:as\s+\w+\s*)?from\s*['"]@tabler\/icons-react['"]/g
const SOURCE_FILE = /\.(tsx?|jsx?|mjs)$/

function sourceFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.') && entry.name !== '.miso') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, out)
    else if (SOURCE_FILE.test(entry.name)) out.push(path)
  }
  return out
}

// The names app and space code import from '@tabler/icons-react', or null when something imports
// the whole namespace (`import * as`), which needs the real barrel.
export function tablerNames(files: string[]): Set<string> | null {
  const names = new Set<string>()
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('@tabler/icons-react')) continue
    for (const m of source.matchAll(TABLER_IMPORT)) {
      if (m[2]) continue
      if (m[3] === '*') return null
      for (const part of m[4]!.split(',')) {
        const spec = part.trim()
        if (!spec || spec.startsWith('type ')) continue
        names.add(spec.split(/\s+as\s+/)[0]!.trim())
      }
    }
  }
  return names
}

// A stand-in for '@tabler/icons-react' that re-exports only `names`, each from its own icon file.
// The package's ESM barrel re-exports all ~6,200 icons, and parsing it costs the bundler seconds
// per build; its CommonJS build (what Bun.resolveSync picks) can't be tree-shaken at all.
export function tablerModule(names: Set<string>, esmDir: string): string {
  const barrel = readFileSync(join(esmDir, 'tabler-icons-react.mjs'), 'utf8')
  const fileOf = new Map<string, string>()
  for (const m of barrel.matchAll(/^export \{([^}]*)\} from '\.\/([^']+)';$/gm)) {
    for (const part of m[1]!.split(',')) {
      const [, exported] = part.trim().match(/^default as (\w+)$/) ?? []
      if (exported) fileOf.set(exported, join(esmDir, m[2]!))
    }
  }
  const lines: string[] = []
  const rest: string[] = []
  for (const name of [...names].sort()) {
    const file = fileOf.get(name)
    if (file) lines.push(`export { default as ${name} } from ${JSON.stringify(file)}`)
    else rest.push(name)
  }
  if (rest.length) lines.push(`export { ${rest.join(', ')} } from ${JSON.stringify(join(esmDir, 'tabler-icons-react.mjs'))}`)
  return `${lines.join('\n')}\n`
}

function tablerPlugin(build: Parameters<BunPlugin['setup']>[0]): void {
  let contents: string | null | undefined
  build.onResolve({ filter: TABLER }, args => {
    if (contents === undefined) {
      const names = tablerNames([...sourceFiles(join(ROOT, 'app', 'client')), ...sourceFiles(WORKSPACES)])
      const resolved = Bun.resolveSync(args.path, ROOT)
      const esmDir = dirname(browserEntry(args.path, resolved))
      contents = names && existsSync(join(esmDir, 'icons')) ? tablerModule(names, esmDir) : null
    }
    if (contents === null) return undefined
    return { path: 'icons', namespace: 'miso-tabler' }
  })
  build.onLoad({ filter: /.*/, namespace: 'miso-tabler' }, () => ({ contents: contents!, loader: 'js' }))
}

// Matches a bare import of a package in the root's node_modules, and of nothing else.
function rootPackages(): RegExp {
  const dir = join(ROOT, 'node_modules')
  const names: string[] = []
  const list = (path: string) => (existsSync(path) ? readdirSync(path).filter(name => !name.startsWith('.')) : [])
  for (const name of list(dir)) {
    if (name.startsWith('@')) names.push(...list(join(dir, name)).map(sub => `${name}/${sub}`))
    else names.push(name)
  }
  if (names.length === 0) return /^(?!)/
  return new RegExp(`^(?:${names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:/.*)?$`)
}

// `target` is the Bun.build target the plugin is used in. Bun.resolveSync only knows the
// node/bun export conditions, so in a browser build it would hand a space's package its Node
// build (fflate's imports `module` and worker_threads). There the plugin only pins what the
// root provides, at its browser entry (browserEntry), and leaves the rest to the bundler, which
// resolves with the browser conditions. "Leaves" means the plugin is never asked (rootPackages):
// when a resolver is asked about a package marked `sideEffects: false` and has no answer, Bun 1.3
// drops the import without an error, and it is undefined in the browser.
export function rootResolverPlugin(
  options: { target?: 'browser' | 'bun'; onUnresolved?: (spec: string) => void } = {}
): BunPlugin {
  const searchFrom = (importer: string) => (options.target === 'browser' ? [ROOT] : [ROOT, dirname(importer)])
  return {
    name: 'miso-root-resolver',
    setup(build) {
      if (options.target === 'browser') tablerPlugin(build)
      build.onResolve({ filter: /^@miso\/store$/ }, () => ({ path: STORE }))
      // Spaces pinned before packages/caller existed don't import it; left unresolved, a
      // stray import fails the build as any unknown package would.
      build.onResolve({ filter: /^@miso\/caller$/ }, () => (existsSync(CALLER) ? { path: CALLER } : undefined))
      build.onResolve({ filter: /^@miso\/dto-core(\/.*)?$/ }, args => {
        const path = resolveDtoCore(args.path)
        return path ? { path } : undefined
      })
      build.onResolve({ filter: options.target === 'browser' ? rootPackages() : BARE }, args => {
        if (args.path === 'miso' || args.path === 'moi' || args.path.startsWith('bun')) return undefined
        for (const from of searchFrom(args.importer)) {
          try {
            const path = Bun.resolveSync(args.path, from)
            // A Node built-in resolves to its own name, which is not a file for the bundler.
            if (isAbsolute(path)) return { path: options.target === 'browser' ? browserEntry(args.path, path) : path }
          } catch {
            // Try the next place.
          }
        }
        if (options.target === 'browser' || !options.onUnresolved) return undefined
        options.onUnresolved(args.path)
        // Not a bare external: on Vercel, with no node_modules beside the bundle, Bun would try to
        // auto-install a bare require at runtime, which dies on the read-only filesystem (EROFS)
        // and takes the whole function down, try/catch or not. A module that throws keeps the
        // old promise (only the module that needs the package fails, when called) and lets an
        // optional require inside try/catch fall back as its author meant.
        return { path: args.path, namespace: 'miso-missing' }
      })
      build.onLoad({ filter: /.*/, namespace: 'miso-missing' }, args => ({
        contents: `throw new Error(${JSON.stringify(`${args.path} is not installed in the hosted app`)})`,
        loader: 'js'
      }))
    }
  }
}

// Browser-only: turn `.server` imports into RPC stubs and bind `miso`/`moi` to
// the importing file's space.
export function appletRuntimePlugin(): BunPlugin {
  return {
    name: 'miso-applet-runtime',
    setup(build) {
      build.onResolve({ filter: /^(miso|moi)$/ }, args => {
        const space = spaceOf(args.importer)
        return { path: space?.folder ?? '_', namespace: 'miso-runtime' }
      })
      build.onLoad({ filter: /.*/, namespace: 'miso-runtime' }, args => ({
        loader: 'js',
        contents: [
          `import { runtimeFor } from ${JSON.stringify(RUNTIME)};`,
          `const runtime = runtimeFor(${JSON.stringify(args.path)});`,
          `export const fileUrl = runtime.fileUrl;`,
          `export const apiFetch = runtime.apiFetch;`,
          `export const focusTab = runtime.focusTab;`,
          `export const canOpen = runtime.canOpen;`,
          `export const sendChatMessage = runtime.sendChatMessage;`
        ].join('\n')
      }))

      build.onResolve({ filter: /\.server(\.[jt]s)?$/ }, args => {
        if (!args.path.startsWith('.')) return undefined
        return {
          path: join(dirname(args.importer), args.path.replace(/\.server(\.[jt]s)?$/, '.server.ts')),
          namespace: 'miso-server-proxy'
        }
      })
      // Fails closed: a `.server.ts` file the stub above didn't catch (a bare or
      // absolute import) would put server code in the browser bundle.
      build.onLoad({ filter: /\.server\.ts$/ }, args => {
        throw new Error(`${args.path} is server code: import it with a relative path ending in .server, so the browser gets a stub.`)
      })
      build.onLoad({ filter: /.*/, namespace: 'miso-server-proxy' }, args => {
        const space = spaceOf(args.path)
        if (!space) throw new Error(`${args.path} is outside every space's .miso folder`)
        const moduleKey = space.misoRel.replace(/\.server\.ts$/, '')
        const names = serverExports(args.path)
        return {
          loader: 'js',
          contents: [
            `import { rpc } from ${JSON.stringify(RPC)};`,
            ...names.map(
              name =>
                `export const ${name} = rpc(${JSON.stringify(space.folder)}, ${JSON.stringify(moduleKey)}, ${JSON.stringify(name)});`
            )
          ].join('\n')
        }
      })
    }
  }
}

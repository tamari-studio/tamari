// The build's guard for draft spaces (CatalogSpace.draft): code a member wrote that nobody has
// reviewed. The build runs next to the database's secret key and writes the server bundle, so
// nothing in a draft may make the build run code or read a file outside the draft:
//
//   • no import attributes (`with { type: 'macro' }` runs a module inside the build), and no
//     specifier with a scheme (`macro:./x.ts` does the same) other than node:;
//   • relative and absolute imports stay inside the draft's own .miso/ (Bun's file loader copies
//     any file it reaches into the bundle the member downloads);
//   • bare imports only for what the app has installed or the app put in the draft's node_modules
//     (server/space-packages.ts: its live space's packages, stand-ins for packages it adds), never
//     a draft's own tsconfig paths; files in that node_modules are checked as packages
//     (build/package-guard.ts);
//   • no .css (Tailwind's @plugin and @config load JavaScript at build time);
//   • import() and require() only with a fixed path, and no JSX pragma (it makes Bun import
//     `<source>/jsx-runtime` itself), so every import is one this check reads.
//
// It reads each draft file's syntax tree in onLoad, before Bun parses it. Only onLoad, and only
// for paths inside a draft: a catch-all onResolve hook, even one that changes nothing, makes Bun
// 1.3 emit bundles that throw on load ("util3 is not defined").
//
// A draft copy of a live space (a proposal, server/proposals.ts: `draftOf` and `baseCommit`) starts
// as the live space's own files, which an admin wrote and which may break these rules (a stylesheet,
// a tsconfig). A copy's file that is byte for byte the live space's file at the copy's starting
// commit is code an admin already put live, so it may import what the live file imports. It is
// still refused when it could make the build run code that, in the copy, the member controls:
// import attributes, scheme imports, JSX pragmas, imports without a fixed path, and a stylesheet
// that loads other files. Anything the member wrote is checked in full.
// Compared with the starting commit, not today's live files: an admin's later edit to the live space
// must not make every copy of it fail the build.
//
// A file that breaks a rule fails the build, so the change that brought it is put back
// (server/space-files.ts, runChange) with these words.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { BunPlugin } from 'bun'
import ts from 'typescript'
import { misoDir } from '../lib/catalog'
import { packageFileProblems } from './package-guard'
import type { Catalog } from '../lib/types'

const BUILTINS = new Set(builtinModules)
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

const real = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

const inside = (dir: string, path: string) => path === dir || path.startsWith(dir + sep)

/** The real path of each draft's .miso/ folder. */
export function draftDirs(root: string, catalog: Catalog): string[] {
  return catalog.spaces.filter(s => s.draft).map(s => real(misoDir(root, s.folder)))
}

/** What's wrong with a bare specifier from a draft, or null. `installed`: a package the app has. */
export function bareProblem(spec: string, installed: (name: string) => boolean): string | null {
  if (spec.startsWith('node:')) return null
  if (SCHEME.test(spec)) return `${spec}: an import with a scheme (such as macro:) isn't allowed in a draft.`
  if (spec.split('/').some(part => part === '..' || part === '.')) return `${spec}: a package path can't step out with .. in a draft.`
  const name = spec.match(/^(@[^/]+\/)?[^/]+/)?.[0] ?? spec
  if (name === 'miso' || name === 'moi' || name.startsWith('@miso/') || BUILTINS.has(name) || installed(name)) return null
  return `${spec}: no package of that name is installed for this draft. Add it to the draft's .miso/package.json: it is installed once an admin approves the draft.`
}

/**
 * What's wrong with a draft file, as sentences; none when it is fine. `dir`: the draft's .miso/
 * folder (a real path), which relative and absolute imports must stay in.
 */
export function draftSourceProblems(
  file: string,
  source: string,
  { dir, installed, started = false }: { dir: string; installed: (name: string) => boolean; started?: boolean }
): string[] {
  const ext = extname(file)
  const kind = ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : ext.endsWith('ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const problems: string[] = []
  // Parsed differently by the build than here is a way past this check: refuse what doesn't parse.
  const parseErrors = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []
  if (parseErrors.length) problems.push("the file doesn't parse as TypeScript.")
  // A JSX pragma makes Bun import `<source>/jsx-runtime` itself, an import no syntax node shows.
  if (/@jsx(ImportSource|Runtime|Frag)?\b/.test(source)) problems.push('JSX pragmas (@jsx, @jsxImportSource, @jsxRuntime, @jsxFrag) are not allowed in a draft.')
  const from = dirname(real(file))
  const specifier = (spec: string) => {
    // A file as the live space had it (`started`) may import what the live file imports: its
    // stylesheets, files outside .miso/, packages by its own names. Every file it reaches inside the
    // copy goes through this guard itself. What makes the build run code stays refused.
    if (started) {
      if (SCHEME.test(spec) && !spec.startsWith('node:')) problems.push(`${spec}: an import with a scheme (such as macro:) isn't allowed in a draft.`)
      return
    }
    if (/\.css(\?.*)?$/i.test(spec)) problems.push(`${spec}: a draft has no stylesheets of its own. Style with Tailwind classes.`)
    else if (spec.startsWith('.') || isAbsolute(spec)) {
      const target = resolve(from, spec)
      if (!inside(dir, target) || !inside(dir, real(target))) problems.push(`${spec}: a draft imports only files in its own .miso/ folder.`)
    } else {
      const problem = bareProblem(spec, installed)
      if (problem) problems.push(problem)
    }
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (node.attributes) problems.push('import attributes (with { type: ... }) are not allowed in a draft.')
      if (ts.isStringLiteral(node.moduleSpecifier)) specifier(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression
      if (ts.isStringLiteral(expr)) specifier(expr.text)
      else problems.push('require() takes a fixed path in a draft.')
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      // require(), and the forms the bundler resolves like it: require.resolve() copies the file it
      // names into the bundle (checked through app/build.ts), import.meta.require/resolve too.
      const callee = node.expression.getText(sf).replace(/\s+/g, '')
      const isRequire = ['require', 'require.resolve', 'import.meta.require', 'import.meta.resolve'].includes(callee)
      if (isImport || isRequire) {
        const [arg, ...rest] = node.arguments
        if (rest.length) problems.push('import() takes only a path in a draft, no options.')
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) specifier(arg.text)
        else problems.push(`${isImport ? 'import()' : 'require()'} takes a fixed path in a draft.`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...new Set(problems)]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** git's id for a file's bytes. */
export const blobSha = (bytes: Uint8Array): string => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')

/**
 * For each draft copy (`draftOf` and `baseCommit`), keyed by the real path of its .miso/ folder: each
 * file of the live space's .miso/ at the starting commit, by its path inside .miso/, with git's id
 * for its bytes. Empty for a copy whose commit git can't read, so nothing passes unchecked.
 */
export function startingFiles(root: string, catalog: Catalog, git = gitLsTree): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const space of catalog.spaces) {
    if (!space.draft || !space.draftOf || !space.baseCommit) continue
    const files = new Map<string, string>()
    if (/^[0-9a-f]{40}$/.test(space.baseCommit)) {
      const prefix = `${space.draftOf}/.miso/`
      for (const line of git(join(root, 'workspaces'), space.baseCommit, prefix).split('\n')) {
        const m = line.match(/^\d+ blob ([0-9a-f]{40})\t(.+)$/)
        if (m && m[2].startsWith(prefix)) files.set(m[2].slice(prefix.length), m[1])
      }
    }
    out.set(real(misoDir(root, space.folder)), files)
  }
  return out
}

function gitLsTree(cwd: string, commit: string, prefix: string): string {
  const r = Bun.spawnSync(['git', 'ls-tree', '-r', commit, '--', prefix], { cwd, stderr: 'pipe' })
  return r.success ? r.stdout.toString() : ''
}

/** The guard, first in the client build's plugins (app/build.ts). */
export function draftGuardPlugin(root: string, catalog: Catalog, installed: (name: string) => boolean): BunPlugin {
  const dirs = draftDirs(root, catalog)
  const starting = startingFiles(root, catalog)
  return {
    name: 'miso-draft-guard',
    setup(build) {
      if (!dirs.length) return
      // Bun hands onLoad real paths. Only code and stylesheets: an onLoad hook that matches a file
      // Bun loads as an asset (an .svg) and hands it back makes Bun 1.3.14 crash. checkPath allows
      // no other kinds of file to be written.
      const filter = new RegExp(`^(${dirs.map(escape).join('|')})${escape(sep)}.*\\.([cm]?[jt]sx?|css)$`, 'i')
      build.onLoad({ filter }, async args => {
        const dir = dirs.find(d => inside(d, args.path))!
        const bytes = readFileSync(args.path)
        // The draft's node_modules: what the app put there (server/space-packages.ts), checked as
        // any space's packages are.
        if (inside(join(dir, 'node_modules'), args.path)) {
          const problems = packageFileProblems(args.path, bytes.toString('utf8'))
          if (problems.length) throw new Error(`${args.path}: ${problems.join(' ')}`)
          return undefined
        }
        // A package the app has, or one in the draft's own node_modules, which only the app writes:
        // a copy of what its live space has installed, and stand-ins for what the draft adds.
        const installedHere = (name: string) => installed(name) || existsSync(join(dir, 'node_modules', name, 'package.json'))
        const started = starting.get(dir)?.get(relative(dir, args.path).split(sep).join('/'))
        const text = bytes.toString('utf8')
        if (started && started === blobSha(bytes)) {
          // A stylesheet as the live space had it, as long as it loads nothing: Tailwind reads what
          // @import, @plugin, @config and @reference name itself, past this guard, and those files
          // in a copy are the member's.
          if (/\.css$/i.test(args.path)) {
            if (/@(import|plugin|config|reference)\b/i.test(text)) throw new Error(`${args.path}: a stylesheet in a draft copy that loads other files (@import, @plugin, @config, @reference) can't be built. Ask an admin to change the space itself.`)
            return undefined
          }
          const problems = draftSourceProblems(args.path, text, { dir, installed: installedHere, started: true })
          if (problems.length) throw new Error(`${args.path}: ${problems.join(' ')}`)
          return undefined
        }
        if (/\.css$/i.test(args.path)) throw new Error(`${args.path}: a draft has no stylesheets of its own. Style with Tailwind classes.`)
        const problems = draftSourceProblems(args.path, text, { dir, installed: installedHere })
        if (problems.length) throw new Error(`${args.path}: ${problems.join(' ')}`)
        return undefined
      })
    }
  }
}

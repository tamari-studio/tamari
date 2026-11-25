// The build's guard for a space's own packages (server/space-packages.ts installs them into
// workspaces/<space>/.miso/node_modules in the Compose install). Bun already refuses macros from
// node_modules, but a package's code can still make the bundler read any file it can reach: an
// `import x from '/proc/self/environ' with { type: 'text' }` puts the build's environment, keys
// included, in a bundle every member downloads. And Tailwind runs JavaScript a stylesheet names.
// So each code file and stylesheet of a space's packages that the browser build loads must:
//
//   • import by path only inside that space's node_modules (relative or absolute), and with no
//     scheme but node: and bun:; bare package names are fine (each package is checked as it loads);
//   • use no import attributes but `type: 'json'`;
//   • parse, so this check reads what the bundler reads;
//   • for a stylesheet: plain CSS at-rules only (no @import, @plugin, @config, @source, @reference),
//     and url() only inside node_modules (or data: and web addresses), without escapes.
//
// app/build.ts also checks the bundle's metafile afterwards (bundleInputProblems): what the bundler
// read, however it got there.
//
// A dynamic import() or require() without a fixed path is left to the metafile check: Bun may fold it
// to a constant path and read that file.
//
// Only onLoad, filtered to code and stylesheets (see build/draft-guard.ts for why).
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import type { BunPlugin } from 'bun'
import ts from 'typescript'

const SCHEME = /^[a-z][a-z0-9+.-]*:/i

const real = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

const inside = (dir: string, path: string) => path === dir || path.startsWith(dir + sep)

/** The space's node_modules folder a file is in (`…/<space>/.miso/node_modules`), or null. */
export function packagesRoot(file: string): string | null {
  const parts = file.split(sep)
  const at = parts.findIndex((part, i) => part === 'node_modules' && parts[i - 1] === '.miso')
  return at < 0 ? null : parts.slice(0, at + 1).join(sep)
}

function pathProblem(spec: string, from: string, root: string): string | null {
  if (spec.startsWith('node:') || spec.startsWith('bun:')) return null
  if (SCHEME.test(spec)) return `${spec}: a package's import with a scheme isn't allowed.`
  // Bun follows an HTML file's src and href itself, past this guard.
  if (/\.html?([?#].*)?$/i.test(spec)) return `${spec}: a package may not import HTML.`
  if (spec.startsWith('.') || isAbsolute(spec)) {
    const target = resolve(from, spec)
    if (!inside(root, target) || !inside(root, real(target))) return `${spec}: a package imports a file outside the space's packages.`
  } else if (spec.split(/[\\/]/).some(part => part === '..' || part === '.')) return `${spec}: a package name can't step out with .. .`
  return null
}

/** What's wrong with a code file of a space's packages, as sentences; none when it is fine. */
export function packageCodeProblems(file: string, source: string, root: string): string[] {
  const ext = extname(file)
  const kind = ext === '.tsx' ? ts.ScriptKind.TSX : ext === '.jsx' ? ts.ScriptKind.JSX : /^\.[cm]?ts$/.test(ext) ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const problems: string[] = []
  const parseErrors = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []
  if (parseErrors.length) problems.push("the file doesn't parse, so the build can't check what it imports.")
  // A JSX pragma makes Bun import `<source>/jsx-runtime` itself, an import no syntax node shows.
  if (/@jsx(ImportSource|Runtime|Frag)?\b/.test(source)) problems.push("JSX pragmas aren't allowed in a space's packages.")
  const from = dirname(real(file))
  const specifier = (spec: string) => {
    const problem = pathProblem(spec, from, root)
    if (problem) problems.push(problem)
  }
  const attributes = (node: ts.ImportAttributes | undefined) => {
    if (!node) return
    const onlyJson = node.elements.length === 1 && node.elements[0]!.name.getText(sf).replace(/['"]/g, '') === 'type' && ts.isStringLiteral(node.elements[0]!.value) && node.elements[0]!.value.text === 'json'
    if (!onlyJson) problems.push("import attributes other than { type: 'json' } aren't allowed in a space's packages.")
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      attributes(node.attributes)
      if (ts.isStringLiteral(node.moduleSpecifier)) specifier(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const expr = node.moduleReference.expression
      if (ts.isStringLiteral(expr)) specifier(expr.text)
    } else if (ts.isImportTypeNode(node)) {
      // A type only; the bundler never loads it.
    } else if (ts.isCallExpression(node)) {
      const isImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const callee = node.expression.getText(sf).replace(/\s+/g, '')
      const isRequire = ['require', 'require.resolve', 'import.meta.require', 'import.meta.resolve', 'module.require'].includes(callee)
      if (isImport || isRequire) {
        const [arg, options] = node.arguments
        // import(x, { with: { type: 'macro' } }): only a type of json passes.
        if (isImport && options) {
          const text = options.getText(sf).replace(/\s+/g, '')
          if (!/^\{(with|assert):\{type:['"]json['"]\}\}$/.test(text)) problems.push("import() options other than { with: { type: 'json' } } aren't allowed in a space's packages.")
        }
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) specifier(arg.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return [...new Set(problems)]
}

// The at-rules a package's stylesheet may use: plain CSS. Tailwind reads @import, @plugin, @config,
// @source and @reference itself (past this guard and the bundler's metafile), so none of them, in any
// spelling: at-rules are read the way a CSS parser reads them (cssAtRules: comments and strings
// skipped as wholes), and an escape in the name is refused too.
const CSS_AT_RULES = new Set(['media', 'font-face', 'keyframes', '-webkit-keyframes', '-moz-keyframes', 'supports', 'charset', 'layer', 'page', 'container', 'namespace', 'counter-style', 'font-feature-values', 'property', 'scope', 'starting-style', '-moz-document', 'document', 'viewport', '-ms-viewport'])

/**
 * The names of a stylesheet's at-rules, as a CSS parser finds them: outside comments and strings, the
 * name up to the first character that ends it (an escape stays in the name, so it is refused).
 * Null for an unclosed comment or string, which parsers read differently.
 */
export function cssAtRules(css: string): string[] | null {
  const names: string[] = []
  for (let i = 0; i < css.length; i++) {
    const c = css[i]!
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      if (end < 0) return null
      i = end + 1
    } else if (c === '"' || c === "'") {
      let j = i + 1
      while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1
      if (css[j] !== c) return null
      i = j
    } else if (c === '\\') i++
    else if (c === '@') {
      let j = i + 1
      while (j < css.length && /[^\s{};,()"'/]/.test(css[j]!)) j++
      names.push(css.slice(i + 1, j))
      i = j - 1
    }
  }
  return names
}

/** What's wrong with a stylesheet of a space's packages, as sentences; none when it is fine. */
export function packageCssProblems(file: string, source: string, root: string): string[] {
  const problems: string[] = []
  const names = cssAtRules(source)
  const wrong = names === null ? 'an unclosed comment or string' : names.find(name => !CSS_AT_RULES.has(name.toLowerCase()))
  if (wrong !== undefined) {
    problems.push(`${names === null ? wrong : `@${wrong.slice(0, 40)}`}: a package's stylesheet uses only plain CSS at-rules (no @import, @plugin, @config, @source or @reference: Tailwind reads or runs what they name).`)
  }
  // url() and image-set() load files: only plain paths inside the packages. Escapes are refused, so the
  // path read here is the path the bundler reads (the bundle's metafile is checked as well, app/build.ts).
  const from = dirname(real(file))
  for (const m of source.matchAll(/(url|image-set|-webkit-image-set)\(([^)]*)\)/gi)) {
    const inner = m[2]!
    if (inner.includes('\\')) {
      problems.push(`${m[0]!.slice(0, 60)}: a package's stylesheet can't use escapes in url().`)
      continue
    }
    const targets = m[1]!.toLowerCase() === 'url' ? [inner.trim().replace(/^(['"])(.*)\1$/, '$2')] : [...inner.matchAll(/(['"])(.*?)\1/g)].map(t => t[2]!)
    for (const target of targets) {
      if (!target || target.startsWith('#') || /^(data|https?):/i.test(target)) continue
      if (SCHEME.test(target)) problems.push(`${target}: a package's stylesheet loads only its own files.`)
      else {
        const path = resolve(from, target.split(/[?#]/)[0]!)
        if (isAbsolute(target) || !inside(root, path) || !inside(root, real(path))) problems.push(`${target}: a package's stylesheet loads only files inside the space's packages.`)
      }
    }
  }
  return [...new Set(problems)]
}

type Metafile = { inputs: Record<string, { imports?: { path: string; kind?: string; external?: boolean }[] }> }

/**
 * After the client build, from Bun's metafile: every file the bundle read must be inside the app
 * (`root`), never in the spaces' .git, and a file of a space's packages may only have pulled in
 * files of the same packages or of the app's own node_modules. Catches what a pattern check can miss
 * (a path the bundler worked out itself, an HTML file's src, a CSS escape). `cwd`: what the
 * metafile's paths are relative to.
 */
export function bundleInputProblems(metafile: Metafile, { root, cwd }: { root: string; cwd: string }): string[] {
  const problems: string[] = []
  const appModules = join(root, 'node_modules')
  const spacesGit = join(root, 'workspaces', '.git')
  const isPath = (p: string) => isAbsolute(p) || p.startsWith('.')
  for (const [key, input] of Object.entries(metafile.inputs ?? {})) {
    if (!isPath(key) && SCHEME.test(key)) continue
    const file = resolve(cwd, key)
    if (!inside(root, file) || inside(spacesGit, file)) problems.push(`${key}: the build read a file outside the app.`)
    const packages = packagesRoot(file)
    if (!packages) continue
    for (const edge of input.imports ?? []) {
      if (edge.external || (!isPath(edge.path) && SCHEME.test(edge.path)) || /^(data|https?):/i.test(edge.path) || edge.path.startsWith('#')) continue
      if (!isPath(edge.path)) continue
      const target = resolve(dirname(file), edge.path)
      if (!inside(packages, target) && !inside(appModules, target)) problems.push(`${key}: a package pulled ${edge.path} into the bundle, outside the space's packages.`)
    }
  }
  return [...new Set(problems)]
}

/** The checks for one loaded file of a space's packages; none when it is fine. */
export function packageFileProblems(file: string, source: string): string[] {
  const root = packagesRoot(file)
  if (!root) return []
  const realRoot = real(root)
  return /\.css$/i.test(file) ? packageCssProblems(file, source, realRoot) : packageCodeProblems(file, source, realRoot)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The guard, in the client build's plugins (app/build.ts). `workspaces`: the spaces folder. */
export function packageGuardPlugin(workspaces: string): BunPlugin {
  const filter = new RegExp(`^${escape(real(workspaces))}${escape(sep)}[^${escape(sep)}]+${escape(join(sep, '.miso', 'node_modules', ''))}.*\\.([cm]?[jt]sx?|css)$`, 'i')
  return {
    name: 'miso-package-guard',
    setup(build) {
      build.onLoad({ filter }, args => {
        const problems = packageFileProblems(args.path, readFileSync(args.path, 'utf8'))
        if (problems.length) throw new Error(`${args.path}: ${problems.join(' ')}`)
        return undefined
      })
    }
  }
}

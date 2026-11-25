// Packages for the spaces of the Compose install (server/spaces-volume.ts): a space may list npm
// packages in its own .miso/package.json, and the app installs them into .miso/node_modules before
// every build that needs it (cli/selfhost.ts, build()). Only there: `bun run dev`, `bun run build`
// and Vercel install a space's packages with scripts/install-spaces.ts as before.
//
// A space's package.json is hostile input (a member writes it over MCP, an admin approves it), so:
//
//   • it is read with an allowlist: only name, version, private, description and dependencies, each
//     dependency a plain registry name and an exact version or a ^/~ range, at most DEPS_MAX, and the
//     file exactly as JSON.stringify(…, null, 2) writes it (one meaning, the one the review shows);
//   • bun never runs on the space's own files: the app writes its own package.json (just those
//     dependencies, no trusted packages) into a folder of its own in the volume's .git/, with a
//     bunfig.toml that names the npm registry, and runs `bun install --ignore-scripts` there with no
//     environment but PATH and an empty HOME (no keys, no .npmrc, no token);
//   • the lockfile it made must name registry packages only (an exact version, the default registry,
//     a sha512), and the installed tree must have no links, no paths in a package.json that leave the
//     package, and stay under SIZE_MAX; .bin folders and config files bun or tsc would read go;
//   • only then the folder replaces .miso/node_modules. Tamari's own spaces are left alone: their
//     packages come with the image, installed from their lockfile.
//
// A failed install fails the build, so the change that brought it is put back
// (server/space-files.ts, runChange), and the build after the put-back takes the space's previous
// node_modules back from .git/ without the network.
//
// Drafts (a member's code nobody reviewed) get nothing installed. A draft copy of a live space gets
// a copy of what the live space has installed (an admin approved those), so its unchanged views
// build. A package the draft's own package.json adds gets a stand-in that throws when it loads
// ("installed once an admin approves this draft"), so the draft builds and its proposal can carry the
// package and the code that uses it; approving the proposal installs the real one in its build.
//
// What package code does inside the bundle is checked by build/package-guard.ts.
import { createHash, randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, linkSync, lstatSync, realpathSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { packageCssProblems } from '../build/package-guard'
import { PART, shippedFolders } from './spaces-volume'

export const DEPS_MAX = 30
export const SIZE_MAX = 300 * 1024 * 1024
export const FILES_MAX = 60_000
export const INSTALL_TIMEOUT_MS = 60_000
export const REGISTRY = 'https://registry.npmjs.org/'

const KEYS = new Set(['name', 'version', 'private', 'description', 'dependencies'])
/** A registry package name as npm takes new ones: lowercase, an optional scope, no leading dot or _. */
export const NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const SEMVER = '(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})\\.(0|[1-9]\\d{0,8})(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?'
/**
 * An exact version, 1.2.3 (a prerelease allowed): nothing else is a version here, so the package an
 * admin approves is the one that is installed. Its own dependencies resolve once, are kept in the
 * app's lockfile, and come only from releases at least MIN_RELEASE_AGE_S old.
 */
export const VERSION = new RegExp(`^${SEMVER}$`)
export const MIN_RELEASE_AGE_S = 3 * 24 * 60 * 60
const EXACT = new RegExp(`^${SEMVER}$`)
// Names the build maps itself (build/plugins.ts): a package with one of them would never be used.
const RESERVED = (name: string) => name === 'miso' || name === 'moi' || name.startsWith('@miso/')
// What bun, npm, yarn or pnpm read as their own settings: never in a space.
export const CONFIG_FILES = ['.npmrc', 'bunfig.toml', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs']

export type Deps = Record<string, string>

const what = (spec: string): string => {
  if (/^(file|link|workspace|portal|patch|npm|catalog):/i.test(spec)) return `a ${spec.split(':')[0]}: version`
  if (/^(git|github|gitlab|bitbucket|git\+[a-z]+|https?):/i.test(spec) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(spec)) return 'a git, GitHub or web address'
  if (/\.(tgz|tar\.gz|tar)$/i.test(spec)) return 'a tarball'
  return JSON.stringify(spec)
}

/** What's wrong with a space's package.json, as sentences; none when it is fine. */
export function packageJsonProblems(text: string): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return ["package.json isn't JSON."]
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ['package.json is one JSON object.']
  const pkg = parsed as Record<string, unknown>
  const problems: string[] = []
  for (const key of Object.keys(pkg)) {
    if (key === 'devDependencies') problems.push('package.json: a space has no devDependencies; list what its code imports under dependencies.')
    else if (!KEYS.has(key)) problems.push(`package.json: "${key}" isn't allowed. A space's package.json has only name, version, private, description and dependencies.`)
  }
  for (const key of ['name', 'version', 'description'] as const) {
    if (key in pkg && (typeof pkg[key] !== 'string' || (pkg[key] as string).length > 200)) problems.push(`package.json: "${key}" is text of at most 200 characters.`)
  }
  if ('private' in pkg && typeof pkg.private !== 'boolean') problems.push('package.json: "private" is true or false.')
  const deps = pkg.dependencies
  if (deps !== undefined) {
    if (!deps || typeof deps !== 'object' || Array.isArray(deps)) problems.push('package.json: "dependencies" is an object of package names and versions.')
    else {
      const entries = Object.entries(deps as Record<string, unknown>)
      if (entries.length > DEPS_MAX) problems.push(`package.json: at most ${DEPS_MAX} dependencies in a space.`)
      for (const [name, spec] of entries) {
        if (name.length > 214 || !NAME.test(name)) problems.push(`package.json: ${JSON.stringify(name)} isn't a package name from the npm registry (lowercase, an optional @scope/).`)
        else if (RESERVED(name)) problems.push(`package.json: ${name} is part of the app; leave it out.`)
        if (typeof spec !== 'string' || spec.length > 64 || !VERSION.test(spec)) {
          problems.push(`package.json: ${name} is ${typeof spec === 'string' ? what(spec) : 'not text'}. A space takes exact versions from the npm registry only, such as 1.2.3.`)
        }
      }
    }
  }
  // One way to write it, so the file means what the review shows (no key twice, nothing hidden).
  if (!problems.length && text.replace(/\s+$/, '') !== JSON.stringify(pkg, null, 2)) {
    problems.push('package.json: write it exactly as JSON.stringify(value, null, 2) does: two-space indent, each key once, nothing else.')
  }
  return problems
}

/** The dependencies of a space's package.json text. Throws with the problems. */
export function packageDeps(text: string): Deps {
  const problems = packageJsonProblems(text)
  if (problems.length) throw new Error(problems.join(' '))
  return { ...((JSON.parse(text) as { dependencies?: Deps }).dependencies ?? {}) }
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32)
const sorted = (deps: Deps): Deps => Object.fromEntries(Object.keys(deps).sort().map(k => [k, deps[k]!]))

/**
 * What a bun.lock may hold: our own workspace with exactly `deps`, and registry packages only.
 * Problems as sentences; none when it is fine.
 */
export function lockProblems(text: string, deps: Deps): string[] {
  let lock: Record<string, unknown>
  try {
    lock = Bun.JSONC.parse(text) as Record<string, unknown>
  } catch {
    return ["the lockfile bun wrote can't be read."]
  }
  if (!lock || typeof lock !== 'object') return ["the lockfile bun wrote can't be read."]
  const problems: string[] = []
  for (const key of Object.keys(lock)) {
    if (key === 'trustedDependencies') {
      if (!Array.isArray(lock[key]) || (lock[key] as unknown[]).length) problems.push('the install trusts packages to run scripts.')
    } else if (!['lockfileVersion', 'configVersion', 'workspaces', 'packages'].includes(key)) problems.push(`the lockfile has "${key}", which a space's install never has.`)
  }
  const workspaces = lock.workspaces as Record<string, { dependencies?: Deps } & Record<string, unknown>> | undefined
  const root = workspaces?.['']
  if (!workspaces || Object.keys(workspaces).length !== 1 || !root) problems.push('the lockfile has other workspaces.')
  else if (JSON.stringify(sorted(root.dependencies ?? {})) !== JSON.stringify(sorted(deps))) problems.push("the lockfile's dependencies are not the space's.")
  const packages = lock.packages
  if (!packages || typeof packages !== 'object') return [...problems, 'the lockfile lists no packages.']
  for (const [key, value] of Object.entries(packages as Record<string, unknown>)) {
    const entry = Array.isArray(value) ? value : []
    const id = typeof entry[0] === 'string' ? entry[0] : ''
    const at = id.lastIndexOf('@')
    const name = at > 0 ? id.slice(0, at) : ''
    const version = at > 0 ? id.slice(at + 1) : ''
    const ok =
      entry.length === 4 &&
      NAME.test(name) &&
      EXACT.test(version) &&
      entry[1] === '' &&
      typeof entry[3] === 'string' &&
      /^sha512-[A-Za-z0-9+/]+=*$/.test(entry[3]) &&
      (key === name || key.endsWith(`/${name}`))
    if (!ok) problems.push(`${id || key} doesn't come from the npm registry (git, a web address, a tarball or a local path), so it isn't installed.`)
  }
  return problems
}

const MANIFEST_FIELDS = ['main', 'module', 'browser', 'exports', 'imports', 'bin', 'types', 'typings']
// Removed from an installed tree: what bun, tsc or a linker would read as settings, and the links
// bun makes for a package's commands.
const DROPPED = new Set(['.bin', 'tsconfig.json', 'jsconfig.json', 'bunfig.toml', '.npmrc', '.yarnrc', '.yarnrc.yml'])

/**
 * A path a package.json in `dir` names that leads out of `root` (the space's node_modules) or isn't a
 * path: absolute, or with a scheme other than node:. `../cjs/x.js` from a package's subfolder is fine.
 */
export function escapingTarget(value: string, dir: string, root: string): boolean {
  if (value.startsWith('node:')) return false
  if (isAbsolute(value) || /^[\\/~]/.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value)) return true
  // A bare name (`evil/../../x`) is resolved from node_modules/<name> by the bundler, not from here.
  if (!value.startsWith('.') && value.split(/[\\/]/).includes('..')) return true
  const target = resolve(dir, value)
  return target !== root && !target.startsWith(root + sep)
}

function manifestProblems(file: string, text: string, dir: string, root: string): string[] {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(text)
  } catch {
    return [`${file} isn't JSON.`]
  }
  const bad: string[] = []
  const walk = (value: unknown, keys: boolean) => {
    if (typeof value === 'string') {
      if (escapingTarget(value, dir, root)) bad.push(value)
    } else if (Array.isArray(value)) value.forEach(v => walk(v, keys))
    else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        // `browser` maps paths to paths: both sides are paths the bundler follows.
        if (keys && (k.startsWith('.') || k.startsWith('/')) && escapingTarget(k, dir, root)) bad.push(k)
        walk(v, keys)
      }
    }
  }
  for (const field of MANIFEST_FIELDS) if (pkg && typeof pkg === 'object' && field in pkg) walk(pkg[field], field === 'browser')
  return bad.length ? [`${file} points outside the space's packages (${[...new Set(bad)].slice(0, 3).join(', ')}).`] : []
}

/**
 * Makes an installed tree safe to bundle, or says why it isn't: drops .bin and config files, and
 * refuses links, package.json paths that leave their package, and a tree over SIZE_MAX or FILES_MAX.
 */
export function checkTree(nodeModules: string): string[] {
  const root = resolve(nodeModules)
  const problems: string[] = []
  let bytes = 0
  let files = 0
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(nodeModules, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name
      const abs = join(nodeModules, path)
      if (DROPPED.has(entry.name)) {
        rmSync(abs, { recursive: true, force: true })
        continue
      }
      if (entry.isSymbolicLink()) problems.push(`node_modules/${path} is a link, which a space's packages may not have.`)
      else if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) {
        files++
        bytes += lstatSync(abs).size
        if (entry.name === 'package.json') problems.push(...manifestProblems(`node_modules/${path}`, readFileSync(abs, 'utf8'), dirname(abs), root))
        // Every stylesheet now, not only the ones the bundler loads: Tailwind reads an @import'ed one
        // itself (a live space's own stylesheet may @import a package's), past the build's guard.
        else if (/\.css$/i.test(entry.name)) problems.push(...packageCssProblems(abs, readFileSync(abs, 'utf8'), realpathSync(root)).map(p => `node_modules/${path}: ${p}`))
      } else problems.push(`node_modules/${path} is not a file or folder.`)
      if (problems.length > 20 || files > FILES_MAX || bytes > SIZE_MAX) return
    }
  }
  walk('')
  if (files > FILES_MAX || bytes > SIZE_MAX) problems.push(`the packages are larger than a space may have (${Math.round(SIZE_MAX / 1024 / 1024)} MB, ${FILES_MAX} files).`)
  return problems
}

/** `lock`: the lockfile an earlier install of the same dependencies made, installed as it is. */
export type Installer = (stage: string, deps: Deps, lock?: string) => Promise<void>

/**
 * `bun install` of exactly `deps` in `stage`, a folder the app made: its own package.json and
 * bunfig.toml, no lifecycle scripts, no environment but PATH and an empty HOME, the npm registry.
 * Throws with bun's last lines. Leaves node_modules and bun.lock in `stage`.
 */
export const bunInstall: Installer = async (stage, deps, lock) => {
  mkdirSync(join(stage, 'home'), { recursive: true })
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify({ name: 'tamari-space-packages', private: true, dependencies: deps, trustedDependencies: [] }, null, 2)}\n`)
  writeFileSync(join(stage, 'bunfig.toml'), `[install]\nregistry = "${REGISTRY}"\nlinker = "hoisted"\nminimumReleaseAge = ${MIN_RELEASE_AGE_S}\n`)
  if (lock) writeFileSync(join(stage, 'bun.lock'), lock)
  const proc = Bun.spawn([process.execPath, 'install', '--ignore-scripts', '--backend=copyfile', '--no-progress', '--no-summary', ...(lock ? ['--frozen-lockfile'] : [])], {
    cwd: stage,
    env: { PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin', HOME: join(stage, 'home'), BUN_INSTALL_CACHE_DIR: join(tmpdir(), 'tamari-bun-cache'), NO_COLOR: '1' },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const timer = setTimeout(() => proc.kill('SIGKILL'), INSTALL_TIMEOUT_MS)
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  clearTimeout(timer)
  if (code !== 0) {
    const last = `${err}\n${out}`.trim().split('\n').filter(Boolean).slice(-4).join('\n')
    throw new Error(proc.signalCode === 'SIGKILL' ? `bun install took longer than ${INSTALL_TIMEOUT_MS / 1000} s.` : `bun install failed:\n${last}`)
  }
}

type Entry = { folder: string; draft?: boolean; draftOf?: string }

/** Where the app keeps its installs in the volume: in .git/, which git, the watcher and the MCP tools never show. */
export const packagesHome = (dir: string) => join(dir, '.git', 'tamari-packages')
const STAMP = '.tamari-packages'

const readStamp = (nodeModules: string): string | null => {
  try {
    return readFileSync(join(nodeModules, STAMP), 'utf8').trim() || null
  } catch {
    return null
  }
}

/** A space's package.json text, or null. Never through a link. */
function packageText(miso: string): string | null {
  const file = join(miso, 'package.json')
  try {
    if (!lstatSync(file).isFile()) throw new Error('package.json is not a plain file.')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return readFileSync(file, 'utf8')
}

/** Top-level package names in a node_modules folder (`@scope/name` for scoped ones). */
export function topLevelPackages(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return []
  const names: string[] = []
  for (const name of readdirSync(nodeModules)) {
    if (name.startsWith('.')) continue
    if (name.startsWith('@')) names.push(...readdirSync(join(nodeModules, name)).map(sub => `${name}/${sub}`))
    else names.push(name)
  }
  return names.sort()
}

/**
 * A copy of a live space's installed tree for a draft copy, as hard links (same volume, no extra
 * space; nothing writes into an installed tree, the sync only replaces whole folders). Plain files
 * and folders only: an installed tree has no links (checkTree).
 */
function mirror(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const [a, b] = [join(from, entry.name), join(to, entry.name)]
    if (entry.isDirectory()) mirror(a, b)
    else if (entry.isFile()) {
      try {
        linkSync(a, b)
      } catch {
        copyFileSync(a, b)
      }
    }
  }
}

/** A stand-in for a package a draft adds: it builds, and throws when it loads. */
function writeStub(nodeModules: string, name: string): void {
  const dir = join(nodeModules, ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name, version: '0.0.0', exports: { '.': './index.cjs', './*': './index.cjs' } }, null, 2)}\n`)
  writeFileSync(join(dir, 'index.cjs'), `throw new Error(${JSON.stringify(`${name} is installed once an admin approves this draft. Until then the draft can't use it.`)})\n`)
}

export type SyncResult = { ok: true; changed: string[] } | { ok: false; errors: string; changed: string[] }

/**
 * Brings every space's .miso/node_modules in line with its package.json, before a build in the
 * Compose install (cli/selfhost.ts). `appHas`: a package the app itself has installed. A stamp in
 * node_modules says what it was made from, so an unchanged space costs nothing; a node_modules
 * without one (not made here) is replaced.
 */
export async function syncSpacePackages(
  dir: string,
  {
    install = bunInstall,
    appHas,
    log = () => {},
    shipped = shippedFolders()
  }: { install?: Installer; appHas: (name: string) => boolean; log?: (line: string) => void; shipped?: string[] }
): Promise<SyncResult> {
  const home = packagesHome(dir)
  // Half-made folders of a build that died.
  rmSync(join(home, 'stage'), { recursive: true, force: true })
  mkdirSync(join(home, 'stage'), { recursive: true })
  mkdirSync(join(home, 'previous'), { recursive: true })
  let spaces: Entry[]
  try {
    // Tamari's own spaces come with their packages, installed from their lockfile when the image was
    // built, and every start copies them over the volume's (server/spaces-volume.ts): left alone.
    spaces = (JSON.parse(readFileSync(join(dir, 'spaces.json'), 'utf8')) as { spaces: Entry[] }).spaces.filter(
      s => PART.test(s.folder) && !shipped.includes(s.folder) && existsSync(join(dir, s.folder))
    )
  } catch {
    return { ok: true, changed: [] }
  }
  const errors: string[] = []
  const changed: string[] = []
  const stage = () => join(home, 'stage', randomBytes(4).toString('hex'))
  const previous = (folder: string) => join(home, 'previous', folder)
  const swapIn = (nodeModules: string, from: string, folder: string, keepOld: boolean) => {
    // The live space's last install waits in .git/ for a put-back; a draft's is just removed.
    if (existsSync(nodeModules)) {
      if (keepOld && readStamp(nodeModules)?.startsWith('i:')) {
        rmSync(previous(folder), { recursive: true, force: true })
        renameSync(nodeModules, previous(folder))
      } else rmSync(nodeModules, { recursive: true, force: true })
    }
    renameSync(from, nodeModules)
    changed.push(folder)
  }

  const live = spaces.filter(s => s.draft !== true)
  const drafts = spaces.filter(s => s.draft === true)
  for (const { folder } of live) {
    const miso = join(dir, folder, '.miso')
    const nodeModules = join(miso, 'node_modules')
    try {
      for (const name of CONFIG_FILES) {
        if (existsSync(join(miso, name)) || existsSync(join(dir, folder, name))) throw new Error(`${name} is a package manager's settings, which a space may not have. Delete it.`)
      }
      const text = packageText(miso)
      const deps = text === null ? {} : packageDeps(text)
      if (!Object.keys(deps).length) {
        if (existsSync(nodeModules)) {
          const stamp = readStamp(nodeModules)
          if (stamp?.startsWith('i:')) {
            rmSync(previous(folder), { recursive: true, force: true })
            renameSync(nodeModules, previous(folder))
          } else rmSync(nodeModules, { recursive: true, force: true })
          changed.push(folder)
        }
        continue
      }
      const key = `i:${hash(JSON.stringify(sorted(deps)))}`
      if (readStamp(nodeModules) === key) continue
      // A put-back: the install before this one is still in .git/.
      if (readStamp(previous(folder)) === key) {
        const back = stage()
        renameSync(previous(folder), back)
        swapIn(nodeModules, back, folder, true)
        log(`tamari: packages: ${folder} back to its previous install`)
        continue
      }
      const at = stage()
      mkdirSync(at, { recursive: true })
      try {
        log(`tamari: packages: installing ${Object.keys(deps).join(', ')} for ${folder}`)
        // The same dependencies as before (a put-back whose previous install is gone, a restored
        // volume): the same packages, from the lockfile kept then.
        const kept = join(home, 'locks', folder, `${key.slice(2)}.lock`)
        await install(at, sorted(deps), existsSync(kept) ? readFileSync(kept, 'utf8') : undefined)
        const lock = join(at, 'bun.lock')
        const problems = existsSync(lock) ? lockProblems(readFileSync(lock, 'utf8'), sorted(deps)) : ['bun wrote no lockfile.']
        const tree = join(at, 'node_modules')
        if (!problems.length) problems.push(...(existsSync(tree) ? checkTree(tree) : ['bun installed nothing.']))
        if (problems.length) throw new Error(problems.slice(0, 10).join('\n'))
        writeFileSync(join(tree, STAMP), `${key}\n`)
        mkdirSync(dirname(kept), { recursive: true })
        writeFileSync(kept, readFileSync(lock, 'utf8'))
        swapIn(nodeModules, tree, folder, true)
      } finally {
        rmSync(at, { recursive: true, force: true })
      }
    } catch (err) {
      errors.push(`${folder}/.miso/package.json: ${err instanceof Error ? err.message : err}`)
    }
  }

  for (const { folder, draftOf } of drafts) {
    const miso = join(dir, folder, '.miso')
    const nodeModules = join(miso, 'node_modules')
    try {
      for (const name of CONFIG_FILES) {
        if (existsSync(join(miso, name)) || existsSync(join(dir, folder, name))) throw new Error(`${name} is a package manager's settings, which a space may not have. Delete it.`)
      }
      const text = packageText(miso)
      const deps = text === null ? {} : packageDeps(text)
      // What the live space has installed, which an admin approved: a copy may use it.
      const liveModules = draftOf && PART.test(draftOf) ? join(dir, draftOf, '.miso', 'node_modules') : null
      const liveStamp = liveModules && readStamp(liveModules)?.startsWith('i:') ? readStamp(liveModules)! : null
      const liveHas = new Set(liveStamp ? topLevelPackages(liveModules!) : [])
      const stubs = Object.keys(deps).filter(name => !liveHas.has(name) && !appHas(name)).sort()
      if (!liveStamp && !stubs.length) {
        if (existsSync(nodeModules)) {
          rmSync(nodeModules, { recursive: true, force: true })
          changed.push(folder)
        }
        continue
      }
      const key = `d:${hash(`${liveStamp ?? ''}|${stubs.join(',')}`)}`
      if (readStamp(nodeModules) === key) continue
      const at = stage()
      const tree = join(at, 'node_modules')
      try {
        if (liveStamp) mirror(liveModules!, tree)
        else mkdirSync(tree, { recursive: true })
        for (const name of stubs) writeStub(tree, name)
        // The live stamp came over as a hard link: a new file, so the live one stays as it is.
        rmSync(join(tree, STAMP), { force: true })
        writeFileSync(join(tree, STAMP), `${key}\n`)
        swapIn(nodeModules, tree, folder, false)
      } finally {
        rmSync(at, { recursive: true, force: true })
      }
    } catch (err) {
      errors.push(`${folder}/.miso/package.json: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Keep a previous install only for spaces that are still there.
  const folders = new Set(live.map(s => s.folder))
  mkdirSync(join(home, 'locks'), { recursive: true })
  for (const kind of ['previous', 'locks']) {
    for (const name of readdirSync(join(home, kind))) if (!folders.has(name)) rmSync(join(home, kind, name), { recursive: true, force: true })
  }
  return errors.length ? { ok: false, errors: `The space's packages can't be installed:\n${errors.join('\n')}`, changed } : { ok: true, changed }
}

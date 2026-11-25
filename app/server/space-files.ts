// The files of the spaces in the Compose install's volume (server/spaces-volume.ts), for the MCP
// tools (server/mcp-space-tools.ts). A path is relative to a space's .miso/ folder, such as
// views/home.tsx: only files there, no dot files or folders, no node_modules, and package.json only
// at the top, checked by server/space-packages.ts.
//
// A change is one build and one commit, or nothing: write all its files, wait for the build that
// started after them (build-status.ts), then commit as the member when it passes, or put every file
// back to the last commit when it fails, so the last commit in the volume always builds. One change
// at a time, through a lock in the volume that a restarted server also sees.
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_NAME } from '../lib/brand'
import { designProblems } from '../lib/space-design'
import { APP_ROOT } from '../lib/roots'
import { requestBuild, type BuildStatus } from './build-status'
import { packageJsonProblems } from './space-packages'
import { commit, PART, shippedFolders, spacesGit } from './spaces-volume'

export const SPACES_DIR = join(APP_ROOT, 'workspaces')
/** The volume is there (the Compose install): the write tools exist only then. */
export const hasSpacesVolume = (dir = SPACES_DIR): boolean => existsSync(join(dir, '.git'))

export const FILE_MAX_CHARS = 200_000
export const FILES_MAX = 40
export const CHANGE_MAX_CHARS = 1_000_000
export const LIST_MAX = 500
const PATH_MAX = 200
const SUMMARY_MAX = 200
const LOCK_STALE_MS = 10 * 60_000
const TEXT_FILE = /\.(tsx?|jsx?|css|md|json|txt|svg)$/
const KIT = join(APP_ROOT, 'template', 'spaces', 'startup', '.miso', 'ui', 'kit.tsx')
// Top-level paths of the app itself (client/lib/router.ts) and of the gateway (selfhost/kong.yml).
const RESERVED_SLUGS = new Set(['connectors', 'members', 'space-access', 'usage', 'proposals', 'settings', 'shared-data', 'api', 'assets', 'auth', 'rest', 'realtime'])

// Said to the caller as it is: what to change so it works.
export class FileRefusal extends Error {}

/** A path relative to a space's .miso/, checked and normalised. */
export function checkPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw.length > PATH_MAX) {
    throw new FileRefusal(`A path is 1 to ${PATH_MAX} characters, relative to the space's .miso/ folder, such as views/home.tsx.`)
  }
  const parts = raw.split('/')
  for (const part of parts) {
    if (!PART.test(part)) throw new FileRefusal(`${raw}: each part of a path is letters, digits, dots, _ and -, and doesn't start with a dot.`)
    if (part === 'node_modules') throw new FileRefusal(`${raw}: node_modules is not part of a space's code.`)
  }
  const name = parts.at(-1)!
  // One package.json, at the top of .miso/ (server/space-packages.ts installs what it lists). The
  // app makes the lockfile itself; a package.json deeper down would change how the build reads the
  // files under it.
  if (name === 'package.json' && parts.length > 1) throw new FileRefusal(`${raw}: a space has one package.json, at the top of its .miso/ folder.`)
  if (name === 'bun.lock' || name === 'bun.lockb' || name === 'bunfig.toml') throw new FileRefusal(`${raw}: the app installs a space's packages itself; a space has only its package.json.`)
  if (!TEXT_FILE.test(name)) throw new FileRefusal(`${raw}: only .ts, .tsx, .js, .jsx, .css, .md, .json, .txt and .svg files.`)
  return parts.join('/')
}

// `draft` and `createdBy`: a member's draft space (app/lib/catalog.ts reads them too).
export type SpaceEntry = { folder: string; id: string; slug: string; draft?: boolean; createdBy?: string }

export function readSpacesFile(dir = SPACES_DIR): SpaceEntry[] {
  const file = join(dir, 'spaces.json')
  if (!existsSync(file)) return []
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { spaces?: SpaceEntry[] }
  return Array.isArray(parsed.spaces) ? parsed.spaces : []
}

/** Who changes: an admin or owner changes any of the company's spaces, a member only their own drafts. */
export type Editor = { userId: string; admin: boolean }

export const MEMBERS_DRAFTS_ONLY =
  'Members change only their own draft spaces for now. Make one with create_space; changing shared spaces comes with proposals an admin reviews.'

/** A space's entry from its slug or folder name. `edit`: also one this editor may change, never a shipped one. */
export function spaceEntry(space: unknown, { dir = SPACES_DIR, edit, shipped = shippedFolders() }: { dir?: string; edit?: Editor; shipped?: string[] } = {}): SpaceEntry {
  const name = typeof space === 'string' ? space.trim() : ''
  const entry = readSpacesFile(dir).find(s => s.slug === name || s.folder === name)
  if (!entry || !PART.test(entry.folder)) throw new FileRefusal(`There's no space ${JSON.stringify(name)} with code. list_spaces names them.`)
  if (edit && shipped.includes(entry.folder)) {
    throw new FileRefusal(`${entry.folder} is one of ${APP_NAME}'s own spaces: every start puts it back as ${APP_NAME} ships it, so it can't be changed here. Make your own space with create_space.`)
  }
  if (edit && !edit.admin && !isOwnDraft(entry, edit.userId)) throw new FileRefusal(MEMBERS_DRAFTS_ONLY)
  return entry
}

export const isOwnDraft = (entry: SpaceEntry, userId: string): boolean => entry.draft === true && entry.createdBy === userId

export const spaceFolder = (space: unknown, options: Parameters<typeof spaceEntry>[1] = {}): string => spaceEntry(space, options).folder

/** A member has at most this many draft spaces: each is a whole space the app builds. */
export const DRAFTS_MAX = 3

export function checkDraftCap(userId: string, dir = SPACES_DIR): void {
  const mine = readSpacesFile(dir).filter(s => isOwnDraft(s, userId)).length
  if (mine >= DRAFTS_MAX) {
    throw new FileRefusal(`You have ${mine} draft spaces, which is the most one person can have: each is a whole space the app builds. Delete one with delete_draft_space first.`)
  }
}

/** The files a space has in the spaces' history, and spaces.json: what deleting it touches. */
export function spaceTrackedFiles(folder: string, dir = SPACES_DIR): string[] {
  return [...spacesGit(dir, 'ls-files', '--', folder).split('\n').filter(Boolean), 'spaces.json']
}

/** Takes the space's folder and its spaces.json entry away (delete_draft_space). */
export function removeSpace(entry: SpaceEntry, dir = SPACES_DIR): void {
  rmSync(join(dir, entry.folder), { recursive: true, force: true })
  const file = join(dir, 'spaces.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { spaces: SpaceEntry[] }
  parsed.spaces = parsed.spaces.filter(s => s.folder !== entry.folder)
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
}

/** The absolute path, refused when anything on the way (a symlink) could lead out of the space's .miso/. */
function inside(dir: string, folder: string, rel: string): string {
  const root = realpathSync(dir)
  let path = join(root, folder)
  for (const part of ['.miso', ...rel.split('/')]) {
    let link = false
    try {
      link = lstatSync(path).isSymbolicLink()
    } catch {
      // Not there yet: nothing to follow.
    }
    if (link) throw new FileRefusal(`${folder}/.miso/${rel}: a link inside a space is not followed.`)
    path = join(path, part)
  }
  try {
    if (lstatSync(path).isSymbolicLink()) throw new FileRefusal(`${folder}/.miso/${rel}: a link inside a space is not followed.`)
  } catch (err) {
    if (err instanceof FileRefusal) throw err
  }
  return path
}

/** Every file of the space's .miso/ the tools may show: no dot files, no node_modules, no links. */
export function listFiles(folder: string, dir = SPACES_DIR): { path: string; chars: number }[] {
  const root = inside(dir, folder, '')
  const out: { path: string; chars: number }[] = []
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (out.length >= LIST_MAX || !PART.test(entry.name) || entry.name === 'node_modules' || entry.isSymbolicLink()) continue
      const path = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) out.push({ path, chars: statSync(join(root, path)).size })
    }
  }
  walk('')
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export function readFile(folder: string, rawPath: unknown, dir = SPACES_DIR): string {
  const rel = checkReadPath(rawPath)
  const path = inside(dir, folder, rel)
  if (!existsSync(path) || !statSync(path).isFile()) throw new FileRefusal(`${folder}/.miso/${rel} isn't there.`)
  if (statSync(path).size > FILE_MAX_CHARS * 4) throw new FileRefusal(`${folder}/.miso/${rel} is too large to read here.`)
  return readFileSync(path, 'utf8')
}

// Reading may look at package.json and other text files; the rest of checkPath holds.
function checkReadPath(raw: unknown): string {
  try {
    return checkPath(raw)
  } catch (err) {
    if (typeof raw === 'string' && /(^|\/)(package\.json|bun\.lock)$/.test(raw) && raw.split('/').every(p => PART.test(p) && p !== 'node_modules')) return raw
    throw err
  }
}

export type Author = { name: string | null; email: string | null }

/** "Name <email>" for git: one line, no angle brackets, so it can't add a second author or a header. */
export function authorLine({ name, email }: Author): string {
  const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim()
  const address = email && /^[^\s<>@]+@[^\s<>@]+$/.test(email) ? email : 'unknown@localhost'
  return `${clean(name ?? '').slice(0, 80) || clean(address)} <${address}>`
}

/** The commit message: the member's summary on one line. */
export function checkSummary(raw: unknown): string {
  const summary = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''
  if (!summary || summary.length > SUMMARY_MAX) throw new FileRefusal(`Say in 1 to ${SUMMARY_MAX} characters what the change does; it becomes the commit message.`)
  return summary
}

export type Change = { write: { path: string; content: string }[]; delete: string[] }

/** Every path, size and design rule, before anything is written. Returns the paths relative to the volume. */
/**
 * What a draft space may not hold, on top of checkPath: the build reads these as its own
 * configuration (tsconfig paths would map a name to any file) or runs code from them (Tailwind's
 * @plugin in a stylesheet). build/draft-guard.ts refuses them at build time too.
 */
export function checkDraftPath(path: string): string {
  const name = path.split('/').at(-1)!.toLowerCase()
  if (name.endsWith('.css')) throw new FileRefusal(`${path}: a draft space has no stylesheets of its own. Style with Tailwind classes in the views.`)
  if (name === 'tsconfig.json' || name === 'jsconfig.json') throw new FileRefusal(`${path}: a draft space can't have its own ${name}.`)
  return path
}

export function checkChange(
  folder: string,
  change: Change,
  dir = SPACES_DIR,
  { draft = false }: { draft?: boolean } = {}
): { write: { path: string; content: string }[]; delete: string[] } {
  const pathOf = (raw: unknown) => (draft ? checkDraftPath(checkPath(raw)) : checkPath(raw))
  const write = (change.write ?? []).map(f => ({ path: pathOf(f?.path), content: f?.content }))
  const remove = (change.delete ?? []).map(checkPath)
  if (!write.length && !remove.length) throw new FileRefusal('Name at least one file to write or delete.')
  if (write.length + remove.length > FILES_MAX) throw new FileRefusal(`At most ${FILES_MAX} files in one change.`)
  const all = [...write.map(f => f.path), ...remove]
  if (new Set(all).size !== all.length) throw new FileRefusal('Each file once per change: not written twice, and not written and deleted.')
  let total = 0
  const problems: string[] = []
  for (const f of write) {
    if (typeof f.content !== 'string') throw new FileRefusal(`${f.path}: the content is text.`)
    if (f.content.length > FILE_MAX_CHARS) throw new FileRefusal(`${f.path}: at most ${FILE_MAX_CHARS} characters per file.`)
    // Control characters (a NUL makes git show the file as binary) would hide code from a review.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(f.content)) throw new FileRefusal(`${f.path}: the content has control characters; a space's files are plain text.`)
    total += f.content.length
    if (f.path === 'package.json') {
      const wrong = packageJsonProblems(f.content)
      if (wrong.length) throw new FileRefusal(wrong.join('\n'))
    }
    problems.push(...designProblems(`${folder}/.miso/${f.path}`, f.content))
    inside(dir, folder, f.path)
  }
  if (total > CHANGE_MAX_CHARS) throw new FileRefusal(`At most ${CHANGE_MAX_CHARS} characters in one change.`)
  if (problems.length) throw new FileRefusal(`The design rules (get_design_rules) say:\n${problems.join('\n')}`)
  for (const rel of remove) {
    const path = inside(dir, folder, rel)
    if (!existsSync(path) || !statSync(path).isFile()) throw new FileRefusal(`${rel} isn't there to delete.`)
  }
  return { write: write as { path: string; content: string }[], delete: remove }
}

/** One change at a time, across server restarts: a directory in the volume's .git, taken with mkdir. */
/** The lock's path. cli/selfhost.ts removes a leftover one when the container starts: no change can run then. */
export const changeLock = (dir = SPACES_DIR): string => join(dir, '.git', 'tamari-change.lock')

export async function withLock<T>(dir: string, fn: () => Promise<T>, { waitMs = 120_000, staleMs = LOCK_STALE_MS } = {}): Promise<T> {
  const lock = changeLock(dir)
  const until = Date.now() + waitMs
  for (;;) {
    try {
      mkdirSync(lock)
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      let age = 0
      try {
        age = Date.now() - statSync(lock).mtimeMs
      } catch {
        continue
      }
      // A server that died during a change: its lock goes once it is older than any change can take.
      // shortcut: two callers that both find the same dead lock can both take it over; the start
      // removes dead locks (selfhost.ts), so this needs a death mid-change and two callers at once.
      if (age > staleMs) rmSync(lock, { recursive: true, force: true })
      else if (Date.now() >= until) throw new FileRefusal('Another change to the spaces is still being built. Try again in a minute.')
      else await Bun.sleep(500)
    }
  }
  try {
    return await fn()
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

export type ChangeResult =
  | { status: 'no change' }
  | { status: 'saved'; commit: string; build: number }
  | { status: 'put back'; errors: string }

type Run = {
  dir?: string
  summary: string
  // Who the commit names: a member, or an author line made earlier by authorLine() (an approved change).
  author: Author | string
  // Runs first, inside the lock: what has to be decided while no other change runs (create_space's
  // slug and id). It may refuse.
  prepare?: () => void
  // The exact files (relative to the volume) the change writes or deletes: only these are checked,
  // committed or put back, so another file in the space never blocks it or slips into its commit.
  touched: () => string[]
  apply: () => void
  waitForBuild: (after: number) => Promise<BuildStatus | null>
  // Asks for the build (build-status.ts); a test seam.
  askForBuild?: () => void
}

const NO_BUILD = 'No build finished within 2 minutes, so the change was put back. Try again.'

/** Apply, wait for the build, then commit or put back. The lock is held throughout. */
export function runChange({ dir = SPACES_DIR, summary, author, prepare, touched: files, apply, waitForBuild, askForBuild = requestBuild }: Run): Promise<ChangeResult> {
  return withLock(dir, async () => {
    prepare?.()
    const touched = files()
    if (spacesGit(dir, 'status', '--porcelain', '--', ...touched).trim()) {
      throw new FileRefusal(`Those files have changes in the volume that were never committed. Ask whoever runs ${APP_NAME} to commit or undo them first.`)
    }
    // Put back, then wait for the build of the restored files, so the app serves the last commit again.
    const restore = async () => {
      putBack(dir, touched)
      const restoredAt = Date.now()
      askForBuild()
      await waitForBuild(restoredAt)
    }
    try {
      apply()
    } catch (err) {
      putBack(dir, touched)
      throw err
    }
    if (!spacesGit(dir, 'status', '--porcelain', '--', ...touched).trim()) return { status: 'no change' }
    // Every file is in place now, so the first build that starts from here on has all of them. A
    // build the watcher started while the files were still being written started earlier, and is
    // skipped; the request queues the one after it (app/watch.ts).
    const requestedAt = Date.now()
    askForBuild()
    const build = await waitForBuild(requestedAt)
    if (build?.ok) {
      try {
        commit(dir, summary, touched, typeof author === 'string' ? author : authorLine(author))
      } catch (err) {
        console.error('a space change built but could not be committed:', err)
        await restore()
        return { status: 'put back', errors: "The change built, but it couldn't be saved in the spaces' history, so it was put back. Try again." }
      }
      return { status: 'saved', commit: spacesGit(dir, 'rev-parse', '--short', 'HEAD').trim(), build: build.id }
    }
    await restore()
    return { status: 'put back', errors: build ? build.errors || 'The build failed.' : NO_BUILD }
  })
}

/** The touched files as the last commit has them: changed ones restored, new ones removed with the folders they needed. */
function putBack(dir: string, touched: string[]): void {
  const tracked = spacesGit(dir, 'ls-files', '--', ...touched).split('\n').filter(Boolean)
  if (tracked.length) spacesGit(dir, 'checkout', 'HEAD', '--', ...tracked)
  for (const path of spacesGit(dir, 'ls-files', '--others', '--exclude-standard', '--', ...touched).split('\n').filter(Boolean)) {
    rmSync(join(dir, path), { force: true })
    // A folder the change made, now empty, goes too (a failed create_space leaves its slug free).
    for (let folder = dirname(join(dir, path)); folder !== dir && folder.startsWith(`${dir}/`); folder = dirname(folder)) {
      try {
        rmdirSync(folder)
      } catch {
        break
      }
    }
  }
}

/** Writes and deletes a checked change (checkChange) in the space. */
export function applyFiles(folder: string, change: Change, dir = SPACES_DIR): void {
  for (const f of change.write) {
    const path = inside(dir, folder, f.path)
    // An unchanged file isn't touched, so the watcher doesn't start a build (and a restart) for nothing.
    if (existsSync(path) && readFileSync(path, 'utf8') === f.content) continue
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, f.content)
  }
  for (const rel of change.delete) rmSync(inside(dir, folder, rel), { force: true })
}

export type NewSpace = { folder: string; id: string; slug: string; name: string }

/** A new space's name, slug, folder and id, checked against every space there is (`taken`: ids and slugs, with or without code). */
export function planSpace(rawName: unknown, rawSlug: unknown, taken: { ids: Set<string>; slugs: Set<string> }, dir = SPACES_DIR): NewSpace {
  const name = typeof rawName === 'string' ? rawName.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : ''
  if (!name || name.length > 60) throw new FileRefusal('A space name is 1 to 60 characters.')
  const slug =
    typeof rawSlug === 'string' && rawSlug.trim()
      ? rawSlug.trim()
      : name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw new FileRefusal('A slug is 1 to 40 lowercase letters, digits and dashes, starting with a letter or digit.')
  if (RESERVED_SLUGS.has(slug)) throw new FileRefusal(`${slug} is a page of the app itself. Pick another slug.`)
  const files = readSpacesFile(dir)
  if (taken.slugs.has(slug) || files.some(s => s.slug === slug || s.folder === slug) || existsSync(join(dir, slug))) {
    throw new FileRefusal(`There is a space with the slug ${slug} already. Pick another one.`)
  }
  // Never an id a space ever had: tabs, layouts and history point at ids.
  let id = ''
  do id = `${slug}-${randomBytes(3).toString('hex')}`
  while (taken.ids.has(id) || files.some(s => s.id === id))
  return { folder: slug, id, slug, name }
}

/** The files writeSpace() writes, relative to the volume. */
export const spaceFiles = (space: NewSpace): string[] => [`${space.folder}/.miso/.workspace.json`, `${space.folder}/.miso/ui/kit.tsx`, 'spaces.json']

/**
 * The new space's folder (its name, and the kit every space starts from) and its spaces.json entry.
 * `draftBy`: the member whose draft it is; the space is theirs alone until it is published.
 */
export function writeSpace(space: NewSpace, dir = SPACES_DIR, draftBy?: string): void {
  const miso = join(dir, space.folder, '.miso')
  mkdirSync(join(miso, 'ui'), { recursive: true })
  writeFileSync(join(miso, '.workspace.json'), `${JSON.stringify({ name: space.name }, null, 2)}\n`)
  if (existsSync(KIT)) copyFileSync(KIT, join(miso, 'ui', 'kit.tsx'))
  const file = join(dir, 'spaces.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { spaces: SpaceEntry[] }
  parsed.spaces.push({ folder: space.folder, id: space.id, slug: space.slug, ...(draftBy ? { draft: true, createdBy: draftBy } : {}) })
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
}

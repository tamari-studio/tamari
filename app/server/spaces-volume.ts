// The Compose install keeps the spaces in a volume mounted at workspaces/, with spaces.json and a
// git repo inside it (cli/selfhost.ts, selfhost/README.md). The folders this repo ships belong to
// the image: the image keeps a copy of them in shell-spaces/, and every start copies them over the
// same folders in the volume. Every other folder belongs to the company and is never touched.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '../lib/roots'

export const SHELL_SPACES = join(APP_ROOT, 'shell-spaces')

/** A part of a path, and a space folder's name: no leading dot (so no dot files, `.` or `..`) and no `/`. */
export const PART = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/

/** The folders the image ships. Nothing else may write into them. Empty outside the Compose image. */
export function shippedFolders(shell = SHELL_SPACES): string[] {
  try {
    return readdirSync(join(shell, 'workspaces'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
  } catch {
    return []
  }
}

function git(dir: string, ...args: string[]): string {
  const r = Bun.spawnSync(['git', '-c', 'user.name=Tamari', '-c', 'user.email=tamari@localhost', ...args], { cwd: dir, stderr: 'pipe' })
  if (!r.success) throw new Error(`git ${args[0]} in ${dir}: ${r.stderr.toString().trim()}`)
  return r.stdout.toString()
}

/** A git repo in the spaces folder, made once. Installed packages stay out of it. */
export function initRepo(dir: string): void {
  if (existsSync(join(dir, '.git'))) return
  git(dir, 'init', '--quiet', '--initial-branch=main')
  writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
}

/**
 * Keeps every node_modules out of the history (server/space-packages.ts installs into the spaces'
 * .miso/node_modules), also in a volume whose .gitignore lost the line. Returns whether it changed.
 */
export function ignoreInstalls(dir: string): boolean {
  const file = join(dir, '.gitignore')
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (text.split('\n').some(line => line.trim() === 'node_modules/' || line.trim() === 'node_modules')) return false
  writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}node_modules/\n`)
  return true
}

/**
 * Commits what changed under `paths`. Returns false when nothing did. `author` is "Name <email>",
 * already cleaned by the caller (space-files.ts); the committer stays Tamari.
 */
export function commit(dir: string, message: string, paths: string[] = ['.'], author?: string): boolean {
  git(dir, 'add', '--all', '--', ...paths)
  if (Bun.spawnSync(['git', 'diff', '--cached', '--quiet', '--', ...paths], { cwd: dir }).success) return false
  // Only these paths, whatever else is staged.
  git(dir, 'commit', '--quiet', ...(author ? [`--author=${author}`] : []), '-m', message, '--', ...paths)
  return true
}

/** git with its arguments as an array (never through a shell), in the spaces folder. Throws with git's own words. */
export const spacesGit = git

type SpacesFile = { spaces: { folder: string }[] }

/**
 * Copies the shipped folders over the same folders in `dir`, and adds each shipped spaces.json entry
 * the volume's spaces.json lacks (at the end; the company's entries keep their order). Returns the
 * paths it may have changed, for commit().
 */
export function updateShipped(dir: string, shell = SHELL_SPACES): string[] {
  const folders = shippedFolders(shell)
  for (const folder of folders) {
    rmSync(join(dir, folder), { recursive: true, force: true })
    cpSync(join(shell, 'workspaces', folder), join(dir, folder), { recursive: true })
  }
  const file = join(dir, 'spaces.json')
  const shipped = readFileSync(join(shell, 'spaces.json'), 'utf8')
  if (!existsSync(file)) writeFileSync(file, shipped)
  else {
    const mine = JSON.parse(readFileSync(file, 'utf8')) as SpacesFile
    if (!Array.isArray(mine.spaces)) throw new Error(`${file} has no "spaces" list`)
    const missing = (JSON.parse(shipped) as SpacesFile).spaces.filter(s => !mine.spaces.some(m => m.folder === s.folder))
    if (missing.length) {
      mine.spaces.push(...missing)
      writeFileSync(file, `${JSON.stringify(mine, null, 2)}\n`)
    }
  }
  return [...folders, 'spaces.json']
}

/**
 * A sample repo's starting point (the tamari-sample repo puts it in selfhost/seed/ before the
 * build): `spaces.json` and `workspaces/<folder>` in the layout of shell-spaces/, and
 * `records.json` with shared records for them (no `space`: on a new install no space row exists yet). Used on a new volume only; without it nothing changes.
 */
export const SEED = join(APP_ROOT, 'selfhost', 'seed')

/**
 * On a new volume, after updateShipped(): copies the seed's folders that the image doesn't ship and
 * the volume lacks, with their spaces.json entries. They are the company's from then on, like any
 * space it made. Returns the folders it added.
 */
export function addSeed(dir: string, seed = SEED, shell = SHELL_SPACES): string[] {
  if (!existsSync(join(seed, 'spaces.json'))) return []
  const shipped = new Set(shippedFolders(shell))
  // A seed is trusted, but a folder name that isn't a plain name never reaches the volume.
  const folders = shippedFolders(seed).filter(f => PART.test(f) && !shipped.has(f) && !existsSync(join(dir, f)))
  if (!folders.length) return []
  for (const folder of folders) cpSync(join(seed, 'workspaces', folder), join(dir, folder), { recursive: true })
  const file = join(dir, 'spaces.json')
  const mine = JSON.parse(readFileSync(file, 'utf8')) as SpacesFile
  const theirs = JSON.parse(readFileSync(join(seed, 'spaces.json'), 'utf8')) as SpacesFile
  mine.spaces.push(...theirs.spaces.filter(s => folders.includes(s.folder)))
  writeFileSync(file, `${JSON.stringify(mine, null, 2)}\n`)
  return folders
}

export type SeedRecord = { collection: string; key: string; data: unknown }

const DAY = /^@today([+-]\d+)?$/
const MONTH = /^@month([+-]\d+)?$/

/** "@today+3" is the day 3 days after `today` (YYYY-MM-DD), "@month-1" the month before (YYYY-MM). Other values stay as they are. */
export function resolveDates(value: unknown, today: string): unknown {
  if (typeof value === 'string') {
    const d = DAY.exec(value)
    if (d) return new Date(Date.parse(`${today}T00:00:00Z`) + Number(d[1] ?? 0) * 86_400_000).toISOString().slice(0, 10)
    const m = MONTH.exec(value)
    if (m) {
      const at = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 + Number(m[1] ?? 0), 1))
      return at.toISOString().slice(0, 7)
    }
    return value
  }
  if (Array.isArray(value)) return value.map(v => resolveDates(v, today))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDates(v, today)]))
  return value
}

/** The seed's shared records with their dates resolved against `today`. None without a records.json. */
export function seedRecords(seed = SEED, today = new Date().toISOString().slice(0, 10)): SeedRecord[] {
  const file = join(seed, 'records.json')
  if (!existsSync(file)) return []
  const rows = JSON.parse(readFileSync(file, 'utf8')) as unknown
  if (!Array.isArray(rows)) throw new Error(`${file} is not a list`)
  return rows.map((row, i) => {
    const r = row as Partial<SeedRecord>
    if (typeof r.collection !== 'string' || typeof r.key !== 'string' || !r.key || r.data === undefined) throw new Error(`${file}: row ${i + 1} needs collection, key and data`)
    return { collection: r.collection, key: r.key, data: resolveDates(r.data, today) }
  })
}

/** In the volume's .git folder, so no commit ever takes it in. There while the seed's records still have to go in. */
export const seedRecordsPending = (dir: string) => join(dir, '.git', 'tamari-seed-records-pending')

/** On a first start, right after initRepo(): the seed's records are still to go in. */
export function markSeedRecordsPending(dir: string): void {
  writeFileSync(seedRecordsPending(dir), '')
}

/**
 * The seed's records, while a first start marked them pending: each start tries again until they
 * went in once, then never again, so a record changed or removed later stays that way. A volume
 * without the mark (a later start, or an install from before the mark) never gets them. `insert`
 * adds the rows and skips any that exist, in one statement, so a retry never doubles a row. Throws
 * with the mark still there. Returns the rows added, or null when nothing was pending.
 */
export async function addSeedRecords(dir: string, insert: (rows: SeedRecord[]) => Promise<void>, seed = SEED, today?: string): Promise<number | null> {
  const pending = seedRecordsPending(dir)
  if (!existsSync(pending)) return null
  const rows = seedRecords(seed, today)
  if (rows.length) await insert(rows)
  rmSync(pending, { force: true })
  return rows.length
}

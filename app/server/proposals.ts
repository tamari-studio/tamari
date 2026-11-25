// Proposals (Tamari 5b), the part that works on the spaces volume (server/space-files.ts). A member
// who changes a Team or Everyone space changes their own draft copy of it: a sibling folder
// `<live>--draft-<6 hex>` with the live space's code as it was at `baseCommit`, listed in spaces.json
// with "draftOf" (so its unchanged server functions run as the live space's and changed ones don't:
// server/drafts.ts) and shown to its author as a subspace of the live space. They send it as a
// proposal (submit_proposal); an admin approves it on the Proposals page, which copies the draft over
// the live folder in one change (one build, one commit with the member as author), or rejects it.
// A member's own draft space is proposed for publication the same way.
//
// Who may do what is checked by the callers (mcp-space-tools.ts, app.ts); this file only keeps the
// volume right.
import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_NAME } from '../lib/brand'
import { FileRefusal, readSpacesFile, SPACES_DIR, type SpaceEntry } from './space-files'
import { PART, spacesGit } from './spaces-volume'

export type CopyEntry = SpaceEntry & { draftOf: string; baseCommit: string }

/** The member's draft copy of a live space, if they have one. */
export function findCopy(liveFolder: string, userId: string, dir = SPACES_DIR): CopyEntry | undefined {
  return readSpacesFile(dir).find(
    (s): s is CopyEntry => s.draft === true && s.createdBy === userId && (s as CopyEntry).draftOf === liveFolder
  ) as CopyEntry | undefined
}

export const head = (dir = SPACES_DIR): string => spacesGit(dir, 'rev-parse', 'HEAD').trim()

/** A space's own files in the last commit, relative to the volume (`<folder>/.miso/...`). */
export function committedFiles(folder: string, dir = SPACES_DIR, commit = 'HEAD'): string[] {
  return spacesGit(dir, 'ls-tree', '-r', '--name-only', commit, '--', `${folder}/.miso/`).split('\n').filter(Boolean)
}

// A part starting with a dot (.workspace.json): the member can't write those (checkPath), so they
// never travel from a draft to the live space.
const memberFile = (rel: string) => rel.split('/').every(part => PART.test(part))

/** A new copy's name, folder and id: the live folder and 6 hex, never one spaces.json has. */
export function planCopy(live: SpaceEntry, dir = SPACES_DIR): { folder: string; id: string; slug: string } {
  const taken = new Set(readSpacesFile(dir).flatMap(s => [s.folder, s.slug, s.id]))
  let folder = ''
  do folder = `${live.folder.slice(0, 40)}--draft-${randomBytes(3).toString('hex')}`
  while (taken.has(folder) || existsSync(join(dir, folder)))
  return { folder, id: folder, slug: folder }
}

/** The files writeCopy() writes, relative to the volume. */
export function copyFiles(live: SpaceEntry, copyFolder: string, dir = SPACES_DIR): string[] {
  const prefix = `${live.folder}/`
  // .workspace.json even when the live space never committed one: writeCopy always writes it.
  return [...new Set([...committedFiles(live.folder, dir).map(path => copyFolder + '/' + path.slice(prefix.length)), `${copyFolder}/.miso/.workspace.json`, 'spaces.json'])]
}

/**
 * What a member's change in their copy touches, relative to the volume. `fresh`: the copy is made
 * in the same change, so it touches every file of the copy too, except the ones the change deletes
 * (they never reach the history, and git can't add a path that was never there).
 */
export function copyChangeFiles(live: SpaceEntry, copyFolder: string, change: { write: { path: string }[]; delete: string[] }, fresh: boolean, dir = SPACES_DIR): string[] {
  const at = (rel: string) => `${copyFolder}/.miso/${rel}`
  const files = [...change.write.map(f => at(f.path)), ...change.delete.map(at)]
  if (!fresh) return files
  const gone = new Set(change.delete.map(at))
  return [...new Set([...copyFiles(live, copyFolder, dir), ...files])].filter(path => !gone.has(path))
}

/**
 * The copy: the live space's committed .miso/ files, its name marked as a draft, and its spaces.json
 * entry. Refused while the live folder has changes that were never committed: the copy must be what
 * `baseCommit` holds, or approving it would quietly bring those changes in.
 */
export function writeCopy(live: SpaceEntry, copy: { folder: string; id: string; slug: string }, userId: string, dir = SPACES_DIR): CopyEntry {
  if (spacesGit(dir, 'status', '--porcelain', '--', `${live.folder}/`).trim()) {
    throw new FileRefusal(`The ${live.slug} space has changes in the volume that were never committed, so it can't be copied for a proposal. Ask whoever runs ${APP_NAME} to commit or undo them first.`)
  }
  const baseCommit = head(dir)
  for (const path of committedFiles(live.folder, dir)) {
    const to = join(dir, copy.folder, path.slice(live.folder.length + 1))
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(join(dir, path), to)
  }
  const ws = join(dir, copy.folder, '.miso', '.workspace.json')
  const meta = existsSync(ws) ? (JSON.parse(readFileSync(ws, 'utf8')) as { name?: string }) : {}
  mkdirSync(dirname(ws), { recursive: true })
  writeFileSync(ws, `${JSON.stringify({ ...meta, name: `${meta.name ?? live.slug} (your draft)` }, null, 2)}\n`)
  const entry: CopyEntry = { folder: copy.folder, id: copy.id, slug: copy.slug, draft: true, createdBy: userId, draftOf: live.folder, baseCommit }
  const file = join(dir, 'spaces.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { spaces: SpaceEntry[] }
  parsed.spaces.push(entry)
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
  return entry
}

export const DRAFT_CHANGED = 'The draft changed after it was sent, so it was not approved. The author sends it again.'

/** Whether a folder's files differ between two commits. */
export function changedSince(commit: string, folder: string, dir = SPACES_DIR, to = 'HEAD'): boolean {
  return !Bun.spawnSync(['git', 'diff', '--quiet', commit, to, '--', `${folder}/`], { cwd: dir }).success
}

/** Thrown inside the lock when the live space moved on since the copy was made. */
export class OutOfDate extends Error {}

/**
 * Checks for approving a change, inside the lock: the draft is still exactly what was sent, and the
 * live space hasn't changed since the copy was made.
 */
export function checkApprovable(copy: CopyEntry, reviewed: string, dir = SPACES_DIR): void {
  if (changedSince(reviewed, copy.folder, dir) || spacesGit(dir, 'status', '--porcelain', '--', `${copy.folder}/`).trim()) throw new FileRefusal(DRAFT_CHANGED)
  if (changedSince(copy.baseCommit, `${copy.draftOf}/.miso`, dir)) throw new OutOfDate('The space changed after this draft was made, so the proposal is out of date.')
}

/** What approving a change writes and deletes, relative to the volume. */
export function approveFiles(copy: CopyEntry, dir = SPACES_DIR): string[] {
  const live = committedFiles(copy.draftOf, dir)
  const draft = committedFiles(copy.folder, dir)
  const mapped = draft.map(p => copy.draftOf + p.slice(copy.folder.length))
  return [...new Set([...live, ...mapped, ...draft, 'spaces.json'])]
}

/**
 * Copies the draft's files over the live space, deletes the live files the draft deleted, and takes
 * the copy away (its folder and its spaces.json entry). Files whose path has a dot part stay as the
 * live space has them.
 */
export function applyApproval(copy: CopyEntry, dir = SPACES_DIR): void {
  const liveMiso = `${copy.draftOf}/.miso/`
  const draftMiso = `${copy.folder}/.miso/`
  const draft = committedFiles(copy.folder, dir).map(p => p.slice(draftMiso.length)).filter(memberFile)
  const keep = new Set(draft)
  for (const rel of draft) {
    const to = join(dir, liveMiso, rel)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(join(dir, draftMiso, rel), to)
  }
  for (const path of committedFiles(copy.draftOf, dir)) {
    const rel = path.slice(liveMiso.length)
    if (memberFile(rel) && !keep.has(rel)) rmSync(join(dir, path), { force: true })
  }
  removeEntry(copy.folder, dir)
}

function removeEntry(folder: string, dir: string): void {
  rmSync(join(dir, folder), { recursive: true, force: true })
  const file = join(dir, 'spaces.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { spaces: SpaceEntry[] }
  parsed.spaces = parsed.spaces.filter(s => s.folder !== folder)
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
}

/** Publishing a draft space: its spaces.json entry stops being a draft, so its server functions run. */
export function applyPublish(folder: string, dir = SPACES_DIR): void {
  const file = join(dir, 'spaces.json')
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { spaces: (SpaceEntry & { draftOf?: string })[] }
  const entry = parsed.spaces.find(s => s.folder === folder)
  if (!entry?.draft || entry.draftOf) throw new FileRefusal('Only a draft space of its own (not a copy of another space) is published.')
  delete entry.draft
  writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`)
}

export const DIFF_MAX_CHARS = 300_000
// git's empty tree: what a new space is compared against.
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * The proposal's changes as git shows them, plain text: the live space at the commit the copy
 * started from against the draft as it was sent, or, for a publication, the whole draft.
 */
export function proposalDiff(p: { draftFolder: string; liveFolder: string | null; baseCommit: string | null; reviewedCommit: string }, dir = SPACES_DIR): { diff: string; cut: boolean } {
  for (const c of [p.baseCommit, p.reviewedCommit]) if (c !== null && !/^[0-9a-f]{40}$/.test(c)) throw new FileRefusal('That proposal names a commit that is not one.')
  for (const f of [p.draftFolder, p.liveFolder]) if (f !== null && !PART.test(f)) throw new FileRefusal('That proposal names a folder that is not one.')
  const from = p.liveFolder && p.baseCommit ? `${p.baseCommit}:${p.liveFolder}/.miso` : EMPTY_TREE
  // Without .workspace.json: the copy's name says "(your draft)", and approving never copies it.
  const r = Bun.spawnSync(['git', 'diff', '--no-color', '--no-ext-diff', '--text', '--find-renames', from, `${p.reviewedCommit}:${p.draftFolder}/.miso`, '--', '.', ':(exclude).workspace.json'], { cwd: dir, stderr: 'pipe' })
  if (!r.success) throw new FileRefusal("The proposal's files are no longer in the spaces' history.")
  const text = r.stdout.toString()
  return text.length > DIFF_MAX_CHARS ? { diff: text.slice(0, DIFF_MAX_CHARS), cut: true } : { diff: text, cut: false }
}

// What a member (or an assistant acting for one) does with the vault's notes: list them, read
// one, search them, and propose a change. A proposal is a pull request on the vault repo; it never
// changes the vault's own branch. Developers review and merge it on GitHub (proposals.server.ts
// lists them).
//
// Every argument comes from the browser, so each one is checked here.
import { randomUUID } from 'node:crypto'
import { requireCaller } from '@miso/caller'
import { ALREADY_THERE, baseBranch, commitNote, createBranch, deleteBranch, fetchNote, listPullRequests, openPullRequest, requireVault, searchContent, STALE } from './github'
import { byteLength, encodePath, filterPaths, MAX_NOTE_BYTES, MAX_REASON_CHARS, noteTitle, oneLine, requireNotePath } from './paths'
import { branchName, commitMessage, fromPullRequest, MAX_OPEN_PER_PERSON, pullRequestBody, pullRequestTitle, summarize, type ProposalSummary } from './proposals'
import { getVault } from './vault.server'

export interface NoteRef {
  path: string
  /** The file name without .md. */
  title: string
}

export type NoteList = { configured: false } | { configured: true; repo: string; notes: NoteRef[]; truncated: boolean }

export interface Note extends NoteRef {
  /** The whole note as Markdown, frontmatter included. */
  content: string
  /** The version of the note. Send it back as `baseSha` when you propose a change to this note. */
  sha: string
  /** The note on github.com, for people who have access to the repo. */
  url: string
}

export interface NoteMatch extends NoteRef {
  /** "name": the words are in the path. "text": they are in the note itself. */
  match: 'name' | 'text'
  /** For a "text" match, a few words around it. */
  snippet?: string
}

export interface NoteSearch {
  query: string
  matches: NoteMatch[]
  /** False when only names were searched: a branch other than the default is connected, or GitHub was busy. */
  searchedText: boolean
}

export interface ProposeChangeInput {
  /** A relative .md path in the vault, such as "Projects/launch.md". */
  path: string
  /** The whole new text of the note. */
  content: string
  /** One line: why this change. */
  reason: string
  /** To change a note: the `sha` readNote gave. To add a new note: leave out, or null. */
  baseSha?: string | null
}

/** Every note in the vault. */
export async function listNotes(): Promise<NoteList> {
  const vault = await getVault()
  if (!vault.configured) return { configured: false }
  return { configured: true, repo: vault.repo, notes: vault.notes.map(path => ({ path, title: noteTitle(path) })), truncated: vault.truncated }
}

/** One note's text. Throws when there is no note at `path`. */
export async function readNote(path: string): Promise<Note> {
  requireCaller()
  const clean = requireNotePath(path)
  const config = requireVault()
  const file = await fetchNote(config, clean)
  if (!file) throw new Error('There is no note at this path.')
  return {
    path: clean,
    title: noteTitle(clean),
    content: file.content,
    sha: file.sha,
    url: `https://github.com/${config.repo}/blob/${encodeURIComponent(config.ref)}/${encodePath(clean)}`
  }
}

const MAX_QUERY_CHARS = 100
const MAX_MATCHES = 50

/** Notes whose name or path holds every word of `query`, then notes whose text holds the phrase. */
export async function searchNotes(query: string): Promise<NoteSearch> {
  requireCaller()
  if (typeof query !== 'string') throw new Error('Type what to search for.')
  const clean = oneLine(query).slice(0, MAX_QUERY_CHARS)
  if (clean.length < 2) return { query: clean, matches: [], searchedText: false }
  const vault = await getVault()
  if (!vault.configured) throw new Error('No vault is connected.')
  const byName = filterPaths(vault.notes, clean)
  const matches: NoteMatch[] = byName.slice(0, MAX_MATCHES).map(path => ({ path, title: noteTitle(path), match: 'name' }))

  const hits = await searchContent(requireVault(), clean)
  const known = new Set(vault.notes)
  const named = new Set(byName)
  for (const hit of hits ?? []) {
    // Only notes this space lists: the search also finds Markdown in dot folders.
    if (!known.has(hit.path) || named.has(hit.path) || matches.length >= MAX_MATCHES) continue
    matches.push({ path: hit.path, title: noteTitle(hit.path), match: 'text', snippet: hit.snippet })
  }
  return { query: clean, matches, searchedText: hits !== null }
}

/**
 * Suggests a change to a note, or a new note, as a pull request on the vault repo: a new branch
 * with one commit. The note itself changes only when a developer merges it on GitHub. Returns the
 * proposal, with the pull request's number and link.
 */
export async function proposeChange(input: ProposeChangeInput): Promise<ProposalSummary> {
  const caller = requireCaller()
  if (!input || typeof input !== 'object') throw new Error('Send the path, the new text and a reason.')
  const path = requireNotePath(input.path)
  if (typeof input.content !== 'string' || input.content.trim() === '') throw new Error('The note has no text.')
  if (byteLength(input.content) > MAX_NOTE_BYTES) throw new Error(`A note can be at most ${MAX_NOTE_BYTES / 1000} kB.`)
  if (typeof input.reason !== 'string' || oneLine(input.reason) === '') throw new Error('Say in one line why you propose this change.')
  const reason = oneLine(input.reason)
  if (reason.length > MAX_REASON_CHARS) throw new Error(`Keep the reason under ${MAX_REASON_CHARS} characters.`)
  const baseSha = input.baseSha ?? null
  if (baseSha !== null && (typeof baseSha !== 'string' || !/^[0-9a-f]{40,64}$/.test(baseSha))) throw new Error('This is not a version of a note. Open the note again.')

  const config = requireVault()
  // The branch starts at this commit, and the note is checked at this same commit, so what is
  // checked here is what the pull request changes.
  const base = await baseBranch(config)
  const current = await fetchNote(config, path, base.commit)
  if (baseSha === null && current) throw new Error(ALREADY_THERE)
  if (baseSha !== null && !current) throw new Error('This note is no longer in the vault.')
  if (current && current.sha !== baseSha) throw new Error(STALE)
  if (current && current.content === input.content) throw new Error('You did not change anything.')

  const mine = (await listPullRequests(config, base.name, 'open')).map(pr => fromPullRequest(pr, config.repo, base.name)).filter(p => p?.proposer.id === caller.id)
  if (mine.length >= MAX_OPEN_PER_PERSON) throw new Error(`You have ${MAX_OPEN_PER_PERSON} open proposals. Wait until some are merged or closed, or withdraw one.`)

  // Starts with the time, so branch names sort by when a proposal was made.
  const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const branch = branchName(caller.id, id)
  const kind = current ? 'edit' : 'new'
  await createBranch(config, branch, base.commit)
  try {
    // With the note's sha, GitHub itself refuses to save over another version.
    await commitNote(config, { branch, path, content: input.content, sha: current?.sha ?? null, message: commitMessage({ id, path, kind, email: caller.email }) })
    const pr = await openPullRequest(config, {
      title: pullRequestTitle(kind, path, caller.email),
      body: pullRequestBody({ id, by: caller.id, email: caller.email, path, kind, base: base.commit }, reason),
      head: branch,
      base: base.name
    })
    const made = fromPullRequest(pr, config.repo, base.name)
    if (!made) throw new Error('GitHub opened the pull request, but did not send it back as expected. Look for it on GitHub.')
    return summarize(made)
  } catch (e) {
    // No branch is left behind for a proposal that did not get its pull request.
    await deleteBranch(config, branch).catch(() => undefined)
    throw e
  }
}

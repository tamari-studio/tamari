// The vault repo on GitHub: the connector's settings and the few API calls the space makes.
// Only `*.server.ts` files import this, so the token stays on the server. No function here
// returns the token or puts it, or a response body from GitHub, in an error message.
import { encodePath, MAX_NOTE_BYTES } from './paths'

export interface VaultConfig {
  repo: string
  token: string
  /** What reads use: VAULT_REF, or HEAD (the default branch). */
  ref: string
  /** VAULT_REF when set. Proposals go into this branch; without it, into the default branch. */
  branch: string | null
}

// Dots are legal in repo names, but a segment of only dots ("..") would walk out of /repos/.
const REPO = /^(?!\.+\/)(?!.*\/\.+$)[\w.-]+\/[\w.-]+$/

/** The connector's settings, or null when no vault is connected. Read per call, never at module load. */
export function vaultConfig(): VaultConfig | null {
  const repo = process.env.VAULT_REPO
  const token = process.env.VAULT_TOKEN
  if (!repo || !token) return null
  if (!REPO.test(repo)) throw new Error('VAULT_REPO must look like owner/name.')
  const branch = process.env.VAULT_REF || null
  return { repo, token, ref: branch ?? 'HEAD', branch }
}

export function requireVault(): VaultConfig {
  const config = vaultConfig()
  if (!config) throw new Error('No vault is connected. Ask an admin to add VAULT_REPO and VAULT_TOKEN on the Connectors page.')
  return config
}

// shortcut: one cached read per repo for 60s in this process, so a merged note can take a minute to show.
export const vaultCache = new Map<string, { at: number; data: unknown }>()

function headers(token: string, accept: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, accept, 'x-github-api-version': '2022-11-28' }
}

/** A GET under /repos/<repo>/ that must succeed. */
export async function github(config: Pick<VaultConfig, 'repo' | 'token'>, path: string, raw = false): Promise<Response> {
  const res = await fetch(`https://api.github.com/repos/${config.repo}/${path}`, {
    headers: headers(config.token, raw ? 'application/vnd.github.raw' : 'application/vnd.github+json')
  })
  if (!res.ok) throw new Error(`GitHub said ${res.status} for ${config.repo}. Check VAULT_REPO and that VAULT_TOKEN can read it.`)
  return res
}

export interface NoteFile {
  /** The blob sha: it changes whenever the note's text changes. */
  sha: string
  content: string
}

/** The note at `path` (already validated) at `ref` (a branch or commit; the vault's ref by default), or null when there is none. */
export async function fetchNote(config: VaultConfig, path: string, ref: string = config.ref): Promise<NoteFile | null> {
  const res = await fetch(`https://api.github.com/repos/${config.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`, {
    headers: headers(config.token, 'application/vnd.github+json')
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub said ${res.status} for ${config.repo}. Check VAULT_REPO and that VAULT_TOKEN can read it.`)
  const file = (await res.json()) as { type?: unknown; sha?: unknown; size?: unknown; content?: unknown; encoding?: unknown }
  // A folder comes back as a list, a symlink or submodule with another type.
  if (Array.isArray(file) || file.type !== 'file' || typeof file.sha !== 'string') return null
  if (typeof file.size === 'number' && file.size > MAX_NOTE_BYTES) throw new Error('This note is too big to open here. Open it on GitHub.')
  if (file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('GitHub did not send the text of this note.')
  return { sha: file.sha, content: Buffer.from(file.content, 'base64').toString('utf8') }
}

// --- Proposals as pull requests ----------------------------------------------------------
// A proposal is a branch with one commit and a pull request on the vault repo. Developers review
// and merge it on GitHub. These calls never put GitHub's response body in an error, and each
// refusal is said in plain words.

export const NO_WRITE =
  'VAULT_TOKEN can read the vault but not write to it, so no pull request was opened. Ask an admin to give the token "Contents: Read and write" (fine-grained token) or the "repo" scope (classic token).'
export const NO_PULLS =
  'VAULT_TOKEN cannot open or read pull requests on the vault, so nothing was proposed. Ask an admin to give the token "Pull requests: Read and write" (fine-grained token) or the "repo" scope (classic token).'
export const BRANCH_EXISTS = 'A branch with this name is already on GitHub, so nothing was proposed. Send the proposal again.'
export const STALE = 'This note changed since you opened it, so nothing was proposed. Open it again and redo your change.'
export const ALREADY_THERE = 'A note is already at this path. Open it and change it there.'

async function send(config: VaultConfig, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`https://api.github.com/repos/${config.repo}/${path}`, {
    method,
    headers: { ...headers(config.token, 'application/vnd.github+json'), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
}

function failed(res: Response, what: string): Error {
  if (res.status === 401) return new Error('GitHub did not accept VAULT_TOKEN. It may have expired.')
  return new Error(`GitHub said ${res.status} when ${what}.`)
}

const SHA = /^[0-9a-f]{40,64}$/

/** The branch proposals go into (VAULT_REF, or the repo's default branch) and its newest commit. */
export async function baseBranch(config: VaultConfig): Promise<{ name: string; commit: string }> {
  const name = config.branch ?? (await defaultBranch(config))
  const res = await send(config, 'GET', `git/ref/heads/${encodePath(name)}`)
  if (!res.ok) throw failed(res, `reading the branch ${name}${config.branch ? '. Check that VAULT_REF is a branch' : ''}`)
  const sha = ((await res.json()) as { object?: { sha?: unknown } }).object?.sha
  if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error(`GitHub did not say which commit ${name} is at.`)
  return { name, commit: sha }
}

/** The name of the branch proposals go into, without its commit. */
export async function baseBranchName(config: VaultConfig): Promise<string> {
  return config.branch ?? defaultBranch(config)
}

async function defaultBranch(config: VaultConfig): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${config.repo}`, { headers: headers(config.token, 'application/vnd.github+json') })
  if (!res.ok) throw new Error(`GitHub said ${res.status} for ${config.repo}. Check VAULT_REPO and that VAULT_TOKEN can read it.`)
  const name = ((await res.json()) as { default_branch?: unknown }).default_branch
  if (typeof name !== 'string' || name === '') throw new Error('GitHub did not say which branch is the default.')
  return name
}

/** A new branch at `commit`. */
export async function createBranch(config: VaultConfig, name: string, commit: string): Promise<void> {
  const res = await send(config, 'POST', 'git/refs', { ref: `refs/heads/${name}`, sha: commit })
  if (res.status === 201) return
  if (res.status === 422) throw new Error(BRANCH_EXISTS)
  // The token read this repo a moment ago, so "forbidden" or "not found" on a write means it may
  // not write (403 for a fine-grained token, 404 for a classic token without the repo scope).
  if (res.status === 403 || res.status === 404) throw new Error(NO_WRITE)
  throw failed(res, 'making a branch for the proposal')
}

/** Removes a proposal's branch. A branch that is already gone is fine. */
export async function deleteBranch(config: VaultConfig, name: string): Promise<void> {
  const res = await send(config, 'DELETE', `git/refs/heads/${encodePath(name)}`)
  if (res.ok || res.status === 404 || res.status === 422) return
  if (res.status === 403) throw new Error(NO_WRITE)
  throw failed(res, 'removing the branch of the proposal')
}

/**
 * Commits `content` to `path` on `branch`. `sha` is the blob the change started from, so GitHub
 * refuses when the note on the branch is another version. null: a new note, and GitHub refuses
 * when one is already there.
 */
export async function commitNote(config: VaultConfig, input: { branch: string; path: string; content: string; sha: string | null; message: string }): Promise<void> {
  const res = await send(config, 'PUT', `contents/${encodePath(input.path)}`, {
    message: input.message,
    content: Buffer.from(input.content, 'utf8').toString('base64'),
    branch: input.branch,
    ...(input.sha ? { sha: input.sha } : {})
  })
  if (res.status === 200 || res.status === 201) return
  if (res.status === 409) throw new Error(STALE)
  if (res.status === 422) throw new Error(input.sha ? STALE : ALREADY_THERE)
  if (res.status === 403 || res.status === 404) throw new Error(NO_WRITE)
  throw failed(res, 'saving the note on the proposal branch')
}

/** What this space reads from a pull request. Everything is checked again where it is used. */
export interface PullRequest {
  number: number
  state: string
  html_url: string
  title: string
  body: string | null
  created_at: string
  closed_at: string | null
  merged_at: string | null
  mergeable?: boolean | null
  head: { ref: string; sha: string; repo: { full_name: string } | null }
  base: { ref: string; repo: { full_name: string } | null }
}

export async function openPullRequest(config: VaultConfig, input: { title: string; body: string; head: string; base: string }): Promise<PullRequest> {
  const res = await send(config, 'POST', 'pulls', input)
  if (res.status === 201) return (await res.json()) as PullRequest
  if (res.status === 403 || res.status === 404) throw new Error(NO_PULLS)
  throw failed(res, 'opening the pull request')
}

/** One pull request, or null when the repo has none with this number. */
export async function getPullRequest(config: VaultConfig, number: number): Promise<PullRequest | null> {
  const res = await send(config, 'GET', `pulls/${number}`)
  if (res.status === 404) return null
  if (res.status === 403) throw new Error(NO_PULLS)
  if (!res.ok) throw failed(res, 'reading the pull request')
  return (await res.json()) as PullRequest
}

/** The newest 100 open, or closed and merged, pull requests into `base`. */
export async function listPullRequests(config: VaultConfig, base: string, state: 'open' | 'closed'): Promise<PullRequest[]> {
  const res = await send(config, 'GET', `pulls?state=${state}&base=${encodeURIComponent(base)}&sort=created&direction=desc&per_page=100`)
  if (res.status === 403 || res.status === 404) throw new Error(NO_PULLS)
  if (!res.ok) throw failed(res, 'listing pull requests')
  const list = await res.json()
  return Array.isArray(list) ? (list as PullRequest[]) : []
}

export async function closePullRequest(config: VaultConfig, number: number): Promise<PullRequest> {
  const res = await send(config, 'PATCH', `pulls/${number}`, { state: 'closed' })
  if (res.ok) return (await res.json()) as PullRequest
  if (res.status === 403 || res.status === 404) throw new Error(NO_PULLS)
  throw failed(res, 'closing the pull request')
}

export interface ContentHit {
  path: string
  /** A few words around the match. */
  snippet: string
}

/**
 * Notes whose text holds `phrase`, through GitHub's code search. null when the search can't be
 * used: GitHub only searches the default branch (so not with VAULT_REF), or it refused this call
 * (it allows 10 searches a minute).
 */
export async function searchContent(config: VaultConfig, phrase: string): Promise<ContentHit[] | null> {
  if (config.branch) return null
  // Quoted, with quotes and backslashes removed, the phrase can only be a search term: it cannot
  // add a qualifier such as repo:other/private that the token might also be able to read.
  const term = phrase.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!term) return []
  const q = `"${term}" repo:${config.repo} extension:md`
  const res = await fetch(`https://api.github.com/search/code?per_page=30&q=${encodeURIComponent(q)}`, {
    headers: headers(config.token, 'application/vnd.github.text-match+json')
  })
  if (!res.ok) return null
  const body = (await res.json()) as { items?: unknown }
  if (!Array.isArray(body.items)) return null
  const hits: ContentHit[] = []
  for (const item of body.items as { path?: unknown; repository?: { full_name?: unknown }; text_matches?: unknown }[]) {
    if (typeof item?.path !== 'string') continue
    if (typeof item.repository?.full_name !== 'string' || item.repository.full_name.toLowerCase() !== config.repo.toLowerCase()) continue
    const matches = Array.isArray(item.text_matches) ? (item.text_matches as { property?: unknown; fragment?: unknown }[]) : []
    const fragment = matches.find(m => m?.property === 'content' && typeof m.fragment === 'string')?.fragment
    hits.push({ path: item.path, snippet: typeof fragment === 'string' ? fragment.replace(/\s+/g, ' ').trim().slice(0, 240) : '' })
  }
  return hits
}

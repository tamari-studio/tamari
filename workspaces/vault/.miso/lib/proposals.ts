// A proposal: a change to one note that a member suggests in miso. It becomes a pull request on
// the vault repo (a branch "miso/<member id>/<proposal id>" with one commit), and developers review
// and merge it on GitHub like code. GitHub is the only place a proposal is kept: its state, and who
// made it, are read from the pull request every time. Types and plain rules only; the server
// functions are in notes.server.ts (propose) and proposals.server.ts (list, open, withdraw).
import type { PullRequest } from './github'
import { isNotePath, MAX_REASON_CHARS, oneLine } from './paths'

/** How many open proposals one person can have, so nobody floods the repo. */
export const MAX_OPEN_PER_PERSON = 20

/** Open: waiting on GitHub. Merged: the note changed. Closed: closed without merging (also a withdrawn one). */
export type ProposalStatus = 'open' | 'merged' | 'closed'

export interface Person {
  id: string
  email: string
}

export interface ProposalSummary {
  /** The proposal's own id, also the end of its branch name. */
  id: string
  /** The pull request's number on GitHub. */
  number: number
  /** The pull request on github.com. */
  url: string
  /** The vault ("owner/name") and the branch the pull request goes into. */
  repo: string
  branch: string
  path: string
  /** "edit" changes a note that exists, "new" adds one. */
  kind: 'edit' | 'new'
  reason: string
  status: ProposalStatus
  /** The member who proposed it, as the server wrote it on GitHub. */
  proposer: Person
  createdAt: string
  /** When it was merged or closed. */
  closedAt?: string
}

const PROPOSAL_ID = /^[a-z0-9]+-[a-f0-9]{8}$/
const MEMBER_ID = /^[A-Za-z0-9-]{1,64}$/
const SHA = /^[0-9a-f]{40,64}$/

export function isProposalId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && PROPOSAL_ID.test(value)
}

/** The branch for one member's proposal. The member id is the verified caller's. */
export function branchName(memberId: string, proposalId: string): string {
  if (!MEMBER_ID.test(memberId)) throw new Error('Your account id cannot be used in a branch name.')
  if (!isProposalId(proposalId)) throw new Error('This is not a proposal id.')
  return `miso/${memberId}/${proposalId}`
}

export function parseBranch(ref: unknown): { memberId: string; proposalId: string } | null {
  if (typeof ref !== 'string') return null
  const parts = ref.split('/')
  if (parts.length !== 3 || parts[0] !== 'miso' || !MEMBER_ID.test(parts[1]) || !isProposalId(parts[2])) return null
  return { memberId: parts[1], proposalId: parts[2] }
}

/** What the server writes on the first line of a pull request's body. */
export interface Marker {
  id: string
  /** The proposer's member id and email, from the verified caller. */
  by: string
  email: string
  path: string
  kind: 'edit' | 'new'
  /** The commit the branch started from: the old text of the note is read there. */
  base: string
}

const MARKER = /^<!-- miso-proposal (\{[^\n]*\}) -->$/

/**
 * The pull request's body. The first line is a marker for this space; the rest is for people. The
 * reason is a member's own text, so it goes in a code span: on GitHub it can't mention anyone, link
 * an issue or add HTML.
 */
export function pullRequestBody(marker: Marker, reason: string): string {
  // < and > escaped, so nothing in the JSON can end the HTML comment.
  const json = JSON.stringify(marker).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return [
    `<!-- miso-proposal ${json} -->`,
    `Proposed in Tamari by ${codeSpan(marker.email)}.`,
    '',
    `Why: ${codeSpan(reason)}`,
    '',
    `${marker.kind === 'new' ? 'Adds the note' : 'Changes the note'} ${codeSpan(marker.path)}. Review and merge it like any other pull request. The proposer can withdraw it in Tamari, which closes it.`
  ].join('\n')
}

export function pullRequestTitle(kind: 'edit' | 'new', path: string, email: string): string {
  return `${kind === 'new' ? 'Add' : 'Update'} ${oneLine(path)} (proposed by ${oneLine(email)})`.slice(0, 250)
}

/**
 * The commit on the proposal branch. The member's reason stays out of it: in a commit message on
 * the default branch, words such as "fixes #12" would close an issue. The pull request body has it.
 */
export function commitMessage(input: { id: string; path: string; kind: 'edit' | 'new'; email: string }): string {
  const subject = `${input.kind === 'new' ? 'Add' : 'Update'} ${oneLine(input.path)}`.slice(0, 120)
  return [subject, '', `Proposed by ${oneLine(input.email)} in Tamari, proposal ${input.id}`].join('\n')
}

function codeSpan(text: string): string {
  return '`' + oneLine(text).replace(/`/g, "'") + '`'
}

export function parseMarker(body: unknown): Marker | null {
  if (typeof body !== 'string') return null
  const match = MARKER.exec(body.split('\n', 1)[0].trimEnd())
  if (!match) return null
  let d: Record<string, unknown>
  try {
    d = JSON.parse(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
  if (!d || typeof d !== 'object') return null
  if (!isProposalId(d.id) || typeof d.by !== 'string' || !MEMBER_ID.test(d.by) || !isNotePath(d.path)) return null
  if ((d.kind !== 'edit' && d.kind !== 'new') || typeof d.base !== 'string' || !SHA.test(d.base)) return null
  if (typeof d.email !== 'string' || d.email.length > 320) return null
  return { id: d.id, by: d.by, email: oneLine(d.email), path: d.path, kind: d.kind, base: d.base }
}

/** The reason back from the body, for the list. */
function reasonFrom(body: string): string {
  const line = body.split('\n').find(l => l.startsWith('Why: `'))
  return line ? line.slice(6, -1).slice(0, MAX_REASON_CHARS) : ''
}

const sameRepo = (a: unknown, repo: string) => typeof a === 'string' && a.toLowerCase() === repo.toLowerCase()

/**
 * A pull request as a proposal, or null when it is not one this space made for this vault: it must
 * come from a branch in the vault repo itself (not a fork), named miso/<member>/<proposal>, go into
 * `base`, and carry the marker with the same member and proposal. The branch name of a pull request
 * can't be changed after it is opened, and members can't write on GitHub, so the proposer read here
 * is the one the server wrote.
 */
export function fromPullRequest(pr: PullRequest | null | undefined, repo: string, base: string): (ProposalSummary & { marker: Marker; head: string }) | null {
  if (!pr || typeof pr !== 'object' || !Number.isInteger(pr.number) || pr.number < 1) return null
  if (!sameRepo(pr.head?.repo?.full_name, repo) || !sameRepo(pr.base?.repo?.full_name, repo) || pr.base?.ref !== base) return null
  const branch = parseBranch(pr.head.ref)
  const marker = parseMarker(pr.body)
  if (!branch || !marker || marker.id !== branch.proposalId || marker.by !== branch.memberId) return null
  if (typeof pr.head.sha !== 'string' || !SHA.test(pr.head.sha)) return null
  if (typeof pr.html_url !== 'string' || !pr.html_url.startsWith('https://github.com/')) return null
  const status: ProposalStatus = pr.state === 'open' ? 'open' : pr.merged_at ? 'merged' : 'closed'
  const closedAt = status === 'merged' ? pr.merged_at : status === 'closed' ? pr.closed_at : null
  return {
    id: marker.id,
    number: pr.number,
    url: pr.html_url.slice(0, 500),
    repo,
    branch: base,
    path: marker.path,
    kind: marker.kind,
    reason: reasonFrom(pr.body ?? ''),
    status,
    proposer: { id: branch.memberId, email: marker.email },
    createdAt: String(pr.created_at).slice(0, 40),
    ...(typeof closedAt === 'string' ? { closedAt: closedAt.slice(0, 40) } : {}),
    marker,
    head: pr.head.sha
  }
}

/** The summary without the fields only the server uses. */
export function summarize(p: ProposalSummary & { marker?: Marker; head?: string }): ProposalSummary {
  const { marker: _marker, head: _head, ...summary } = p
  return summary
}

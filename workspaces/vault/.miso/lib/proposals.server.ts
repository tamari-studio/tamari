// Proposals in miso: the list, one proposal with both versions of the note, and withdrawing your
// own. Each one is a pull request on the vault repo and GitHub is the truth: its state (open,
// merged, closed), and who proposed it, are read from the pull request on every call, never from
// anything a member can write. Developers review and merge on GitHub; miso has no approve button.
import { requireCaller } from '@miso/caller'
import { baseBranchName, closePullRequest, deleteBranch, fetchNote, getPullRequest, listPullRequests, requireVault, type VaultConfig } from './github'
import { branchName, fromPullRequest, summarize, type ProposalSummary } from './proposals'

export interface ProposalList {
  proposals: ProposalSummary[]
  /** The caller's user id, to tell their own proposals apart. */
  me: string
}

export interface ProposalDetail {
  proposal: ProposalSummary
  /** The note before the change: at the commit the proposal started from; '' for a new note. */
  oldContent: string
  /** The note on the proposal's branch now (a developer may have changed it there). */
  newContent: string
  /** GitHub says the pull request can't be merged as it is (the note changed since). */
  conflict: boolean
  canWithdraw: boolean
}

function requireNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 1e9) throw new Error('This is not a proposal.')
  return value
}

async function load(config: VaultConfig, number: number) {
  const base = await baseBranchName(config)
  const pr = await getPullRequest(config, number)
  const proposal = fromPullRequest(pr, config.repo, base)
  // Any other pull request on the repo is not a proposal, and is not shown here.
  if (!pr || !proposal) throw new Error('This proposal does not exist.')
  return { proposal, mergeable: pr.mergeable }
}

/** Proposals for the connected vault, newest first: "open", or "closed" (merged or closed). The newest 100 of each. */
export async function listProposals(which: 'open' | 'closed' = 'open'): Promise<ProposalList> {
  const caller = requireCaller()
  if (which !== 'open' && which !== 'closed') throw new Error('Ask for open or closed proposals.')
  const config = requireVault()
  const base = await baseBranchName(config)
  const proposals = (await listPullRequests(config, base, which))
    .map(pr => fromPullRequest(pr, config.repo, base))
    .filter(p => p !== null)
    .map(summarize)
  return { proposals, me: caller.id }
}

/** One proposal, by its pull request number, with the old and the new text of the note. */
export async function getProposal(number: number): Promise<ProposalDetail> {
  const caller = requireCaller()
  const config = requireVault()
  const { proposal, mergeable } = await load(config, requireNumber(number))
  // Read by commit, so this still works once the branch is deleted after a merge or a withdrawal.
  const [before, after] = await Promise.all([proposal.kind === 'edit' ? fetchNote(config, proposal.path, proposal.marker.base) : null, fetchNote(config, proposal.path, proposal.head)])
  const open = proposal.status === 'open'
  return {
    proposal: summarize(proposal),
    oldContent: before?.content ?? '',
    newContent: after?.content ?? '',
    // null: GitHub is still working it out.
    conflict: open && mergeable === false,
    canWithdraw: open && proposal.proposer.id === caller.id
  }
}

/**
 * Takes back one of your own open proposals: closes its pull request and deletes its branch. Whose
 * it is comes from GitHub (the branch name and the marker the server wrote), so nobody can withdraw
 * someone else's by changing data in miso.
 */
export async function withdrawProposal(number: number): Promise<ProposalSummary> {
  const caller = requireCaller()
  const config = requireVault()
  const { proposal } = await load(config, requireNumber(number))
  if (proposal.proposer.id !== caller.id) throw new Error('Only the person who made a proposal can withdraw it.')
  if (proposal.status !== 'open') throw new Error(`This proposal is already ${proposal.status}.`)
  const closed = fromPullRequest(await closePullRequest(config, proposal.number), config.repo, proposal.branch)
  await deleteBranch(config, branchName(proposal.proposer.id, proposal.id))
  return summarize(closed ?? { ...proposal, status: 'closed' })
}

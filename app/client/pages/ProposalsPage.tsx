// Proposals: a member's change to a space, or their draft space to share, waiting for an admin or
// owner (server/proposal-routes.ts). Admins and owners see every proposal, read its changes as
// plain text, and approve or reject it; approving puts the member's code live, in one build and one
// commit. There is deliberately no "Open the draft" here: a draft's code runs in the admin's
// browser with their session and could approve its own proposal. The draft stays reachable by its
// address, behind its warning (components/DraftGate.tsx).
// Members see their own proposals, the decision and the reason, and can withdraw one.
import { useState } from 'react'
import type { Proposal, ProposalStatus } from '../../lib/types'
import { formatLastActive } from '../lib/relative-time'
import { toast } from '../lib/toast'
import { useDecideProposal, useMe, useProposalDiff, useProposals } from '../lib/queries'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { Textarea } from '../ui/textarea'

const STATUS: Record<ProposalStatus, { label: string; variant: 'secondary' | 'outline' | 'destructive' }> = {
  open: { label: 'Waiting', variant: 'secondary' },
  approved: { label: 'Approved', variant: 'outline' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  withdrawn: { label: 'Withdrawn', variant: 'outline' },
  out_of_date: { label: 'Out of date', variant: 'destructive' }
}

export function what(p: Pick<Proposal, 'kind' | 'spaceName' | 'visibility'>): string {
  if (p.kind === 'change') return `Change to ${p.spaceName}`
  return `Share ${p.spaceName} with ${p.visibility === 'team' ? "the author's teams" : 'everyone'}`
}

function Changes({ id }: { id: string }) {
  const diff = useProposalDiff(id, true)
  if (diff.isPending) return <Skeleton className="h-32 w-full" />
  if (diff.isError) return <p className="text-sm text-destructive">Couldn't load the changes: {diff.error.message}</p>
  if (!diff.data.diff) return <p className="text-sm text-muted-foreground">No file differs from the space.</p>
  return (
    <div className="flex flex-col gap-1">
      {/* Text only, never rendered as HTML. */}
      <pre className="max-h-[60dvh] overflow-auto rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">{diff.data.diff}</pre>
      {diff.data.cut && <p className="text-xs text-muted-foreground">The changes are longer than this; only the first part is shown.</p>}
    </div>
  )
}

function Row({ proposal: p, decider }: { proposal: Proposal; decider: boolean }) {
  const decide = useDecideProposal()
  const [showing, setShowing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const open = p.status === 'open'

  const approve = () =>
    decide.mutate(
      { id: p.id, action: 'approve' },
      {
        onSuccess: result => {
          if (result.status === 'approved') toast(`${what(p)} is live.`, 'success')
          else if (result.status === 'out of date') toast('The space changed after this draft was made, so the proposal is out of date. The author makes it again.', 'error')
          else if (result.status === 'put back') toast("It didn't build, so nothing changed. The errors are below.", 'error')
        }
      }
    )

  const failed = decide.data?.status === 'put back' ? decide.data.errors : null

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-background px-4 py-3 shadow-xs">
      <div className="flex items-start justify-between gap-4 max-md:flex-col">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{p.summary}</span>
          <span className="text-xs text-muted-foreground">
            {what(p)} · {p.mine ? 'you' : p.author} · {formatLastActive(p.createdAt)}
          </span>
          {p.reason && p.status !== 'open' && <span className="text-xs text-muted-foreground">Why: {p.reason}</span>}
        </div>
        <Badge variant={STATUS[p.status].variant} className="shrink-0">
          {STATUS[p.status].label}
        </Badge>
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {decider && (
            <>
              <Button size="sm" variant="outline" onClick={() => setShowing(s => !s)} aria-expanded={showing}>
                {showing ? 'Hide the changes' : 'Show the changes'}
              </Button>
              <Button size="sm" disabled={decide.isPending} onClick={approve}>
                {decide.isPending && decide.variables?.action === 'approve' ? 'Building…' : 'Approve'}
              </Button>
              <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => setRejecting(r => !r)}>
                Reject
              </Button>
            </>
          )}
          {p.mine && (
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, action: 'withdraw' })}>
              Withdraw
            </Button>
          )}
        </div>
      )}

      {rejecting && open && (
        <form
          className="flex flex-col gap-2"
          onSubmit={e => {
            e.preventDefault()
            decide.mutate({ id: p.id, action: 'reject', reason }, { onSuccess: () => setRejecting(false) })
          }}
        >
          <label className="text-xs text-muted-foreground" htmlFor={`reason-${p.id}`}>
            Why, so {p.author} knows what to change
          </label>
          <Textarea id={`reason-${p.id}`} value={reason} maxLength={500} rows={2} onChange={e => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" type="submit" variant="destructive" disabled={!reason.trim() || decide.isPending}>
              Reject
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {decide.isError && <p className="text-sm text-destructive">{decide.error.message}</p>}
      {failed && <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs text-destructive">{failed}</pre>}
      {showing && open && <Changes id={p.id} />}
    </li>
  )
}

export function ProposalsPage() {
  const proposals = useProposals()
  const tier = useMe().data?.tier
  const decider = tier === 'admin' || tier === 'owner'
  const list = proposals.data ?? []
  const waiting = list.filter(p => p.status === 'open')
  const decided = list.filter(p => p.status !== 'open').slice(0, 50)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 max-md:p-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Proposals</h1>
        <p className="text-sm text-muted-foreground">
          {decider
            ? "Changes members made to spaces, and spaces they want to share, from their coding agent. Approve one to put it live; nothing changes until you do."
            : 'Changes you sent from your coding agent, and what an admin decided.'}
        </p>
      </header>

      {proposals.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      )}
      {proposals.isError && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-destructive">Couldn't load the proposals: {proposals.error.message}</p>
          <Button size="sm" variant="outline" onClick={() => proposals.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {proposals.data === null && <p className="text-sm text-muted-foreground">This install has no proposals: spaces are changed in its repository.</p>}

      {proposals.data && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Waiting</h2>
            {waiting.length ? (
              <ul className="flex flex-col gap-2">
                {waiting.map(p => (
                  <Row key={p.id} proposal={p} decider={decider} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                {decider
                  ? 'Nothing waits for you. When a member changes a space with their coding agent and sends it, it shows up here.'
                  : 'Nothing waits. Change a space with your coding agent, then send it with submit_proposal.'}
              </p>
            )}
          </section>
          {decided.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">Decided</h2>
              <ul className="flex flex-col gap-2">
                {decided.map(p => (
                  <Row key={p.id} proposal={p} decider={decider} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}

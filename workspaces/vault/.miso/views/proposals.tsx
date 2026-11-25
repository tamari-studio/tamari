import { IconExternalLink } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { countChanges, diffRows, type DiffRow } from '../lib/diff'
import { noteTitle } from '../lib/paths'
import type { ProposalStatus, ProposalSummary } from '../lib/proposals'
import { getProposal, listProposals, withdrawProposal, type ProposalDetail, type ProposalList } from '../lib/proposals.server'
import { Back, day, errorText, OUTLINE } from './_ui'
import { VaultPage } from './_vault'

export const config = { title: 'Proposals', icon: 'message' } as const

const STATUS: Record<ProposalStatus, string> = { open: 'Open', merged: 'Merged', closed: 'Closed without merging' }

export default function Proposals() {
  return <VaultPage title="Proposals">{() => <Review />}</VaultPage>
}

function Review() {
  const [which, setWhich] = useState<'open' | 'closed'>('open')
  const [openNumber, setOpenNumber] = useState<number | null>(null)
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; list: ProposalList }>({ status: 'loading' })
  const load = useCallback(() => {
    setState({ status: 'loading' })
    listProposals(which).then(
      list => setState({ status: 'ready', list }),
      e => setState({ status: 'error', message: errorText(e) })
    )
  }, [which])
  useEffect(load, [load])

  if (openNumber) {
    return (
      <One
        key={openNumber}
        number={openNumber}
        onBack={() => {
          setOpenNumber(null)
          load()
        }}
      />
    )
  }
  const tab = (value: 'open' | 'closed', label: string) => (
    <button type="button" aria-pressed={which === value} onClick={() => setWhich(value)} className={`h-8 rounded-lg px-3 text-sm ${which === value ? 'bg-accent font-medium' : 'text-muted-foreground hover:bg-accent'}`}>
      {label}
    </button>
  )
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">Changes to notes that people suggested. Each one is a pull request on the vault's GitHub repo. Developers review it there, and the note changes when they merge it.</p>
      <div className="flex gap-1">
        {tab('open', 'Open')}
        {tab('closed', 'Merged or closed')}
      </div>
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading proposals…</p>}
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
      {state.status === 'ready' && state.list.proposals.length === 0 && (
        <p className="text-sm text-muted-foreground">{which === 'open' ? 'No proposal is open. To suggest a change, open a note in Vault overview and select Suggest a change.' : 'No proposal has been merged or closed yet.'}</p>
      )}
      {state.status === 'ready' && (
        <ul className="flex flex-col gap-0.5">
          {state.list.proposals.map(p => (
            <Row key={p.number} proposal={p} mine={p.proposer.id === state.list.me} onOpen={() => setOpenNumber(p.number)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Row({ proposal: p, mine, onOpen }: { proposal: ProposalSummary; mine: boolean; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left hover:bg-accent">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{noteTitle(p.path)}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{p.kind === 'new' ? 'New note' : 'Change'}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {STATUS[p.status]} · #{p.number}
          </span>
        </span>
        <span className="truncate text-sm">{p.reason}</span>
        <span className="truncate text-xs text-muted-foreground">
          {mine ? 'You' : p.proposer.email} · {day(p.createdAt)} · {p.path}
        </span>
      </button>
    </li>
  )
}

function One({ number, onBack }: { number: number; onBack: () => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; detail: ProposalDetail }>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    getProposal(number).then(
      detail => setState({ status: 'ready', detail }),
      e => setState({ status: 'error', message: errorText(e) })
    )
  }, [number])
  useEffect(load, [load])

  const withdraw = () => {
    setBusy(true)
    setError(null)
    withdrawProposal(number)
      .then(
        () => undefined,
        e => setError(errorText(e))
      )
      .then(load)
      .finally(() => setBusy(false))
  }

  return (
    <article className="flex flex-col gap-4">
      <Back label="All proposals" onClick={onBack} />
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading the proposal…</p>}
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
      {state.status === 'ready' && (
        <Detail
          detail={state.detail}
          actions={
            <>
              {state.detail.conflict && <p className="rounded-lg border border-destructive/40 p-3 text-sm">The note changed in the vault after this proposal was made, so GitHub cannot merge it as it is. A developer can fix it on GitHub, or you can withdraw it and propose again from the current note.</p>}
              {error && <p className="text-sm text-destructive">{error}</p>}
              {state.detail.canWithdraw && (
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className={OUTLINE} disabled={busy} onClick={withdraw}>
                    {busy ? 'Withdrawing…' : 'Withdraw'}
                  </button>
                  <span className="text-xs text-muted-foreground">Closes the pull request and deletes its branch.</span>
                </div>
              )}
            </>
          }
        />
      )}
    </article>
  )
}

function Detail({ detail, actions }: { detail: ProposalDetail; actions: React.ReactNode }) {
  const p = detail.proposal
  const rows = useMemo(() => diffRows(detail.oldContent, detail.newContent), [detail.oldContent, detail.newContent])
  const { added, removed } = countChanges(rows)
  return (
    <>
      <header className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold break-words">{noteTitle(p.path)}</h2>
        <p className="text-xs break-all text-muted-foreground">
          {p.kind === 'new' ? 'New note' : 'Change'} · {p.path}
        </p>
      </header>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 text-sm">
        <dt className="text-muted-foreground">Why</dt>
        <dd className="min-w-0 break-words">{p.reason}</dd>
        <dt className="text-muted-foreground">Proposed by</dt>
        <dd className="min-w-0 break-words">
          {p.proposer.email} · {day(p.createdAt)}
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd className="min-w-0 break-words">
          {STATUS[p.status]}
          {p.closedAt && ` · ${day(p.closedAt)}`}
          {p.status === 'open' && ', waiting for a developer on GitHub'}
          <a href={p.url} target="_blank" rel="noreferrer" className="ml-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <IconExternalLink size={12} stroke={1.75} />
            Pull request #{p.number} on GitHub
          </a>
        </dd>
      </dl>
      {actions}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          {p.kind === 'new' ? `The new note, ${added} lines` : `What changes: ${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} removed`}
        </h3>
        <Diff rows={rows} />
      </section>
    </>
  )
}

const ROW: Record<Exclude<DiffRow['type'], 'skip'>, { mark: string; label: string; className: string }> = {
  same: { mark: ' ', label: '', className: '' },
  add: { mark: '+', label: 'Added: ', className: 'bg-success/15' },
  remove: { mark: '-', label: 'Removed: ', className: 'bg-destructive/10 text-muted-foreground' }
}

function Diff({ rows }: { rows: DiffRow[] }) {
  if (rows.every(r => r.type === 'same' || r.type === 'skip')) return <p className="text-sm text-muted-foreground">The text is the same as the note in the vault.</p>
  return (
    <div className="overflow-x-auto rounded-lg border font-mono text-xs leading-5">
      {rows.map((row, i) =>
        row.type === 'skip' ? (
          <div key={i} className="border-y bg-accent px-3 py-0.5 font-sans text-muted-foreground first:border-t-0 last:border-b-0">
            {row.count} {row.count === 1 ? 'line' : 'lines'} not changed
          </div>
        ) : (
          <div key={i} className={`flex gap-2 px-3 ${ROW[row.type].className}`}>
            <span aria-hidden className="w-2 shrink-0 text-muted-foreground select-none">
              {ROW[row.type].mark}
            </span>
            <span className="sr-only">{ROW[row.type].label}</span>
            <span className="min-w-0 break-words whitespace-pre-wrap">{row.text || ' '}</span>
          </div>
        )
      )}
    </div>
  )
}

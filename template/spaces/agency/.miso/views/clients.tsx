import { IconPencil, IconPlus } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'

import { listClients, loadExampleClients, removeClient, removeExampleClients, saveClient } from '../lib/clients.server'
import { STATUSES, STATUS_LABEL, isOverdue, sortClients, summary, type Client, type Status } from '../lib/clients'
import type { Saved } from '../lib/rows'
import { Badge, Button, Card, Empty, ExamplesBar, Field, Page, Problem, cx, inputClass, shortDay, today, useRows, type Tone } from '../ui/kit'

export const config = { title: 'Clients', icon: 'briefcase' } as const

type Draft = Client & { key?: string }

const BLANK: Draft = { name: '', contact: '', owner: '', status: 'lead', nextStep: '', nextDate: '' }
const STATUS_TONE: Record<Status, Tone> = { lead: 'accent', active: 'good', paused: 'outline', done: 'plain' }

export default function Clients() {
  const { state, busy, problem, run } = useRows(listClients)
  const [filter, setFilter] = useState<Status | 'all'>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const now = today()

  const rows = state.status === 'ready' ? sortClients(state.rows) : []
  const sums = summary(rows, now)
  const shown = filter === 'all' ? rows : rows.filter(c => c.status === filter)
  const count = rows.length === 0 ? undefined : [`${sums.active} active`, `${sums.leads} ${sums.leads === 1 ? 'lead' : 'leads'}`, sums.overdue > 0 && `${sums.overdue} overdue`].filter(Boolean).join(' · ')

  const save = async (next: Draft) => {
    if (await run(() => saveClient(next))) setDraft(null)
  }
  const remove = async (key: string) => {
    if (await run(() => removeClient(key))) setDraft(null)
  }

  return (
    <Page
      title="Clients"
      count={count}
      actions={
        state.status === 'ready' && (
          <Button variant="primary" onClick={() => setDraft({ ...BLANK })} disabled={busy}>
            <IconPlus size={16} stroke={1.75} />
            Add client
          </Button>
        )
      }
    >
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading your clients…</p>}
      {state.status === 'error' && <Problem message={state.message} />}
      {!draft && <Problem message={problem} />}

      {draft && <ClientForm key={draft.key ?? 'new'} draft={draft} busy={busy} problem={problem} onSave={save} onRemove={remove} onCancel={() => setDraft(null)} />}

      {state.status === 'ready' && rows.length === 0 && !draft && (
        <Empty
          title="Keep every client and its next step in one place"
          steps={[
            'Add each client you work with or hope to win.',
            'Give each one a status, an owner on your team and the next step with a due date.',
            'Look here on Monday: overdue steps are marked, and the Next steps widget shows what comes first.'
          ]}
        >
          <Button variant="primary" onClick={() => setDraft({ ...BLANK })} disabled={busy}>
            Add your first client
          </Button>
          <Button onClick={() => run(() => loadExampleClients(now))} disabled={busy}>
            Try it with examples
          </Button>
        </Empty>
      )}

      {rows.length > 0 && (
        <>
          <ExamplesBar count={rows.filter(c => c.example).length} busy={busy} onRemove={() => run(removeExampleClients)} />
          <div className="flex flex-wrap gap-1" role="group" aria-label="Show clients with status">
            {(['all', ...STATUSES] as const).map(status => (
              <button
                key={status}
                type="button"
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
                className={cx('rounded-md px-2 py-1 text-xs font-medium transition-colors', filter === status ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {status === 'all' ? 'All' : STATUS_LABEL[status]} <span className="tabular-nums">{status === 'all' ? rows.length : rows.filter(c => c.status === status).length}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 && <p className="text-sm text-muted-foreground">No clients with this status.</p>}
          <ul className="flex flex-col divide-y divide-border">
            {shown.map(client => (
              <ClientRow key={client.key} client={client} overdue={isOverdue(client, now)} onEdit={() => setDraft(client)} />
            ))}
          </ul>
        </>
      )}
    </Page>
  )
}

function ClientRow({ client, overdue, onEdit }: { client: Saved<Client>; overdue: boolean; onEdit: () => void }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,14rem)_5.5rem_minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 truncate text-sm font-medium">
          <span className="truncate">{client.name}</span>
          {client.example && <Badge tone="outline">Example</Badge>}
        </span>
        <span className="truncate text-xs text-muted-foreground">{[client.contact, client.owner && `Owner: ${client.owner}`].filter(Boolean).join(' · ') || 'No contact yet'}</span>
      </div>
      <div className="max-sm:col-start-1 max-sm:row-start-2">
        <Badge tone={STATUS_TONE[client.status]}>{STATUS_LABEL[client.status]}</Badge>
      </div>
      <div className="flex min-w-0 flex-col max-sm:col-span-2">
        <span className={cx('truncate text-sm', !client.nextStep && 'text-muted-foreground')}>{client.nextStep || 'No next step'}</span>
        {client.nextDate && <span className={cx('text-xs tabular-nums', overdue ? 'text-destructive' : 'text-muted-foreground')}>{overdue ? `Overdue since ${shortDay(client.nextDate)}` : `Due ${shortDay(client.nextDate)}`}</span>}
      </div>
      <Button variant="ghost" onClick={onEdit} aria-label={`Edit ${client.name}`} className="max-sm:col-start-2 max-sm:row-start-1">
        <IconPencil size={16} stroke={1.75} />
        Edit
      </Button>
    </li>
  )
}

function ClientForm({ draft, busy, problem, onSave, onRemove, onCancel }: { draft: Draft; busy: boolean; problem: string | null; onSave: (d: Draft) => void; onRemove: (key: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState(draft)
  const [sure, setSure] = useState(false)
  const set = (patch: Partial<Draft>) => setForm(f => ({ ...f, ...patch }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(form)
  }
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="text-base font-medium">{form.key ? `Edit ${draft.name}` : 'New client'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client name">
            <input className={inputClass} value={form.name} onChange={e => set({ name: e.target.value })} maxLength={80} required autoFocus />
          </Field>
          <Field label="Status">
            <select className={inputClass} value={form.status} onChange={e => set({ status: e.target.value as Status })}>
              {STATUSES.map(status => (
                <option key={status} value={status}>
                  {STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Contact" hint="who you talk to there">
            <input className={inputClass} value={form.contact} onChange={e => set({ contact: e.target.value })} maxLength={80} />
          </Field>
          <Field label="Owner" hint="who on your team">
            <input className={inputClass} value={form.owner} onChange={e => set({ owner: e.target.value })} maxLength={60} />
          </Field>
          <Field label="Next step">
            <input className={inputClass} value={form.nextStep} onChange={e => set({ nextStep: e.target.value })} maxLength={160} placeholder="Send the proposal" />
          </Field>
          <Field label="Due date">
            <input type="date" className={inputClass} value={form.nextDate} onChange={e => set({ nextDate: e.target.value })} />
          </Field>
        </div>
        <Problem message={problem} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {form.key ? 'Save' : 'Add client'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {form.key &&
            (sure ? (
              <Button variant="danger" className="ml-auto" onClick={() => onRemove(form.key!)} disabled={busy}>
                Yes, remove {draft.name}
              </Button>
            ) : (
              <Button variant="ghost" className="ml-auto" onClick={() => setSure(true)} disabled={busy}>
                Remove
              </Button>
            ))}
        </div>
      </form>
    </Card>
  )
}

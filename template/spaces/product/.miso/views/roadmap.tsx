import { IconPencil, IconPlus } from '@tabler/icons-react'
import { useState, type FormEvent, type ReactNode } from 'react'

import { addAsk, listRequests, loadExampleRequests, removeExampleRequests, removeRequest, saveRequest, setStatus } from '../lib/requests.server'
import { STATUSES, STATUS_LABEL, askedText, declined, inbox, nextStep, roadmap, summary, type Request, type Status } from '../lib/requests'
import type { Saved } from '../lib/rows'
import { Badge, Button, Card, Empty, ExamplesBar, Field, Page, Problem, inputClass, useRows, type Tone } from '../ui/kit'

export const config = { title: 'Roadmap', icon: 'bulb' } as const

/** The form holds the count as typed; the server reads the number. */
type Draft = Omit<Request, 'asked'> & { asked: string; key?: string }

const BLANK: Draft = { title: '', from: '', detail: '', status: 'new', asked: '1' }
const edit = (request: Saved<Request>): Draft => ({ ...request, asked: String(request.asked) })
const STATUS_TONE: Record<Status, Tone> = { new: 'outline', planned: 'accent', building: 'accent', shipped: 'good', declined: 'plain' }

export default function Roadmap() {
  const { state, busy, problem, run } = useRows(listRequests)
  const [draft, setDraft] = useState<Draft | null>(null)

  const rows = state.status === 'ready' ? state.rows : []
  const counts = summary(rows)
  const count = rows.length === 0 ? undefined : `${counts.new} new · ${counts.building} in progress · ${counts.planned} planned`
  const waiting = inbox(rows)
  const aside = declined(rows)

  const save = async (next: Draft) => {
    if (await run(() => saveRequest(next))) setDraft(null)
  }
  const remove = async (key: string) => {
    if (await run(() => removeRequest(key))) setDraft(null)
  }
  const row = (request: Saved<Request>) => (
    <RequestRow key={request.key} request={request} busy={busy} onStatus={status => run(() => setStatus(request.key, status))} onAsk={() => run(() => addAsk(request.key))} onEdit={() => setDraft(edit(request))} />
  )

  return (
    <Page
      title="Roadmap"
      count={count}
      actions={
        state.status === 'ready' && (
          <Button variant="primary" onClick={() => setDraft({ ...BLANK })} disabled={busy}>
            <IconPlus size={16} stroke={1.75} />
            Add request
          </Button>
        )
      }
    >
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading the requests…</p>}
      {state.status === 'error' && <Problem message={state.message} />}
      {!draft && <Problem message={problem} />}

      {draft && <RequestForm key={draft.key ?? 'new'} draft={draft} busy={busy} problem={problem} onSave={save} onRemove={remove} onCancel={() => setDraft(null)} />}

      {state.status === 'ready' && rows.length === 0 && !draft && (
        <Empty
          title="From what people ask for to what you build"
          steps={[
            'Add a request each time a customer or a colleague asks for something, with who asked and the problem behind it.',
            'When someone else asks for the same thing, select +1 on it. The most asked requests rise to the top.',
            'Once a week, go through the new ones: plan it, or put it aside as Not now. Planned requests move along the roadmap to Shipped.'
          ]}
        >
          <Button variant="primary" onClick={() => setDraft({ ...BLANK })} disabled={busy}>
            Add your first request
          </Button>
          <Button onClick={() => run(loadExampleRequests)} disabled={busy}>
            Try it with examples
          </Button>
        </Empty>
      )}

      {rows.length > 0 && (
        <>
          <ExamplesBar count={rows.filter(r => r.example).length} busy={busy} onRemove={() => run(removeExampleRequests)} />
          <Group title="New requests" count={waiting.length} empty="Nothing new. Every request has an answer.">
            {waiting.map(row)}
          </Group>
          {roadmap(rows).map(group => (
            <Group key={group.status} title={STATUS_LABEL[group.status]} count={group.requests.length} empty={group.status === 'shipped' ? 'Nothing shipped yet.' : 'Nothing here right now.'}>
              {group.requests.map(row)}
            </Group>
          ))}
          {aside.length > 0 && (
            <Group title="Not now" count={aside.length} empty="">
              {aside.map(row)}
            </Group>
          )}
        </>
      )}
    </Page>
  )
}

function Group({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h2 className="flex items-baseline gap-2 text-sm font-medium">
        {title}
        <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
      </h2>
      {count === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : <ul className="flex flex-col divide-y divide-border">{children}</ul>}
    </section>
  )
}

function RequestRow({ request, busy, onStatus, onAsk, onEdit }: { request: Saved<Request>; busy: boolean; onStatus: (status: Status) => void; onAsk: () => void; onEdit: () => void }) {
  const next = nextStep(request.status)
  const open = request.status !== 'shipped' && request.status !== 'declined'
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="flex min-w-0 flex-1 basis-64 flex-col">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{request.title}</span>
          <Badge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Badge>
          {request.example && <Badge tone="outline">Example</Badge>}
        </span>
        <span className="truncate text-xs text-muted-foreground">{[askedText(request.asked), request.from && `first: ${request.from}`].filter(Boolean).join(' · ')}</span>
        {request.detail && <span className="text-xs text-muted-foreground">{request.detail}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {open && (
          <Button onClick={onAsk} disabled={busy} aria-label={`One more person asked for ${request.title}`}>
            +1
          </Button>
        )}
        {next && (
          <Button onClick={() => onStatus(next.to)} disabled={busy} aria-label={`${next.label}: ${request.title}`}>
            {next.label}
          </Button>
        )}
        {request.status === 'new' && (
          <Button variant="ghost" onClick={() => onStatus('declined')} disabled={busy} aria-label={`Not now: ${request.title}`}>
            Not now
          </Button>
        )}
        {request.status === 'declined' && (
          <Button variant="ghost" onClick={() => onStatus('new')} disabled={busy} aria-label={`Look at ${request.title} again`}>
            Look again
          </Button>
        )}
        <Button variant="ghost" onClick={onEdit} aria-label={`Edit ${request.title}`}>
          <IconPencil size={16} stroke={1.75} />
          Edit
        </Button>
      </div>
    </li>
  )
}

function RequestForm({ draft, busy, problem, onSave, onRemove, onCancel }: { draft: Draft; busy: boolean; problem: string | null; onSave: (d: Draft) => void; onRemove: (key: string) => void; onCancel: () => void }) {
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
        <h2 className="text-base font-medium">{form.key ? `Edit ${draft.title}` : 'New request'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Request" hint="what they ask for, in one line" className="sm:col-span-2">
            <input className={inputClass} value={form.title} onChange={e => set({ title: e.target.value })} maxLength={120} required autoFocus />
          </Field>
          <Field label="Who asked" hint="a customer, a colleague, a team">
            <input className={inputClass} value={form.from} onChange={e => set({ from: e.target.value })} maxLength={80} />
          </Field>
          <Field label="How many asked">
            <input className={inputClass} inputMode="numeric" value={form.asked} onChange={e => set({ asked: e.target.value })} maxLength={4} />
          </Field>
          <Field label="The problem behind it" hint="in their words" className="sm:col-span-2">
            <textarea className={inputClass} rows={3} value={form.detail} onChange={e => set({ detail: e.target.value })} maxLength={600} placeholder="What do they do today, and what does it cost them?" />
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
        </div>
        <Problem message={problem} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {form.key ? 'Save' : 'Add request'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {form.key &&
            (sure ? (
              <Button variant="danger" className="ml-auto" onClick={() => onRemove(form.key!)} disabled={busy}>
                Yes, remove this request
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

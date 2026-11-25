import { IconArrowRight, IconPencil, IconPlus } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'

import { listDeals, loadExampleDeals, moveDeal, removeDeal, removeExampleDeals, saveDeal } from '../lib/deals.server'
import { STAGES, STAGE_LABEL, byStage, isOverdue, nextStage, summary, type Deal, type Stage } from '../lib/deals'
import type { Saved } from '../lib/rows'
import { Badge, Button, Card, Empty, ExamplesBar, Field, Page, Problem, cx, inputClass, shortDay, today, useRows, wholeNumber, type Tone } from '../ui/kit'

export const config = { title: 'Pipeline', icon: 'target' } as const

/** The form holds the value as typed; the server reads the number. */
type Draft = Omit<Deal, 'value'> & { value: string; key?: string }

const BLANK: Draft = { company: '', what: '', stage: 'new', value: '', owner: '', nextStep: '', nextDate: '' }
const edit = (deal: Saved<Deal>): Draft => ({ ...deal, value: deal.value === null ? '' : String(deal.value) })
const STAGE_TONE: Record<Stage, Tone> = { new: 'outline', talking: 'accent', offer: 'accent', won: 'good', lost: 'plain' }

export default function Pipeline() {
  const { state, busy, problem, run } = useRows(listDeals)
  const [draft, setDraft] = useState<Draft | null>(null)
  const now = today()

  const rows = state.status === 'ready' ? state.rows : []
  const sums = summary(rows, now)
  const count = rows.length === 0 ? undefined : [`${sums.open} open, worth ${wholeNumber(sums.openValue)}`, sums.overdue > 0 && `${sums.overdue} overdue`].filter(Boolean).join(' · ')

  const save = async (next: Draft) => {
    if (await run(() => saveDeal(next))) setDraft(null)
  }
  const remove = async (key: string) => {
    if (await run(() => removeDeal(key))) setDraft(null)
  }

  return (
    <Page
      title="Pipeline"
      count={count}
      actions={
        state.status === 'ready' && (
          <Button variant="primary" onClick={() => setDraft({ ...BLANK })} disabled={busy}>
            <IconPlus size={16} stroke={1.75} />
            Add deal
          </Button>
        )
      }
    >
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading your deals…</p>}
      {state.status === 'error' && <Problem message={state.message} />}
      {!draft && <Problem message={problem} />}

      {draft && <DealForm key={draft.key ?? 'new'} draft={draft} busy={busy} problem={problem} onSave={save} onRemove={remove} onCancel={() => setDraft(null)} />}

      {state.status === 'ready' && rows.length === 0 && !draft && (
        <Empty
          title="Every deal, where it stands and what happens next"
          steps={[
            'Add each company you are trying to sell to, with what they would buy and what it is worth.',
            'Give each deal an owner on your team and a next step with a due date.',
            'Move a deal along as it goes: New, Talking, Offer sent, then Won or Lost. The Open deals widget adds up what is still open.'
          ]}
        >
          <Button variant="primary" onClick={() => setDraft({ ...BLANK })} disabled={busy}>
            Add your first deal
          </Button>
          <Button onClick={() => run(() => loadExampleDeals(now))} disabled={busy}>
            Try it with examples
          </Button>
        </Empty>
      )}

      {rows.length > 0 && (
        <>
          <ExamplesBar count={rows.filter(d => d.example).length} busy={busy} onRemove={() => run(removeExampleDeals)} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {byStage(rows).map(column => (
              <section key={column.stage} className="flex min-w-0 flex-col gap-2" aria-label={STAGE_LABEL[column.stage]}>
                <h2 className="flex items-baseline gap-2 text-sm font-medium">
                  <Badge tone={STAGE_TONE[column.stage]}>{STAGE_LABEL[column.stage]}</Badge>
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {column.deals.length}
                    {column.value > 0 && ` · ${wholeNumber(column.value)}`}
                  </span>
                </h2>
                {column.deals.length === 0 && <p className="text-xs text-muted-foreground">No deals here.</p>}
                <ul className="flex flex-col gap-2">
                  {column.deals.map(deal => (
                    <DealCard key={deal.key} deal={deal} overdue={isOverdue(deal, now)} busy={busy} onMove={stage => run(() => moveDeal(deal.key, stage))} onEdit={() => setDraft(edit(deal))} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </Page>
  )
}

function DealCard({ deal, overdue, busy, onMove, onEdit }: { deal: Saved<Deal>; overdue: boolean; busy: boolean; onMove: (stage: Stage) => void; onEdit: () => void }) {
  const next = nextStage(deal.stage)
  return (
    <li>
      <Card className="flex flex-col gap-2 p-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{deal.company}</span>
          {deal.what && <span className="truncate text-xs text-muted-foreground">{deal.what}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{deal.value === null ? 'No value yet' : wholeNumber(deal.value)}</span>
          {deal.owner && <span>{deal.owner}</span>}
          {deal.example && <Badge tone="outline">Example</Badge>}
        </div>
        {(deal.nextStep || deal.nextDate) && (
          <div className="flex min-w-0 flex-col text-xs">
            <span>{deal.nextStep || 'No next step'}</span>
            {deal.nextDate && <span className={cx('tabular-nums', overdue ? 'text-destructive' : 'text-muted-foreground')}>{overdue ? `Overdue since ${shortDay(deal.nextDate)}` : `Due ${shortDay(deal.nextDate)}`}</span>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1">
          {next && (
            <Button onClick={() => onMove(next)} disabled={busy} aria-label={`Move ${deal.company} to ${STAGE_LABEL[next]}`}>
              {STAGE_LABEL[next]}
              <IconArrowRight size={16} stroke={1.75} />
            </Button>
          )}
          <Button variant="ghost" onClick={onEdit} aria-label={`Edit ${deal.company}`}>
            <IconPencil size={16} stroke={1.75} />
            Edit
          </Button>
        </div>
      </Card>
    </li>
  )
}

function DealForm({ draft, busy, problem, onSave, onRemove, onCancel }: { draft: Draft; busy: boolean; problem: string | null; onSave: (d: Draft) => void; onRemove: (key: string) => void; onCancel: () => void }) {
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
        <h2 className="text-base font-medium">{form.key ? `Edit ${draft.company}` : 'New deal'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company">
            <input className={inputClass} value={form.company} onChange={e => set({ company: e.target.value })} maxLength={80} required autoFocus />
          </Field>
          <Field label="Stage" hint="pick Lost here when a deal is off">
            <select className={inputClass} value={form.stage} onChange={e => set({ stage: e.target.value as Stage })}>
              {STAGES.map(stage => (
                <option key={stage} value={stage}>
                  {STAGE_LABEL[stage]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="What they would buy">
            <input className={inputClass} value={form.what} onChange={e => set({ what: e.target.value })} maxLength={120} placeholder="Yearly plan, 20 people" />
          </Field>
          <Field label="Value" hint="a number, no currency sign">
            <input className={inputClass} inputMode="decimal" value={form.value} onChange={e => set({ value: e.target.value })} maxLength={16} />
          </Field>
          <Field label="Owner" hint="who on your team">
            <input className={inputClass} value={form.owner} onChange={e => set({ owner: e.target.value })} maxLength={60} />
          </Field>
          <Field label="Due date" hint="of the next step">
            <input type="date" className={inputClass} value={form.nextDate} onChange={e => set({ nextDate: e.target.value })} />
          </Field>
          <Field label="Next step" className="sm:col-span-2">
            <input className={inputClass} value={form.nextStep} onChange={e => set({ nextStep: e.target.value })} maxLength={160} placeholder="Book a demo" />
          </Field>
        </div>
        <Problem message={problem} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {form.key ? 'Save' : 'Add deal'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {form.key &&
            (sure ? (
              <Button variant="danger" className="ml-auto" onClick={() => onRemove(form.key!)} disabled={busy}>
                Yes, remove {draft.company}
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

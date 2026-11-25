import { IconCheck, IconPencil, IconPlus } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'

import { listMonths, loadExampleMonths, markSent, removeExampleMonths, removeMonth, saveMonth } from '../lib/months.server'
import { addMonths, cashText, growth, monthBefore, monthLabel, newestFirst, percent, updateText, type Month } from '../lib/months'
import type { Saved } from '../lib/rows'
import { Badge, Button, Card, Empty, ExamplesBar, Field, Page, Problem, cx, inputClass, today, useRows, wholeNumber } from '../ui/kit'

export const config = { title: 'Monthly update', icon: 'chart' } as const

/** The form holds what was typed; the server reads the numbers. */
type Draft = { key?: string; month: string; revenue: string; customers: string; cash: string; spend: string; wentWell: string; wentBadly: string; asks: string; sent: boolean }

const blank = (month: string): Draft => ({ month, revenue: '', customers: '', cash: '', spend: '', wentWell: '', wentBadly: '', asks: '', sent: false })
const edit = (row: Saved<Month>): Draft => ({ ...row, revenue: String(row.revenue), customers: String(row.customers), cash: String(row.cash), spend: String(row.spend) })

export default function MonthlyUpdate() {
  const { state, busy, problem, run } = useRows(listMonths)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const now = today()

  const rows = state.status === 'ready' ? newestFirst(state.rows) : []
  const waiting = rows.filter(m => !m.sent).length
  const count = rows.length === 0 ? undefined : [`${rows.length} ${rows.length === 1 ? 'month' : 'months'}`, waiting > 0 && `${waiting} not sent`].filter(Boolean).join(' · ')
  // A new row starts on the month after the newest one, or on last month for the first row.
  const nextMonth = rows[0] ? addMonths(rows[0].month, 1) : addMonths(now.slice(0, 7), -1)

  const save = async (next: Draft) => {
    if (await run(() => saveMonth(next))) setDraft(null)
  }
  const remove = async (key: string) => {
    if (await run(() => removeMonth(key))) setDraft(null)
  }

  return (
    <Page
      title="Monthly update"
      count={count}
      actions={
        state.status === 'ready' && (
          <Button variant="primary" onClick={() => setDraft(blank(nextMonth))} disabled={busy}>
            <IconPlus size={16} stroke={1.75} />
            Add month
          </Button>
        )
      }
    >
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading your months…</p>}
      {state.status === 'error' && <Problem message={state.message} />}
      {!draft && <Problem message={problem} />}

      {draft && <MonthForm key={draft.key ?? 'new'} draft={draft} busy={busy} problem={problem} onSave={save} onRemove={remove} onCancel={() => setDraft(null)} />}

      {state.status === 'ready' && rows.length === 0 && !draft && (
        <Empty
          title="Your numbers and your investor update, once a month"
          steps={[
            'At the start of each month, add last month: revenue, customers, cash in the bank and what you spent.',
            'Write two or three lines on what went well, what did not, and where investors can help.',
            'Open the update, copy it into an email, and mark the month as sent.'
          ]}
        >
          <Button variant="primary" onClick={() => setDraft(blank(nextMonth))} disabled={busy}>
            Add your first month
          </Button>
          <Button onClick={() => run(() => loadExampleMonths(now))} disabled={busy}>
            Try it with examples
          </Button>
        </Empty>
      )}

      {rows.length > 0 && (
        <>
          <ExamplesBar count={rows.filter(m => m.example).length} busy={busy} onRemove={() => run(removeExampleMonths)} />
          <ul className="flex flex-col gap-3">
            {rows.map(row => (
              <MonthRow
                key={row.key}
                row={row}
                before={monthBefore(rows, row)}
                open={open === row.key}
                busy={busy}
                onToggle={() => setOpen(open === row.key ? null : row.key)}
                onSent={sent => run(() => markSent(row.key, sent))}
                onEdit={() => setDraft(edit(row))}
              />
            ))}
          </ul>
        </>
      )}
    </Page>
  )
}

function Number({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-base font-medium tabular-nums">{value}</span>
      {note && <span className={cx('truncate text-xs tabular-nums', tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{note}</span>}
    </div>
  )
}

function MonthRow({ row, before, open, busy, onToggle, onSent, onEdit }: { row: Saved<Month>; before?: Month; open: boolean; busy: boolean; onToggle: () => void; onSent: (sent: boolean) => void; onEdit: () => void }) {
  const [copied, setCopied] = useState(false)
  const change = growth(row.revenue, before?.revenue)
  const more = before ? row.customers - before.customers : 0
  const text = updateText(row, before)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // No clipboard here: the text is on the page and can be selected.
      setCopied(false)
    }
  }
  return (
    <li>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium">{monthLabel(row.month)}</h2>
          <Badge tone={row.sent ? 'good' : 'accent'}>{row.sent ? 'Update sent' : 'Update not sent'}</Badge>
          {row.example && <Badge tone="outline">Example</Badge>}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button variant="ghost" onClick={onToggle} aria-expanded={open}>
              {open ? 'Hide the update' : 'Show the update'}
            </Button>
            <Button variant="ghost" onClick={onEdit} aria-label={`Edit ${monthLabel(row.month)}`}>
              <IconPencil size={16} stroke={1.75} />
              Edit
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Number label="Monthly revenue" value={wholeNumber(row.revenue)} note={change === null ? undefined : `${percent(change)} since ${monthLabel(before!.month)}`} tone={change === null || change === 0 ? undefined : change > 0 ? 'good' : 'bad'} />
          <Number label="Customers" value={wholeNumber(row.customers)} note={more === 0 ? undefined : `${more > 0 ? '+' : ''}${more}`} />
          <Number label="Cash in the bank" value={wholeNumber(row.cash)} note={cashText(row)} />
          <Number label="Spent this month" value={wholeNumber(row.spend)} />
        </div>
        {open && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <pre className="rounded-lg bg-muted p-3 font-sans text-sm whitespace-pre-wrap">{text}</pre>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={copy}>
                {copied && <IconCheck size={16} stroke={1.75} />}
                {copied ? 'Copied' : 'Copy the text'}
              </Button>
              <Button onClick={() => onSent(!row.sent)} disabled={busy}>
                {row.sent ? 'Mark as not sent' : 'Mark as sent'}
              </Button>
              <span className="text-xs text-muted-foreground">Paste it into an email to your investors and add a greeting.</span>
            </div>
          </div>
        )}
      </Card>
    </li>
  )
}

function MonthForm({ draft, busy, problem, onSave, onRemove, onCancel }: { draft: Draft; busy: boolean; problem: string | null; onSave: (d: Draft) => void; onRemove: (key: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState(draft)
  const [sure, setSure] = useState(false)
  const set = (patch: Partial<Draft>) => setForm(f => ({ ...f, ...patch }))
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(form)
  }
  const number = (label: string, field: 'revenue' | 'customers' | 'cash' | 'spend', hint?: string) => (
    <Field label={label} hint={hint}>
      <input className={inputClass} inputMode="decimal" value={form[field]} onChange={e => set({ [field]: e.target.value })} maxLength={16} required />
    </Field>
  )
  const notes = (label: string, field: 'wentWell' | 'wentBadly' | 'asks', placeholder: string) => (
    <Field label={label}>
      <textarea className={inputClass} rows={3} value={form[field]} onChange={e => set({ [field]: e.target.value })} maxLength={1000} placeholder={placeholder} />
    </Field>
  )
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="text-base font-medium">{form.key ? `Edit ${monthLabel(draft.month)}` : 'New month'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Month" className="sm:col-span-2 sm:max-w-56">
            <input type="month" className={inputClass} value={form.month} onChange={e => set({ month: e.target.value })} placeholder="2026-03" pattern="\d{4}-\d{2}" required autoFocus />
          </Field>
          {number('Monthly revenue', 'revenue', 'what comes back every month')}
          {number('Customers', 'customers', 'paying, at the end of the month')}
          {number('Cash in the bank', 'cash', 'at the end of the month')}
          {number('Spent this month', 'spend', 'everything, salaries too')}
        </div>
        <p className="text-xs text-muted-foreground">Use one currency for every month and leave the currency sign out.</p>
        <div className="grid gap-3">
          {notes('What went well', 'wentWell', 'Two or three lines.')}
          {notes('What did not go well', 'wentBadly', 'Investors trust an update that also has the bad news.')}
          {notes('Where investors can help', 'asks', 'An introduction, a second opinion, a candidate.')}
        </div>
        <Problem message={problem} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {form.key ? 'Save' : 'Add month'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {form.key &&
            (sure ? (
              <Button variant="danger" className="ml-auto" onClick={() => onRemove(form.key!)} disabled={busy}>
                Yes, remove {monthLabel(draft.month)}
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

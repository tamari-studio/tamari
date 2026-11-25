import { IconPencil, IconPlus } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'

import { listItems, loadExampleItems, markDone, removeExampleItems, removeItem, saveItem } from '../lib/show.server'
import { byDay, isLate, summary, type Item, type Moment } from '../lib/show'
import type { Saved } from '../lib/rows'
import { Badge, Button, Card, Empty, ExamplesBar, Field, Page, Problem, cx, inputClass, today, useRows } from '../ui/kit'

export const config = { title: 'Run of show', icon: 'calendar' } as const

type Draft = Item & { key?: string }

const LONG_DAY = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const longDay = (day: string) => LONG_DAY.format(new Date(`${day}T12:00:00`))

function moment(): Moment {
  const clock = new Date()
  return { day: today(), time: `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}` }
}

export default function RunOfShow() {
  const { state, busy, problem, run } = useRows(listItems)
  const [draft, setDraft] = useState<Draft | null>(null)
  const now = moment()

  const rows = state.status === 'ready' ? state.rows : []
  const days = byDay(rows)
  const sums = summary(rows, now)
  const count = rows.length === 0 ? undefined : [`${sums.done} of ${rows.length} done`, sums.late > 0 && `${sums.late} late`].filter(Boolean).join(' · ')
  // A new item starts on the last day of the plan: that is where the next line usually goes.
  const blank = (): Draft => ({ day: days[days.length - 1]?.day ?? now.day, start: '', title: '', place: '', owner: '', done: false })

  const save = async (next: Draft) => {
    if (await run(() => saveItem(next))) setDraft(null)
  }
  const remove = async (key: string) => {
    if (await run(() => removeItem(key))) setDraft(null)
  }

  return (
    <Page
      title="Run of show"
      count={count}
      actions={
        state.status === 'ready' && (
          <Button variant="primary" onClick={() => setDraft(blank())} disabled={busy}>
            <IconPlus size={16} stroke={1.75} />
            Add item
          </Button>
        )
      }
    >
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading the run of show…</p>}
      {state.status === 'error' && <Problem message={state.message} />}
      {!draft && <Problem message={problem} />}

      {draft && <ItemForm key={draft.key ?? 'new'} draft={draft} busy={busy} problem={problem} onSave={save} onRemove={remove} onCancel={() => setDraft(null)} />}

      {state.status === 'ready' && rows.length === 0 && !draft && (
        <Empty
          title="One plan for the event day that the whole team follows"
          steps={[
            'Add everything that has to happen, from the set-up the day before to the last guest leaving: the time, where, and who on the team is on it.',
            'On the day, tick each item off when it has happened. Everyone sees the same list.',
            'An item that is past its time and not ticked off is marked late, and the Up next widget shows what comes now.'
          ]}
        >
          <Button variant="primary" onClick={() => setDraft(blank())} disabled={busy}>
            Add your first item
          </Button>
          <Button onClick={() => run(() => loadExampleItems(now.day))} disabled={busy}>
            Try it with examples
          </Button>
        </Empty>
      )}

      {rows.length > 0 && (
        <>
          <ExamplesBar count={rows.filter(i => i.example).length} busy={busy} onRemove={() => run(removeExampleItems)} />
          {days.map(group => (
            <section key={group.day} className="flex flex-col gap-1">
              <h2 className="flex items-baseline gap-2 text-sm font-medium">
                {longDay(group.day)}
                {group.day === now.day && <Badge tone="accent">Today</Badge>}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  {group.items.filter(i => i.done).length} of {group.items.length} done
                </span>
              </h2>
              <ul className="flex flex-col divide-y divide-border">
                {group.items.map(item => (
                  <ItemRow key={item.key} item={item} late={isLate(item, now)} busy={busy} onDone={done => run(() => markDone(item.key, done))} onEdit={() => setDraft(item)} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </Page>
  )
}

function ItemRow({ item, late, busy, onDone, onEdit }: { item: Saved<Item>; late: boolean; busy: boolean; onDone: (done: boolean) => void; onEdit: () => void }) {
  return (
    <li className="grid grid-cols-[auto_3rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5">
      <input type="checkbox" className="size-4 accent-primary" checked={item.done} disabled={busy} onChange={e => onDone(e.target.checked)} aria-label={`${item.title} has happened`} />
      <span className={cx('text-sm font-medium tabular-nums', item.done ? 'text-muted-foreground' : late && 'text-destructive')}>{item.start}</span>
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-sm">
          <span className={cx('truncate', item.done && 'text-muted-foreground line-through')}>{item.title}</span>
          {late && <Badge tone="bad">Late</Badge>}
          {item.example && <Badge tone="outline">Example</Badge>}
        </span>
        <span className="truncate text-xs text-muted-foreground">{[item.place, item.owner && `Owner: ${item.owner}`].filter(Boolean).join(' · ') || 'No place or owner yet'}</span>
      </div>
      <Button variant="ghost" onClick={onEdit} aria-label={`Edit ${item.title}`}>
        <IconPencil size={16} stroke={1.75} />
        Edit
      </Button>
    </li>
  )
}

function ItemForm({ draft, busy, problem, onSave, onRemove, onCancel }: { draft: Draft; busy: boolean; problem: string | null; onSave: (d: Draft) => void; onRemove: (key: string) => void; onCancel: () => void }) {
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
        <h2 className="text-base font-medium">{form.key ? `Edit ${draft.title}` : 'New item'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What happens" className="sm:col-span-2">
            <input className={inputClass} value={form.title} onChange={e => set({ title: e.target.value })} maxLength={120} placeholder="Doors open" required autoFocus />
          </Field>
          <Field label="Day">
            <input type="date" className={inputClass} value={form.day} onChange={e => set({ day: e.target.value })} required />
          </Field>
          <Field label="Start time">
            <input type="time" className={inputClass} value={form.start} onChange={e => set({ start: e.target.value })} required />
          </Field>
          <Field label="Where" hint="room, stage or spot">
            <input className={inputClass} value={form.place} onChange={e => set({ place: e.target.value })} maxLength={60} />
          </Field>
          <Field label="Owner" hint="who on your team">
            <input className={inputClass} value={form.owner} onChange={e => set({ owner: e.target.value })} maxLength={60} />
          </Field>
        </div>
        <Problem message={problem} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy}>
            {form.key ? 'Save' : 'Add item'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {form.key &&
            (sure ? (
              <Button variant="danger" className="ml-auto" onClick={() => onRemove(form.key!)} disabled={busy}>
                Yes, remove this item
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

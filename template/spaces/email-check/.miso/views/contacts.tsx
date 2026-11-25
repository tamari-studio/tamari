import { IconCopy, IconPlayerPlay, IconTrash } from '@tabler/icons-react'
import { useRef, useState, type FormEvent } from 'react'

import type { AddResult } from '../lib/batch'
import { MAX_PER_ADD, MAX_PER_CHECK, MAX_TEXT, VERDICTS, VERDICT_LABEL, goodAddresses, sortContacts, summary, type Contact, type Verdict } from '../lib/contacts'
import { addContacts, checkContacts, listContacts, loadExampleContacts, removeContact, removeExampleContacts } from '../lib/contacts.server'
import type { Saved } from '../lib/rows'
import { Badge, Button, Card, Empty, ExamplesBar, Field, Page, Problem, cx, inputClass, today, useRows, type Tone } from '../ui/kit'

export const config = { title: 'Contacts', icon: 'mail' } as const

const TONE: Record<Verdict, Tone> = { unchecked: 'outline', ok: 'good', review: 'accent', skip: 'bad' }

type Filter = 'all' | Verdict

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function addedSentence(r: AddResult): string {
  if (r.added === 0 && r.duplicates === 0 && r.ignored === 0) return 'No addresses found in that text. Put an @ in each one.'
  const parts = [r.added > 0 ? `Added ${plural(r.added, 'address', 'addresses')}${r.invalid > 0 ? `, ${r.invalid} not written right` : ''}.` : 'Nothing new was added.']
  if (r.duplicates > 0) parts.push(`${plural(r.duplicates, 'address was', 'addresses were')} in the list already.`)
  if (r.ignored > 0) parts.push(`${plural(r.ignored, 'piece of text', 'pieces of text')} left out because ${r.ignored === 1 ? 'it was' : 'they were'} not an address.`)
  return parts.join(' ')
}

export default function Contacts() {
  const { state, busy, problem, run } = useRows(listContacts)
  const [text, setText] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const now = today()

  const rows = state.status === 'ready' ? state.rows : []
  const sums = summary(rows)
  const good = goodAddresses(rows)
  const shown = sortContacts(filter === 'all' ? rows : rows.filter(row => row.verdict === filter))
  const checking = progress !== null
  const locked = busy || checking

  const add = async (event: FormEvent) => {
    event.preventDefault()
    setNotice(null)
    setTrouble(null)
    await run(async () => {
      const result = await addContacts(text, now)
      setText('')
      setNotice(addedSentence(result))
    })
  }

  // One snapshot of what is unchecked, sent in batches. Contacts the server ran out of time for stay
  // unchecked, so this never loops on them: the person selects the button again.
  const checkAll = async () => {
    const keys = rows.filter(row => row.verdict === 'unchecked').map(row => row.key)
    const tally = { checked: 0, left: 0 }
    setNotice(null)
    setTrouble(null)
    setProgress({ done: 0, total: keys.length })
    for (let i = 0; i < keys.length; i += MAX_PER_CHECK) {
      const batch = keys.slice(i, i + MAX_PER_CHECK)
      const worked = await run(async () => {
        const result = await checkContacts(batch)
        tally.checked += result.checked
        tally.left += result.left
      })
      if (!worked) break
      setProgress({ done: Math.min(i + MAX_PER_CHECK, keys.length), total: keys.length })
    }
    setProgress(null)
    if (tally.left > 0) setNotice(`Checked ${plural(tally.checked, 'address', 'addresses')}. ${plural(tally.left, 'address', 'addresses')} could not be checked in time. Select Check unchecked to try them again.`)
    else if (tally.checked > 0) setNotice(`Checked ${plural(tally.checked, 'address', 'addresses')}.`)
  }

  const copy = async () => {
    setNotice(null)
    setTrouble(null)
    try {
      await navigator.clipboard.writeText(good.join('\n'))
      setNotice(`Copied ${plural(good.length, 'good address', 'good addresses')}, one per line.`)
    } catch {
      setTrouble('Could not copy. Select the addresses in the list and copy them yourself.')
    }
  }

  return (
    <Page title="Contacts" count={rows.length === 0 ? undefined : plural(rows.length, 'contact', 'contacts')}>
      {state.status === 'loading' && <Skeleton />}
      {state.status === 'error' && <Problem message={`${state.message} Reload the page to try again.`} />}

      {state.status === 'ready' && rows.length === 0 && (
        <Empty
          title="A contact list you can trust"
          steps={[
            'Paste the addresses you want to write to. They can be on separate lines or separated by commas.',
            'Select Check unchecked. Each address is read and its domain is asked whether it takes mail. Nothing is sent to the address.',
            'Select Copy good addresses and paste them into your mailing tool.'
          ]}
        >
          <Button variant="primary" onClick={() => box.current?.focus()} disabled={busy}>
            Paste addresses
          </Button>
          <Button onClick={() => run(() => loadExampleContacts(now))} disabled={busy}>
            Try it with examples
          </Button>
        </Empty>
      )}

      {state.status === 'ready' && (
        <Card>
          <form onSubmit={add} className="flex flex-col gap-3">
            <Field label="Addresses" hint={`up to ${MAX_PER_ADD} at a time, on separate lines or separated by commas`}>
              <textarea ref={box} className={inputClass} rows={4} value={text} onChange={event => setText(event.target.value)} maxLength={MAX_TEXT} placeholder="ida@example.org, oskar@acme.example" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary" disabled={locked || text.trim() === ''}>
                Add addresses
              </Button>
              {text !== '' && (
                <Button variant="ghost" onClick={() => setText('')} disabled={locked}>
                  Clear
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      <Problem message={problem ?? trouble} />
      {notice && !problem && !trouble && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {rows.length > 0 && (
        <>
          <ExamplesBar count={rows.filter(row => row.example).length} busy={locked} onRemove={() => run(removeExampleContacts)} />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div role="group" aria-label="Show contacts" className="flex flex-wrap items-center gap-1">
              {(['all', ...VERDICTS] as const).map(item => {
                const count = item === 'all' ? sums.total : sums[item]
                return (
                  <Button key={item} variant="ghost" aria-pressed={filter === item} onClick={() => setFilter(item)} className={cx(filter === item && 'bg-accent text-accent-foreground')}>
                    {item === 'all' ? 'All' : VERDICT_LABEL[item]}
                    <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
                  </Button>
                )
              })}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {progress && (
                <span role="status" className="text-sm text-muted-foreground tabular-nums">
                  Checked {progress.done} of {progress.total}…
                </span>
              )}
              {sums.unchecked > 0 && (
                <Button variant="primary" onClick={checkAll} disabled={locked}>
                  <IconPlayerPlay size={16} stroke={1.75} />
                  Check unchecked ({sums.unchecked})
                </Button>
              )}
              <Button onClick={copy} disabled={locked || good.length === 0}>
                <IconCopy size={16} stroke={1.75} />
                Copy good addresses
              </Button>
            </div>
          </div>

          {shown.length === 0 && <p className="text-sm text-muted-foreground">No contacts in this group. Select All to see the whole list.</p>}
          <ul className="flex flex-col divide-y divide-border">
            {shown.map(row => (
              <ContactRow key={row.key} row={row} disabled={locked} onRemove={() => run(() => removeContact(row.key))} />
            ))}
          </ul>

          <p className="text-xs text-muted-foreground">
            Good to send means the address is written correctly and its domain takes mail. Nothing is sent to the address, so there is no way to tell whether the mailbox exists.
          </p>
        </>
      )}
    </Page>
  )
}

function ContactRow({ row, disabled, onRemove }: { row: Saved<Contact>; disabled: boolean; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
      <div className="flex min-w-0 flex-1 basis-56 flex-col">
        <span className="truncate text-sm font-medium">{row.email}</span>
        {(row.name || row.note) && <span className="truncate text-xs text-muted-foreground">{[row.name, row.note].filter(Boolean).join(' · ')}</span>}
      </div>
      <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={TONE[row.verdict]}>{VERDICT_LABEL[row.verdict]}</Badge>
        {row.reason && <span className="text-xs text-muted-foreground">{row.reason}</span>}
        {row.example && <Badge tone="outline">Example</Badge>}
      </div>
      <Button variant="ghost" onClick={onRemove} disabled={disabled} aria-label={`Remove ${row.email}`}>
        <IconTrash size={16} stroke={1.75} />
        Remove
      </Button>
    </li>
  )
}

/** The shape of the page while the list loads: the add box, then a few rows. */
function Skeleton() {
  return (
    <div role="status" aria-label="Loading your contacts" className="flex flex-col gap-4">
      <div className="h-32 rounded-lg bg-muted motion-safe:animate-pulse" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="h-10 rounded-lg bg-muted motion-safe:animate-pulse" />
        ))}
      </div>
    </div>
  )
}

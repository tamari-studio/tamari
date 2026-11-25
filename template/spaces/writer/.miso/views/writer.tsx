import { IconCheck, IconCopy, IconPencil, IconPlus, IconSparkles } from '@tabler/icons-react'
import { useEffect, useState, type FormEvent } from 'react'

import { MAX_DRAFT_TEXT, MAX_NOTES, STATUS_LABEL, countGaps, gapParts, newestFirst, suggestTitle, type Draft } from '../lib/drafts'
import { MAX_GUIDE_NAME, MAX_GUIDE_TEXT, type Guide } from '../lib/guides'
import { WAIT_SECONDS } from '../lib/prompt'
import type { Saved } from '../lib/rows'
import { aiReady, listDrafts, listGuides, loadExamples, removeDraft, removeExamples, removeGuide, saveDraft, saveGuide, writeDraft } from '../lib/writer.server'
import { Badge, Button, Card, Empty, ExamplesBar, Field, Page, Problem, cx, inputClass, shortDay, today, useRows } from '../ui/kit'

export const config = { title: 'Writer', icon: 'sparkles' } as const

type Tab = 'write' | 'drafts' | 'guides'
type Data = { guides: Saved<Guide>[]; drafts: Saved<Draft>[] }
type Run = (change: () => Promise<unknown>) => Promise<boolean>

const TABS: { id: Tab; label: string }[] = [
  { id: 'write', label: 'Write' },
  { id: 'drafts', label: 'Drafts' },
  { id: 'guides', label: 'Style guides' }
]

/** Both lists load together as one row, so every change (and the examples) reloads both at once. */
const loadAll = async (): Promise<Data[]> => {
  const [guides, drafts] = await Promise.all([listGuides(), listDrafts()])
  return [{ guides, drafts }]
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
const number = (n: number) => n.toLocaleString('en')
const plural = (n: number, one: string, many: string) => `${number(n)} ${n === 1 ? one : many}`

export default function Writer() {
  // A new key starts the page over, which is what "Try again" does after a load error.
  const [attempt, setAttempt] = useState(0)
  return <WriterPage key={attempt} onRetry={() => setAttempt(a => a + 1)} />
}

function WriterPage({ onRetry }: { onRetry: () => void }) {
  const { state, busy, problem, run } = useRows(loadAll)
  const [tab, setTab] = useState<Tab>('write')
  const [openGuideForm, setOpenGuideForm] = useState(false)
  // null while it is not known yet: the button stays usable, and a failed call says what is wrong.
  const [ai, setAi] = useState<boolean | null>(null)
  const now = today()

  useEffect(() => {
    aiReady().then(setAi, () => setAi(null))
  }, [])

  const data = state.status === 'ready' ? state.rows[0]! : null
  const guides = data?.guides ?? []
  const drafts = data?.drafts ?? []
  const count = data && guides.length + drafts.length > 0 ? `${plural(drafts.length, 'draft', 'drafts')}, ${plural(guides.length, 'style guide', 'style guides')}` : undefined
  const go = (next: Tab) => {
    setOpenGuideForm(false)
    setTab(next)
  }
  const addGuide = () => {
    setTab('guides')
    setOpenGuideForm(true)
  }
  const tryExamples = () => run(() => loadExamples(now))

  return (
    <Page title="Writer" count={count}>
      {state.status === 'loading' && <Skeleton />}
      {state.status === 'error' && (
        <div className="flex flex-col items-start gap-2">
          <Problem message={state.message} />
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}

      {data && (
        <>
          <ExamplesBar count={guides.filter(g => g.example).length + drafts.filter(d => d.example).length} busy={busy} onRemove={() => run(removeExamples)} />

          <div role="tablist" aria-label="Writer sections" className="flex flex-wrap items-center gap-1">
            {TABS.map(item => (
              <Button key={item.id} role="tab" aria-selected={tab === item.id} variant={tab === item.id ? 'outline' : 'ghost'} className={cx(tab !== item.id && 'text-muted-foreground')} onClick={() => go(item.id)}>
                {item.label}
                {item.id !== 'write' && <span className="text-xs text-muted-foreground tabular-nums">{item.id === 'drafts' ? drafts.length : guides.length}</span>}
              </Button>
            ))}
          </div>

          {/* The write section stays mounted so notes and a draft in progress survive a look at another tab. */}
          <div role="tabpanel" hidden={tab !== 'write'}>
            <WriteSection guides={guides} drafts={drafts} ai={ai} busy={busy} problem={problem} run={run} onAddGuide={addGuide} onExamples={tryExamples} onOpenDrafts={() => go('drafts')} />
          </div>
          {tab === 'drafts' && (
            <div role="tabpanel">
              <DraftsSection drafts={drafts} guides={guides} busy={busy} problem={problem} run={run} onWrite={() => go('write')} />
            </div>
          )}
          {tab === 'guides' && (
            <div role="tabpanel">
              <GuidesSection guides={guides} startOpen={openGuideForm} busy={busy} problem={problem} run={run} onExamples={tryExamples} />
            </div>
          )}
        </>
      )}
    </Page>
  )
}

function Skeleton() {
  const bar = 'rounded-lg bg-muted motion-safe:animate-pulse'
  return (
    <div className="flex flex-col gap-4" role="status">
      <span className="sr-only">Loading Writer</span>
      <div className="flex gap-2">
        <div className={cx(bar, 'h-8 w-20')} />
        <div className={cx(bar, 'h-8 w-20')} />
        <div className={cx(bar, 'h-8 w-28')} />
      </div>
      <div className={cx(bar, 'h-8 w-full max-w-xs')} />
      <div className={cx(bar, 'h-40 w-full')} />
      <div className={cx(bar, 'h-8 w-32')} />
    </div>
  )
}

/** How many characters of how many, red when over. */
function Count({ n, max }: { n: number; max: number }) {
  return (
    <span className={cx('text-xs tabular-nums', n > max ? 'text-destructive' : 'text-muted-foreground')}>
      {number(n)} of {number(max)} characters{n > max && `: ${number(n - max)} too many`}
    </span>
  )
}

/** The text of a piece: a box to edit it in, or a read-only view with the `[NEEDS: …]` gaps marked. */
function Body({ text, onChange, startEditing }: { text: string; onChange: (text: string) => void; startEditing: boolean }) {
  const [editing, setEditing] = useState(startEditing)
  const showEditor = editing || text.trim() === ''
  return (
    <div className="flex flex-col gap-2">
      {showEditor ? (
        <textarea className={cx(inputClass, 'py-2')} rows={16} value={text} onChange={e => onChange(e.target.value)} aria-label="Text of the draft" />
      ) : (
        <div className="rounded-lg border p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
          {gapParts(text).map((part, index) =>
            part.gap ? (
              <span key={index} className="rounded-sm bg-primary/10 px-0.5 font-medium text-primary">
                {part.text}
              </span>
            ) : (
              <span key={index}>{part.text}</span>
            )
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Count n={text.length} max={MAX_DRAFT_TEXT} />
        {text.trim() !== '' && (
          <Button variant="ghost" onClick={() => setEditing(!showEditor)}>
            {showEditor ? 'Show gaps marked' : 'Edit text'}
          </Button>
        )}
      </div>
    </div>
  )
}

function Gaps({ text }: { text: string }) {
  const gaps = countGaps(text)
  return gaps > 0 ? <Badge tone="accent">{plural(gaps, 'gap to fill', 'gaps to fill')}</Badge> : null
}

// Write ---------------------------------------------------------------------------------------

function WriteSection({ guides, drafts, ai, busy, problem, run, onAddGuide, onExamples, onOpenDrafts }: { guides: Saved<Guide>[]; drafts: Saved<Draft>[]; ai: boolean | null; busy: boolean; problem: string | null; run: Run; onAddGuide: () => void; onExamples: () => void; onOpenDrafts: () => void }) {
  const [guideKey, setGuideKey] = useState('')
  const [notes, setNotes] = useState('')
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  // The guide the text was written in, when the service wrote it.
  const [used, setUsed] = useState<string | null>(null)
  const [byHand, setByHand] = useState(false)
  const [writing, setWriting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [bodyKey, setBodyKey] = useState(0)
  // The row this piece is saved as, so saving again changes it instead of adding a second one.
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const [copied, setCopied] = useState<boolean | string>(false)

  const chosen = guides.find(g => g.key === guideKey) ?? guides[0]
  const canWrite = ai !== false && !!chosen && notes.trim() !== '' && notes.length <= MAX_NOTES && !writing && !busy

  useEffect(() => {
    if (!writing) return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [writing])

  const edited = () => {
    setJustSaved(false)
    setCopied(false)
  }

  const write = async () => {
    if (!chosen) return
    setWriting(true)
    setFailure(null)
    try {
      const result = await writeDraft(notes, chosen.key)
      if (result.ok) {
        setText(result.text)
        setUsed(chosen.name)
        setTitle('')
        setBodyKey(k => k + 1)
        setSavedKey(null)
        edited()
      } else {
        setFailure(result.error)
      }
    } catch (err) {
      setFailure(message(err))
    } finally {
      setWriting(false)
    }
  }

  const save = async () => {
    let key: string | null = null
    const existing = drafts.find(d => d.key === savedKey)
    const ok = await run(async () => {
      const row = await saveDraft({ key: savedKey ?? undefined, title: title.trim() || suggestTitle(text), guide: used ?? '', notes, text, status: existing?.status ?? 'draft' })
      key = row.key
    })
    if (ok) {
      setSavedKey(key)
      setJustSaved(true)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied('Could not copy. Select the text and copy it by hand.')
    }
  }

  const startOver = () => {
    setNotes('')
    setText('')
    setTitle('')
    setUsed(null)
    setByHand(false)
    setFailure(null)
    setSavedKey(null)
    setJustSaved(false)
    setCopied(false)
    setBodyKey(k => k + 1)
  }

  if (guides.length === 0 && drafts.length === 0) {
    return (
      <Empty title="Notes in, article out" steps={['Add a style guide: the voice you write in, described or shown in a few paragraphs.', 'Paste your rough notes, a transcript or a bullet list.', 'Write the draft, read it, fill in the gaps and save it.']}>
        <Button variant="primary" onClick={onAddGuide} disabled={busy}>
          Add a style guide
        </Button>
        <Button onClick={onExamples} disabled={busy}>
          Try it with examples
        </Button>
        <Problem message={problem} />
      </Empty>
    )
  }

  const showDraft = text !== '' || byHand || ai === false

  return (
    <div className="flex flex-col gap-4">
      {ai === false && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Writing with AI is not switched on. Add the key <span className="font-medium text-foreground">WRITER_AI_KEY</span> on the Connectors page and Write draft will work here. Until then you can type or paste a draft below and save it.
        </p>
      )}

      {guides.length > 0 ? (
        <Field label="Style guide" hint="the voice to write in" className="max-w-sm">
          <select className={inputClass} value={chosen?.key ?? ''} onChange={e => setGuideKey(e.target.value)} disabled={writing}>
            {guides.map(guide => (
              <option key={guide.key} value={guide.key}>
                {guide.name}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>There is no style guide to write in yet.</span>
          <Button onClick={onAddGuide}>Add a style guide</Button>
        </div>
      )}

      <Field label="Rough notes" hint="paste a transcript, a bullet list or a rough draft">
        <textarea
          className={cx(inputClass, 'py-2')}
          rows={10}
          value={notes}
          onChange={e => {
            setNotes(e.target.value)
            setFailure(null)
          }}
          disabled={writing}
        />
      </Field>
      <Count n={notes.length} max={MAX_NOTES} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="primary" onClick={write} disabled={!canWrite}>
          <IconSparkles size={16} stroke={1.75} />
          {writing ? 'Writing…' : text !== '' ? 'Write again' : 'Write draft'}
        </Button>
        {!showDraft && (
          <Button variant="ghost" onClick={() => setByHand(true)}>
            Type a draft by hand
          </Button>
        )}
        {!writing && <span className="text-xs text-muted-foreground">{text !== '' ? `Writing again replaces the draft below. It can take up to ${WAIT_SECONDS} seconds.` : `It can take up to ${WAIT_SECONDS} seconds.`}</span>}
      </div>

      {writing && (
        <div className="flex flex-col gap-1.5" role="status">
          <div className="h-1 w-full max-w-sm overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${Math.min(100, (elapsed / WAIT_SECONDS) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted-foreground tabular-nums">
            Writing in {chosen?.name}'s voice, {elapsed} s so far. Giving up after {WAIT_SECONDS} s.
          </p>
        </div>
      )}
      <Problem message={failure} />

      {showDraft && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-medium">Draft</h2>
            {used && <Badge tone="outline">{`Written in ${used}`}</Badge>}
            <Gaps text={text} />
          </div>
          <Field label="Title" hint="left empty, it is taken from the first line" className="max-w-md">
            <input
              className={inputClass}
              value={title}
              onChange={e => {
                setTitle(e.target.value)
                edited()
              }}
              maxLength={120}
              placeholder={suggestTitle(text)}
            />
          </Field>
          <Body
            key={bodyKey}
            text={text}
            onChange={next => {
              setText(next)
              edited()
            }}
            startEditing={bodyKey === 0}
          />
          <Problem message={problem} />
          <Problem message={typeof copied === 'string' ? copied : null} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={save} disabled={busy || text.trim() === '' || text.length > MAX_DRAFT_TEXT}>
              {savedKey ? 'Save changes' : 'Save to drafts'}
            </Button>
            <Button onClick={copy} disabled={text.trim() === ''}>
              {copied === true ? <IconCheck size={16} stroke={1.75} /> : <IconCopy size={16} stroke={1.75} />}
              {copied === true ? 'Copied' : 'Copy'}
            </Button>
            {justSaved && (
              <>
                <span role="status" className="text-sm text-success">
                  Saved to drafts.
                </span>
                <Button variant="ghost" onClick={onOpenDrafts}>
                  See your drafts
                </Button>
                <Button variant="ghost" onClick={startOver}>
                  Write another
                </Button>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

// Drafts --------------------------------------------------------------------------------------

type DraftForm = Draft & { key?: string }

const BLANK_DRAFT: DraftForm = { title: '', guide: '', notes: '', text: '', status: 'draft', updatedAt: '' }

function DraftsSection({ drafts, guides, busy, problem, run, onWrite }: { drafts: Saved<Draft>[]; guides: Saved<Guide>[]; busy: boolean; problem: string | null; run: Run; onWrite: () => void }) {
  const [form, setForm] = useState<DraftForm | null>(null)
  const list = newestFirst(drafts)

  const save = async (next: DraftForm) => {
    if (await run(() => saveDraft(next))) setForm(null)
  }
  const remove = async (key: string) => {
    if (await run(() => removeDraft(key))) setForm(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium">Drafts</h2>
        <Button variant="primary" className="ml-auto" onClick={() => setForm({ ...BLANK_DRAFT })} disabled={busy || form !== null}>
          <IconPlus size={16} stroke={1.75} />
          New draft
        </Button>
      </div>
      {!form && <Problem message={problem} />}

      {form && <DraftEditor key={form.key ?? 'new'} start={form} guides={guides} busy={busy} problem={problem} onSave={save} onRemove={remove} onCancel={() => setForm(null)} />}

      {list.length === 0 && !form && (
        <Empty title="No drafts yet" steps={['Write one from your rough notes on the Write tab.', 'Or start one by hand with New draft: type or paste the text, then save it.', 'Mark a draft as final when it is done.']}>
          <Button variant="primary" onClick={onWrite}>
            Go to Write
          </Button>
          <Button onClick={() => setForm({ ...BLANK_DRAFT })}>New draft</Button>
        </Empty>
      )}

      {list.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {list.map(draft => (
            <li key={draft.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{draft.title}</span>
                <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>{draft.guide || 'Written by hand'}</span>
                  {draft.updatedAt && <span className="tabular-nums">{shortDay(draft.updatedAt.slice(0, 10))}</span>}
                  {countGaps(draft.text) > 0 && <span>{plural(countGaps(draft.text), 'gap to fill', 'gaps to fill')}</span>}
                </span>
              </div>
              {draft.example && <Badge tone="outline">Example</Badge>}
              <Badge tone={draft.status === 'final' ? 'good' : 'plain'}>{STATUS_LABEL[draft.status]}</Badge>
              <Button variant="ghost" onClick={() => setForm({ ...draft })} disabled={busy || form !== null} aria-label={`Open ${draft.title}`}>
                <IconPencil size={16} stroke={1.75} />
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DraftEditor({ start, guides, busy, problem, onSave, onRemove, onCancel }: { start: DraftForm; guides: Saved<Guide>[]; busy: boolean; problem: string | null; onSave: (d: DraftForm) => void; onRemove: (key: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState(start)
  const [sure, setSure] = useState(false)
  const [copied, setCopied] = useState<boolean | string>(false)
  const set = (patch: Partial<DraftForm>) => setForm(f => ({ ...f, ...patch }))
  const final = form.status === 'final'
  const names = guides.map(g => g.name)
  const over = form.text.length > MAX_DRAFT_TEXT || form.notes.length > MAX_NOTES

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(form)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(form.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied('Could not copy. Select the text and copy it by hand.')
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-medium">{form.key ? 'Edit draft' : 'New draft'}</h2>
          <Badge tone={final ? 'good' : 'plain'}>{STATUS_LABEL[form.status]}</Badge>
          <Gaps text={form.text} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            <input className={inputClass} value={form.title} onChange={e => set({ title: e.target.value })} maxLength={120} required autoFocus />
          </Field>
          <Field label="Style guide" hint="the voice it is written in">
            <select className={inputClass} value={form.guide} onChange={e => set({ guide: e.target.value })}>
              <option value="">None, written by hand</option>
              {form.guide !== '' && !names.includes(form.guide) && <option value={form.guide}>{form.guide}</option>}
              {names.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Text</span>
          <Body text={form.text} onChange={text => set({ text })} startEditing />
        </div>
        <Field label="Rough notes" hint="what the text grew from">
          <textarea className={cx(inputClass, 'py-2')} rows={5} value={form.notes} onChange={e => set({ notes: e.target.value })} />
        </Field>
        <Count n={form.notes.length} max={MAX_NOTES} />
        <Problem message={problem} />
        <Problem message={typeof copied === 'string' ? copied : null} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || over}>
            Save
          </Button>
          <Button onClick={() => onSave({ ...form, status: final ? 'draft' : 'final' })} disabled={busy || over || form.title.trim() === ''}>
            {final ? 'Mark as draft again' : 'Mark as final'}
          </Button>
          <Button onClick={copy} disabled={form.text.trim() === ''}>
            {copied === true ? <IconCheck size={16} stroke={1.75} /> : <IconCopy size={16} stroke={1.75} />}
            {copied === true ? 'Copied' : 'Copy'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {form.key &&
            (sure ? (
              <Button variant="danger" className="ml-auto" onClick={() => onRemove(form.key!)} disabled={busy}>
                Yes, remove {form.title || 'this draft'}
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

// Style guides --------------------------------------------------------------------------------

type GuideForm = Guide & { key?: string }

const BLANK_GUIDE: GuideForm = { name: '', text: '' }

function GuidesSection({ guides, startOpen, busy, problem, run, onExamples }: { guides: Saved<Guide>[]; startOpen: boolean; busy: boolean; problem: string | null; run: Run; onExamples: () => void }) {
  const [form, setForm] = useState<GuideForm | null>(startOpen ? { ...BLANK_GUIDE } : null)

  const save = async (next: GuideForm) => {
    if (await run(() => saveGuide(next))) setForm(null)
  }
  const remove = async (key: string) => {
    if (await run(() => removeGuide(key))) setForm(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium">Style guides</h2>
        <Button variant="primary" className="ml-auto" onClick={() => setForm({ ...BLANK_GUIDE })} disabled={busy || form !== null}>
          <IconPlus size={16} stroke={1.75} />
          Add style guide
        </Button>
      </div>
      <p className="max-w-prose text-sm text-muted-foreground">A style guide describes a voice. Paste a few paragraphs you have written, or list what to do and what to avoid. The more of your own writing it holds, the closer a draft sounds to you.</p>
      {!form && <Problem message={problem} />}

      {form && <GuideEditor key={form.key ?? 'new'} start={form} busy={busy} problem={problem} onSave={save} onRemove={remove} onCancel={() => setForm(null)} />}

      {guides.length === 0 && !form && (
        <Empty title="No style guides yet" steps={['Paste a few paragraphs in the voice you want, or describe it.', 'Give it a name you will know it by, such as the name of a newsletter or a person.', 'Pick it on the Write tab to write a draft in that voice.']}>
          <Button variant="primary" onClick={() => setForm({ ...BLANK_GUIDE })} disabled={busy}>
            Add a style guide
          </Button>
          <Button onClick={onExamples} disabled={busy}>
            Try it with examples
          </Button>
        </Empty>
      )}

      {guides.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {guides.map(guide => (
            <li key={guide.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{guide.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{plural(guide.text.length, 'character', 'characters')}</span>
              </div>
              {guide.example && <Badge tone="outline">Example</Badge>}
              <Button variant="ghost" onClick={() => setForm({ ...guide })} disabled={busy || form !== null} aria-label={`Edit ${guide.name}`}>
                <IconPencil size={16} stroke={1.75} />
                Edit
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GuideEditor({ start, busy, problem, onSave, onRemove, onCancel }: { start: GuideForm; busy: boolean; problem: string | null; onSave: (g: GuideForm) => void; onRemove: (key: string) => void; onCancel: () => void }) {
  const [form, setForm] = useState(start)
  const [sure, setSure] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(form)
  }
  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <h2 className="text-base font-medium">{form.key ? `Edit ${start.name}` : 'New style guide'}</h2>
        <Field label="Name" hint="the voice, as it shows in the picker" className="max-w-md">
          <input className={inputClass} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} maxLength={MAX_GUIDE_NAME} required autoFocus />
        </Field>
        <Field label="Guide text" hint="paragraphs in this voice, or a list of dos and don'ts">
          <textarea className={cx(inputClass, 'py-2')} rows={14} value={form.text} onChange={e => setForm(f => ({ ...f, text: e.target.value }))} required />
        </Field>
        <Count n={form.text.length} max={MAX_GUIDE_TEXT} />
        <Problem message={problem} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="primary" disabled={busy || form.text.length > MAX_GUIDE_TEXT}>
            {form.key ? 'Save' : 'Add style guide'}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {form.key &&
            (sure ? (
              <>
                <span className="ml-auto text-sm text-muted-foreground">Drafts written in this voice keep its name.</span>
                <Button variant="danger" onClick={() => onRemove(form.key!)} disabled={busy}>
                  Yes, remove {start.name}
                </Button>
              </>
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

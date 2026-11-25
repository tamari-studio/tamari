// PR writer: paste a transcript, outline or rough draft, pick a voice, get a
// media-ready article back. One call to pr-writer.server.ts writes the draft in the chosen
// style guide's voice and keeps it; the same file lists, adds, changes and removes the guides
// and lists your recent drafts.
import { useEffect, useRef, useState } from 'react'
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleX,
  IconCopy,
  IconPencil,
  IconPlus,
  IconSparkles,
  IconTrash
} from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Skeleton } from '../ui/skeleton'
import { Spinner } from '../ui/spinner'
import { Textarea } from '../ui/textarea'
import { cn } from '../ui/utils'
import { parseDraft, toHtml, toPlainText, type Block, type Inline } from './_draft-format'
import { MAX_GUIDE_CHARS, MAX_GUIDE_NAME, MAX_INPUT_CHARS } from './_pr-writer'
import {
  getGuide,
  listGuides,
  listMyDrafts,
  removeGuide,
  saveGuide,
  writeDraft,
  type GuideList,
  type SavedDraft
} from './pr-writer.server'

export const config = {
  title: 'PR writer',
  icon: 'sparkles'
} as const

/** The hosted functions stop at 60 s; give up a little before so the page can say so. */
const CLIENT_TIMEOUT_MS = 50_000

const TOO_SLOW = 'The draft is taking too long. Try again, or shorten the input.'

type Load<T> =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; value: T }

type Draft = { text: string; saved: boolean }

/** The guide form: `id` is null for a new guide. */
type GuideForm = { id: string | null; name: string; guide: string }

/** A server error as one plain line: a function timeout or gateway page is not something to show raw. */
function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : ''
  if (
    !message ||
    message.length > 200 ||
    message.includes('\n') ||
    /<|FUNCTION_INVOCATION|timeout|timed out|504|502/i.test(message)
  ) {
    return 'The server took too long to answer or could not be reached'
  }
  return message.replace(/\.$/, '')
}

function timeOut<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(TOO_SLOW)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })

const firstLine = (text: string) => text.trim().split('\n', 1)[0] ?? ''

export default function PrWriter() {
  const [guides, setGuides] = useState<Load<GuideList>>({ kind: 'loading' })
  const [history, setHistory] = useState<Load<SavedDraft[]>>({ kind: 'loading' })
  const [guideId, setGuideId] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const [form, setForm] = useState<GuideForm | null>(null)
  const [formBusy, setFormBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  // Which write the page is waiting for: a draft that comes back after a timeout is ignored.
  const attempt = useRef(0)

  useEffect(() => {
    let live = true
    listGuides().then(
      value => {
        if (!live) return
        setGuides({ kind: 'ready', value })
        setGuideId(current => current ?? value.defaultId)
      },
      err => live && setGuides({ kind: 'error', message: friendlyError(err) })
    )
    listMyDrafts().then(
      value => live && setHistory({ kind: 'ready', value }),
      err => live && setHistory({ kind: 'error', message: friendlyError(err) })
    )
    return () => {
      live = false
      attempt.current++
    }
  }, [])

  useEffect(() => {
    if (copied === 'idle') return
    const timer = setTimeout(() => setCopied('idle'), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const guideList = guides.kind === 'ready' ? guides.value.guides : []
  const guide = guideList.find(g => g.id === guideId) ?? null
  const over = input.length - MAX_INPUT_CHARS
  const canWrite = !writing && guide !== null && input.trim().length > 0 && over <= 0

  async function write() {
    if (!guide || !canWrite) return
    const mine = ++attempt.current
    setWriting(true)
    setError(null)
    setCopied('idle')
    try {
      const outcome = await timeOut(writeDraft(input, guide.id), CLIENT_TIMEOUT_MS)
      if (mine !== attempt.current) return
      if (!outcome.ok) {
        setDraft(null)
        setError(outcome.error)
        return
      }
      setDraft({ text: outcome.draft, saved: outcome.saved !== null })
      const saved = outcome.saved
      if (saved) {
        setHistory(h =>
          h.kind === 'ready'
            ? { kind: 'ready', value: [saved, ...h.value.filter(d => d.key !== saved.key)] }
            : h
        )
      }
    } catch (err) {
      if (mine !== attempt.current) return
      setDraft(null)
      setError(friendlyError(err))
    } finally {
      if (mine === attempt.current) setWriting(false)
    }
  }

  function applyGuides(value: GuideList) {
    setGuides({ kind: 'ready', value })
    setGuideId(current => (current && value.guides.some(g => g.id === current) ? current : value.defaultId))
  }

  async function edit(id: string) {
    setFormError(null)
    setFormBusy(true)
    try {
      const found = await getGuide(id)
      if (!found) setFormError('That style guide is gone. Reload the tab.')
      else setForm({ id: found.id, name: found.name, guide: found.guide })
    } catch (err) {
      setFormError(friendlyError(err))
    } finally {
      setFormBusy(false)
    }
  }

  async function saveForm() {
    if (!form) return
    setFormBusy(true)
    setFormError(null)
    try {
      const outcome = await saveGuide(form.id, form.name, form.guide)
      if (!outcome.ok) return setFormError(outcome.error)
      applyGuides(outcome.guides)
      setForm(null)
    } catch (err) {
      setFormError(friendlyError(err))
    } finally {
      setFormBusy(false)
    }
  }

  async function remove(id: string) {
    setFormError(null)
    setFormBusy(true)
    try {
      applyGuides(await removeGuide(id))
      setRemoving(null)
    } catch (err) {
      setFormError(friendlyError(err))
    } finally {
      setFormBusy(false)
    }
  }

  function open(saved: SavedDraft) {
    setInput(saved.input)
    setDraft({ text: saved.output, saved: true })
    setError(null)
    setCopied('idle')
    if (guideList.some(g => g.id === saved.guide_id)) setGuideId(saved.guide_id)
  }

  async function copy() {
    if (!draft) return
    // Formatted text for Docs, Word, Gmail and WordPress; plain text, without Markdown
    // markers, for everywhere else.
    const blocks = parseDraft(draft.text)
    const plain = toPlainText(blocks)
    try {
      if (typeof ClipboardItem === 'undefined') {
        await navigator.clipboard.writeText(plain)
      } else {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([toHtml(blocks)], { type: 'text/html' }),
            'text/plain': new Blob([plain], { type: 'text/plain' })
          })
        ])
      }
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-medium">PR writer</h1>
          <p className="text-sm text-muted-foreground">
            Turn a transcript, outline or rough draft into an article you can paste into a blog or
            send to journalists, in the voice of a style guide you pick. It never invents facts:
            anything missing is marked [NEEDS: …] for you to fill in.
          </p>
        </header>

        <section className="flex flex-col gap-4">
          {guides.kind === 'loading' && <Skeleton className="h-5 w-48" />}

          {guides.kind === 'error' && (
            <Alert variant="destructive">
              <IconCircleX stroke={1.75} />
              <AlertTitle>The style guides didn't load</AlertTitle>
              <AlertDescription>{guides.message}. Reload the tab to try again.</AlertDescription>
            </Alert>
          )}

          {guides.kind === 'ready' && guideList.length === 0 && (
            <Alert>
              <IconAlertTriangle stroke={1.75} />
              <AlertTitle>No style guide exists yet</AlertTitle>
              <AlertDescription>
                PR writer needs a style guide to write in. Add one under Style guides below.
              </AlertDescription>
            </Alert>
          )}

          {guideList.length === 1 && guide && (
            <p className="text-sm text-muted-foreground">Writing in {guide.name}'s voice</p>
          )}

          {guideList.length > 1 && (
            <div className="flex items-center gap-3">
              <label htmlFor="pr-writer-voice" className="text-sm text-muted-foreground">
                Write in the voice of
              </label>
              <Select
                value={guideId}
                onValueChange={value => value && setGuideId(value)}
                items={guideList.map(g => ({ value: g.id, label: g.name }))}
                disabled={writing}
              >
                <SelectTrigger id="pr-writer-voice" size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {guideList.map(g => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="pr-writer-input" className="text-sm font-medium">
              Your notes
            </label>
            <Textarea
              id="pr-writer-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Paste a transcript, a bullet outline or a rough draft"
              className="min-h-48"
              disabled={writing}
              aria-invalid={over > 0}
            />
            {over > 0 && (
              <p className="text-sm text-destructive">
                {over.toLocaleString('en')} characters over the{' '}
                {MAX_INPUT_CHARS.toLocaleString('en')} limit. Cut it down to write a draft.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void write()} disabled={!canWrite}>
              {writing ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <IconSparkles data-icon="inline-start" stroke={1.75} />
              )}
              {writing ? 'Writing' : 'Write draft'}
            </Button>
            {writing && (
              <p className="text-sm text-muted-foreground" aria-live="polite">
                This can take up to 40 seconds
              </p>
            )}
          </div>
        </section>

        {error && (
          <Alert variant="destructive">
            <IconCircleX stroke={1.75} />
            <AlertTitle>Couldn't write the draft</AlertTitle>
            <AlertDescription>{error} Your notes are still above.</AlertDescription>
          </Alert>
        )}

        {draft && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-medium">Draft</h2>
              <Button variant="ghost" size="sm" onClick={() => void copy()}>
                {copied === 'done' ? (
                  <IconCheck data-icon="inline-start" stroke={1.75} />
                ) : (
                  <IconCopy data-icon="inline-start" stroke={1.75} />
                )}
                {copied === 'done' ? 'Copied' : 'Copy draft'}
              </Button>
            </div>
            {copied === 'failed' && (
              <p className="text-sm text-destructive">
                Couldn't copy. Select the text and copy it yourself.
              </p>
            )}
            <DraftBody markdown={draft.text} />
            {!draft.saved && (
              <p className="text-sm text-muted-foreground">
                This draft couldn't be added to your recent drafts. Copy it before you leave.
              </p>
            )}
          </section>
        )}

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium">Recent drafts</h2>
            <p className="text-sm text-muted-foreground">
              Each draft is saved with your notes. They are not private: the team's server code can
              read them, so leave out anything that should stay with you.
            </p>
          </div>

          {history.kind === 'loading' && (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {history.kind === 'error' && (
            <p className="text-sm text-destructive">
              Recent drafts didn't load: {history.message}. Reload the tab to try again.
            </p>
          )}

          {history.kind === 'ready' && history.value.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Drafts you write appear here, newest first.
            </p>
          )}

          {history.kind === 'ready' && history.value.length > 0 && (
            <ul className="flex flex-col">
              {history.value.map(saved => (
                <li key={saved.key} className="border-b border-border last:border-b-0">
                  <button
                    type="button"
                    onClick={() => open(saved)}
                    disabled={writing}
                    className={cn(
                      'flex w-full cursor-pointer items-baseline justify-between gap-4 rounded-md px-2 py-2 text-left text-sm outline-none',
                      'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                  >
                    <span className="min-w-0 truncate">{firstLine(saved.input) || '(empty)'}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {saved.guide_name}, {when(saved.created_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium">Style guides</h2>
              <p className="text-sm text-muted-foreground">
                A style guide describes one voice: paste a few paragraphs that show how a person or
                a brand writes, or notes on their tone. Everyone who can open this space can add,
                change and remove guides.
              </p>
            </div>
            {!form && guides.kind === 'ready' && (
              <Button variant="outline" size="sm" onClick={() => setForm({ id: null, name: '', guide: '' })} disabled={formBusy}>
                <IconPlus data-icon="inline-start" stroke={1.75} />
                Add a guide
              </Button>
            )}
          </div>

          {formError && !form && <p className="text-sm text-destructive">{formError}</p>}

          {guides.kind === 'ready' && guideList.length > 0 && (
            <ul className="flex flex-col">
              {guideList.map(g => (
                <li key={g.id} className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
                  <span className="min-w-0 truncate text-sm">{g.name}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {removing === g.id ? (
                      <>
                        <span className="text-sm text-muted-foreground">Remove {g.name}?</span>
                        <Button variant="destructive" size="sm" onClick={() => void remove(g.id)} disabled={formBusy}>
                          Remove
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(null)} disabled={formBusy}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => void edit(g.id)} disabled={formBusy || form !== null}>
                          <IconPencil data-icon="inline-start" stroke={1.75} />
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemoving(g.id)} disabled={formBusy}>
                          <IconTrash data-icon="inline-start" stroke={1.75} />
                          Remove
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {guides.kind === 'ready' && guideList.length === 0 && !form && (
            <p className="text-sm text-muted-foreground">No guides yet. Select Add a guide to write the first one.</p>
          )}

          {form && (
            <div className="flex flex-col gap-3 rounded-lg bg-card p-4 text-card-foreground ring-1 ring-border">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pr-writer-guide-name" className="text-sm font-medium">
                  Name of the voice
                </label>
                <Input
                  id="pr-writer-guide-name"
                  value={form.name}
                  maxLength={MAX_GUIDE_NAME}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="For example Ada, or Company blog"
                  disabled={formBusy}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="pr-writer-guide-text" className="text-sm font-medium">
                  Style guide
                </label>
                <Textarea
                  id="pr-writer-guide-text"
                  value={form.guide}
                  onChange={e => setForm({ ...form, guide: e.target.value })}
                  placeholder="Describe the tone, sentence length and words to use or avoid, or paste examples"
                  className="min-h-40"
                  disabled={formBusy}
                  aria-invalid={form.guide.length > MAX_GUIDE_CHARS}
                />
                <p className="text-xs text-muted-foreground tabular-nums">
                  {form.guide.length.toLocaleString('en')} of {MAX_GUIDE_CHARS.toLocaleString('en')} characters
                </p>
              </div>
              {formError && <p className="text-sm text-destructive">{formError}</p>}
              <div className="flex items-center gap-2">
                <Button onClick={() => void saveForm()} disabled={formBusy || !form.name.trim() || !form.guide.trim() || form.guide.length > MAX_GUIDE_CHARS}>
                  {formBusy && <Spinner data-icon="inline-start" />}
                  Save guide
                </Button>
                <Button variant="ghost" onClick={() => { setForm(null); setFormError(null) }} disabled={formBusy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

const NEEDS = /(\[NEEDS:[^\]]*\])/

const HEADING_CLASS = {
  1: 'text-xl font-medium',
  2: 'pt-2 text-lg font-medium',
  3: 'text-base font-medium'
} as const

type DraftInlinesProps = { inlines: Inline[] }

/** One run of text, with the [NEEDS: …] gaps marked so they're easy to find and fill. */
function DraftInlines({ inlines }: DraftInlinesProps) {
  return inlines.map((inline, n) => {
    const parts = inline.text.split(NEEDS).map((part, k) =>
      k % 2 === 1 ? (
        <mark key={k} className="rounded-sm bg-accent px-0.5 text-accent-foreground">
          {part}
        </mark>
      ) : (
        part
      )
    )
    let node = <>{parts}</>
    if (inline.italic) node = <em>{node}</em>
    if (inline.bold) node = <strong className="font-medium">{node}</strong>
    if (inline.href) {
      node = (
        <a href={inline.href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
          {node}
        </a>
      )
    }
    return <span key={n}>{node}</span>
  })
}

type DraftBodyProps = { markdown: string }

/** The draft as formatted text, the way it pastes into a document. */
function DraftBody({ markdown }: DraftBodyProps) {
  const blocks: Block[] = parseDraft(markdown)
  return (
    <div className="flex flex-col gap-3 text-base leading-relaxed">
      {blocks.map((block, n) => {
        if (block.type === 'heading') {
          const Tag = `h${block.level + 2}` as 'h3' | 'h4' | 'h5'
          return (
            <Tag key={n} className={HEADING_CLASS[block.level]}>
              <DraftInlines inlines={block.inlines} />
            </Tag>
          )
        }
        if (block.type === 'paragraph') {
          return (
            <p key={n}>
              <DraftInlines inlines={block.inlines} />
            </p>
          )
        }
        const List = block.ordered ? 'ol' : 'ul'
        return (
          <List key={n} className={cn('flex flex-col gap-1 pl-6', block.ordered ? 'list-decimal' : 'list-disc')}>
            {block.items.map((item, k) => (
              <li key={k}>
                <DraftInlines inlines={item} />
              </li>
            ))}
          </List>
        )
      })}
    </div>
  )
}

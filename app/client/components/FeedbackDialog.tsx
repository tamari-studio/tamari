// The rail's Feedback button: say what's on your mind, then see what you sent and where it stands.
// Owners and admins also get All feedback, where they tick issues off (server/feedback.ts, miso.feedback).
import { IconCheck, IconCircleCheck, IconClock, IconLoader2, IconMapPin } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'
import { FEEDBACK_PRIORITIES, type FeedbackItem, type FeedbackPriority } from '../../lib/types'
import { hasAtLeast } from '../../vendor/dto-core/tier'
import { useAllFeedback, useApplets, useCompleteFeedback, useMe, useMyFeedback, useSendFeedback, useWorkspace } from '../lib/queries'
import { pageLabel, titleFrom } from '../lib/feedback'
import { formatLastActive } from '../lib/relative-time'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Textarea } from '../ui/textarea'
import { cn } from '../ui/utils'

const DESCRIPTION_MAX = 5000

export const PRIORITY_LABEL: Record<FeedbackPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low'
}

type View = 'new' | 'mine' | 'all'

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 flex-1 rounded-md px-2 text-sm transition-colors',
            value === option.value ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

type Places = { spaces: Parameters<typeof pageLabel>[1]; applets: Parameters<typeof pageLabel>[2] }

// What you sent as your side of a conversation, each with the team's answer so far (open or done)
// under it. There are no written replies in the data, so the status is the answer.
function MyFeedback({ items, pending, failed, places, onWrite }: { items: FeedbackItem[]; pending: boolean; failed: boolean; places: Places; onWrite: () => void }) {
  if (items.length === 0) {
    if (pending) return <p className="py-10 text-center text-muted-foreground">Loading…</p>
    if (failed) return <p className="py-10 text-center text-destructive">Couldn't load your feedback.</p>
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
        <p>Nothing here yet. What you send shows up here, with where it stands.</p>
        <Button variant="outline" onClick={onWrite}>
          Write feedback
        </Button>
      </div>
    )
  }
  return (
    <ul className="flex flex-col gap-5" aria-label="Your feedback, newest first">
      {items.map(item => (
        <li key={item.id} className="flex flex-col gap-1.5">
          <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-foreground">
            {/* Older feedback has a title of its own; newer titles are just the first line. */}
            {titleFrom(item.description) !== item.title && <div className="font-medium">{item.title}</div>}
            <p className="break-words whitespace-pre-wrap">{item.description}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            You · {formatLastActive(item.createdAt)} · {PRIORITY_LABEL[item.priority]} priority
            {item.page ? ` · from ${pageLabel(item.page, places.spaces, places.applets)}` : ''}
          </div>
          <div className="mr-auto flex items-center gap-1.5 rounded-2xl rounded-bl-md border px-3 py-1.5 text-muted-foreground">
            {item.completedAt ? (
              <>
                <IconCircleCheck size={16} stroke={1.75} className="text-primary" aria-hidden />
                <span title={new Date(item.completedAt).toLocaleString()}>Marked done by the team · {formatLastActive(item.completedAt)}</span>
              </>
            ) : (
              <>
                <IconClock size={16} stroke={1.75} aria-hidden />
                <span>With the team, not done yet</span>
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

// Everyone's feedback, for owners and admins: tick an item off when it has been dealt with.
function AllFeedback({ items, pending, failed }: { items: FeedbackItem[]; pending: boolean; failed: boolean }) {
  const complete = useCompleteFeedback()
  if (pending) return <p className="py-6 text-center text-muted-foreground">Loading…</p>
  if (failed) return <p className="py-6 text-center text-destructive">Couldn't load the feedback.</p>
  if (items.length === 0) return <p className="py-6 text-center text-muted-foreground">No feedback yet.</p>
  return (
    <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
      {items.map(item => (
        <li key={item.id} className="flex items-start justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent/50">
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{item.title}</div>
            <div className="text-xs text-muted-foreground">
              {PRIORITY_LABEL[item.priority]} · sent {formatLastActive(item.createdAt)} by {item.submitterName ?? item.submitterEmail ?? 'someone'}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/80">{item.description}</p>
          </div>
          <Button size="sm" variant="outline" disabled={complete.isPending} onClick={() => complete.mutate({ id: item.id, completed: !item.completedAt })}>
            {item.completedAt ? 'Reopen' : 'Mark done'}
          </Button>
          {item.completedAt ? (
            <Badge variant="secondary" title={new Date(item.completedAt).toLocaleString()}>
              Completed {formatLastActive(item.completedAt).toLowerCase()}
            </Badge>
          ) : (
            <Badge variant="outline">Open</Badge>
          )}
        </li>
      ))}
    </ul>
  )
}

export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const me = useMe()
  const workspace = useWorkspace()
  const applets = useApplets()
  const send = useSendFeedback()
  const [view, setView] = useState<View>('new')
  const canTriage = me.data ? hasAtLeast(me.data.tier, me.data.status, 'admin') : false
  const mine = useMyFeedback(open)
  const all = useAllFeedback(open && view === 'all' && canTriage)
  // The draft lives here, above the dialog's content, so closing (Escape, a click outside) keeps it.
  // shortcut: a page reload still loses it, move it to sessionStorage if people ask.
  const [text, setText] = useState('')
  const [restored, setRestored] = useState(false)
  const [sent, setSent] = useState<FeedbackItem | null>(null)
  const thanksRef = useRef<HTMLHeadingElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [priority, setPriority] = useState<FeedbackPriority>('medium')

  // Reset while rendering, not in an effect: the text box must be there when the dialog takes
  // focus on open, and an autoFocus instead would make the dialog forget where focus came from.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setView('new')
      setSent(null)
    }
  }

  // Coming back to the form from another tab or from "Send another".
  useEffect(() => {
    if (view === 'new') textRef.current?.focus()
  }, [view])

  // The send button that had focus is gone once the thank-you shows; put focus on the answer.
  useEffect(() => {
    if (sent) thanksRef.current?.focus()
  }, [sent])

  const setOpen = (next: boolean) => {
    if (!next) setRestored(Boolean(text.trim()))
    onOpenChange(next)
  }

  const places: Places = { spaces: workspace.data?.spaces ?? [], applets }
  const list = mine.data ?? []
  // The list refetches after a send; until it lands, show what was just sent anyway.
  const items = sent && !list.some(item => item.id === sent.id) ? [sent, ...list] : list
  const firstName = me.data?.name?.trim().split(/\s+/)[0]

  const submit = () => {
    const body = text.trim()
    if (!body || send.isPending) return
    send.mutate(
      { title: titleFrom(body), description: body, priority, page: location.pathname },
      {
        // On failure nothing is cleared: the text stays and the form shows why.
        onSuccess: item => {
          setText('')
          setPriority('medium')
          setSent(item)
          setView('mine')
        }
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Roomy on a desktop, a full-height sheet on a phone. */}
      <DialogContent
        initialFocus={textRef}
        className="flex max-h-dvh flex-col overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-h-[90dvh] sm:max-w-2xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{view === 'all' ? 'All feedback' : view === 'mine' ? 'Your feedback' : 'Tell us what you think'}</DialogTitle>
          <DialogDescription>
            {view === 'all'
              ? 'Everything people sent. Mark an item done once it has been dealt with.'
              : view === 'mine'
                ? 'Everything you sent, and where it stands.'
                : 'A problem, an idea, or something that works well. It goes to the team with your name, so they can follow up.'}
          </DialogDescription>
        </DialogHeader>

        <Segmented
          label="What to show"
          value={view}
          onChange={setView}
          options={[
            { value: 'new', label: 'New feedback' },
            { value: 'mine', label: 'Your feedback' },
            ...(canTriage ? [{ value: 'all' as const, label: 'All feedback' }] : [])
          ]}
        />

        {/* Always in the page, so a screen reader announces the result when the text changes. */}
        <p role="status" className="sr-only">
          {send.isPending ? 'Sending your feedback…' : sent ? 'Your feedback was sent. Thank you.' : ''}
        </p>

        {view === 'new' ? (
          <form
            className="flex flex-1 flex-col gap-4"
            onSubmit={event => {
              event.preventDefault()
              submit()
            }}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          >
            <label className="flex flex-1 flex-col gap-1.5">
              <span className="text-base font-medium text-foreground">What's on your mind?</span>
              <Textarea
                ref={textRef}
                value={text}
                onChange={event => {
                  setText(event.target.value)
                  setRestored(false)
                }}
                maxLength={DESCRIPTION_MAX}
                placeholder="What happened, or what would make this better? A few words is plenty."
                className="max-h-[50dvh] min-h-40 p-3 max-sm:flex-1 sm:min-h-52"
                aria-describedby="feedback-context"
                required
              />
            </label>
            {restored && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                Your draft from before is still here.
                <button type="button" className="underline underline-offset-4 hover:text-foreground" onClick={() => { setText(''); setRestored(false) }}>
                  Start over
                </button>
              </p>
            )}
            <p id="feedback-context" className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <IconMapPin size={14} stroke={1.75} className="mt-px shrink-0" aria-hidden />
              <span>
                Sent with it: your name, and the page you are on (<span className="text-foreground">{pageLabel(location.pathname, places.spaces, places.applets)}</span>).
              </span>
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground">How urgent is it?</span>
              <Segmented
                label="How urgent is it?"
                value={priority}
                onChange={setPriority}
                options={[...FEEDBACK_PRIORITIES].reverse().map(p => ({ value: p, label: PRIORITY_LABEL[p] }))}
              />
            </div>
            {send.isError && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
                That didn't go through: {send.error instanceof Error ? send.error.message : String(send.error)}. Your text is still here, so you can try again.
              </p>
            )}
            <DialogFooter className="sm:items-center">
              <span className="text-xs text-muted-foreground max-sm:hidden">Ctrl or ⌘ + Enter sends</span>
              <Button type="submit" size="lg" disabled={send.isPending || !text.trim()} aria-busy={send.isPending}>
                {send.isPending && <IconLoader2 className="animate-spin" aria-hidden />}
                {send.isPending ? 'Sending…' : 'Send feedback'}
              </Button>
            </DialogFooter>
          </form>
        ) : view === 'all' ? (
          <AllFeedback items={all.data ?? []} pending={all.isPending} failed={all.isError} />
        ) : (
          <>
            {sent && (
              <div className="flex flex-col gap-3 rounded-xl bg-accent/60 p-4 sm:flex-row sm:items-center">
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground motion-safe:animate-in motion-safe:duration-500 motion-safe:zoom-in-50 motion-safe:fade-in-0">
                  <span aria-hidden className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ping motion-safe:[animation-fill-mode:forwards] motion-safe:[animation-iteration-count:1] motion-reduce:hidden" />
                  <IconCheck size={20} stroke={2.5} aria-hidden />
                </span>
                <div className="flex-1">
                  <h3 ref={thanksRef} tabIndex={-1} className="text-base font-medium text-foreground outline-none">
                    Thank you{firstName ? `, ${firstName}` : ''}. We got it.
                  </h3>
                  <p className="text-muted-foreground">It is on the team's list now. When someone has dealt with it, it shows as done right here.</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => { setSent(null); setView('new') }}>
                    Send another
                  </Button>
                  <Button onClick={() => setOpen(false)}>Done</Button>
                </div>
              </div>
            )}
            <MyFeedback items={items} pending={mine.isPending} failed={mine.isError} places={places} onWrite={() => setView('new')} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

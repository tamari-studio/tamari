// Shared pieces for the Newsletter tabs: load state, plain error text, dates, and the "Run now"
// bar that drives the pipeline one server step at a time.
import { useRef, useState, type ReactNode } from 'react'
import { IconAlertTriangle, IconCheck, IconPlayerPlay, IconRss } from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Button } from '../ui/button'
import { Spinner } from '../ui/spinner'
import { friendlyError } from './_errors'
import { NO_SOURCES_MESSAGE } from './_sources'
import { runStep, startRun, type StepResult } from './news.server'

export { friendlyError }

export type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; value: T }

/** The hosted functions stop at 60 s; give up a little before so the page can say so. */
const CLIENT_TIMEOUT_MS = 55_000
/** A run never takes more steps than this, whatever the server says. */
const MAX_STEPS = 40

export function timeOut<T>(promise: Promise<T>, ms = CLIENT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server took too long to answer')), ms)
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

export const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export const dayLabel = (day: string, today: string) =>
  day === today ? 'Today' : new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

/** Time since, in plain words: "5 min ago", "3 h ago", "2 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 36) return `${hours} h ago`
  return `${Math.round(hours / 24)} days ago`
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-medium">{title}</h1>
      {children}
    </div>
  )
}

type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; line: string }
  | { kind: 'finished'; lines: string[]; result: StepResult | null; error?: string }

/**
 * Runs the pipeline: fetch feeds, rate new articles, write today's posts. Each press runs every
 * pending step, one server call at a time, then calls `onFinished` so the tab reloads its data.
 * With `noSources` (no feeds listed in _sources.ts) there is nothing to run: the button waits
 * and the bar says how to add a source.
 */
export function RunBar({ onFinished, noSources = false }: { onFinished: () => void; noSources?: boolean }) {
  const [state, setState] = useState<RunState>({ kind: 'idle' })
  const busy = useRef(false)

  async function run() {
    if (busy.current) return
    busy.current = true
    const lines: string[] = []
    let last: StepResult | null = null
    try {
      setState({ kind: 'running', line: 'Starting' })
      const { startedAt } = await timeOut(startRun())
      for (let i = 0; i < MAX_STEPS; i++) {
        setState({ kind: 'running', line: lines.at(-1) ?? 'Fetching the feeds' })
        last = await timeOut(runStep(startedAt))
        lines.push(last.message)
        if (last.done) break
      }
      setState({ kind: 'finished', lines, result: last })
    } catch (err) {
      setState({ kind: 'finished', lines, result: last, error: friendlyError(err) })
    } finally {
      busy.current = false
      onFinished()
    }
  }

  const running = state.kind === 'running'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={run} disabled={running || noSources}>
          {running ? <Spinner data-icon="inline-start" /> : <IconPlayerPlay data-icon="inline-start" stroke={1.75} />}
          {running ? 'Running' : 'Run now'}
        </Button>
        <span className="min-w-0 truncate text-sm text-muted-foreground" aria-live="polite">
          {noSources
            ? NO_SOURCES_MESSAGE
            : state.kind === 'running'
              ? state.line
              : state.kind === 'finished' && !state.error && !state.result?.warning && !state.result?.noSources
                ? state.result?.message ?? 'Done'
                : 'Fetches the feeds, rates new articles and drafts today’s posts'}
        </span>
      </div>
      {state.kind === 'finished' && (state.error || state.result?.warning) && (
        <Alert variant="destructive">
          <IconAlertTriangle stroke={1.75} />
          <AlertTitle>{state.error ? 'The run stopped' : 'The run stopped early'}</AlertTitle>
          <AlertDescription>{state.error ?? state.result?.warning}</AlertDescription>
        </Alert>
      )}
      {state.kind === 'finished' && state.result?.noSources && !noSources && (
        <Alert>
          <IconRss stroke={1.75} />
          <AlertTitle>No sources yet</AlertTitle>
          <AlertDescription>{state.result.message}</AlertDescription>
        </Alert>
      )}
      {state.kind === 'finished' && state.lines.length > 0 && !state.result?.noSources && (
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none">What the run did ({state.lines.length} steps)</summary>
          <ul className="mt-1 flex flex-col gap-0.5 pl-4">
            {state.lines.map((line, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <IconCheck className="mt-0.5 size-3.5 shrink-0" stroke={1.75} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export function KeyMissing() {
  return (
    <Alert>
      <IconAlertTriangle stroke={1.75} />
      <AlertTitle>The AI key isn't set up yet</AlertTitle>
      <AlertDescription>
        Feeds are fetched, but rating and writing wait for the workspace variable NEWSLETTER_ANTHROPIC_KEY. An admin adds it at
        /connectors.
      </AlertDescription>
    </Alert>
  )
}

export function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <IconAlertTriangle stroke={1.75} />
      <AlertTitle>Couldn't load this tab</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-2">
        {message}.
        <Button size="xs" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}

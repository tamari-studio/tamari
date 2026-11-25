// Email checker: upload a contacts CSV, check every address, download the same
// file with the verdict columns added.
// The browser reads the file and sends the addresses in batches to
// bouncer.server.ts (syntax, throwaway domains, shared inboxes, the domain's mail
// server). No mail is sent and nothing is stored.
import { useEffect, useRef, useState } from 'react'
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconDownload,
  IconFileSpreadsheet,
  IconRefresh,
  IconUpload
} from '@tabler/icons-react'

import { Alert, AlertDescription, AlertTitle } from '../ui/alert'
import { Button } from '../ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { cn } from '../ui/utils'
import { decodeCsv, readContacts, resultsCsv, TEMPLATE_CSV, type Sheet } from './_bounce-csv'
import {
  MAX_PER_CALL,
  REASON_LABEL,
  VERDICT_LABEL,
  type EmailVerdict,
  type Reason,
  type Verdict
} from './_bounce-shared'
import { checkEmails } from './bouncer.server'

export const config = {
  title: 'Email checker',
  icon: 'mail'
} as const

type Loaded = { fileName: string; sheet: Sheet; emailColumn: number }

type Run =
  | { kind: 'idle' }
  | { kind: 'checking'; done: number; total: number; stopping: boolean }
  | { kind: 'stopped'; done: number; total: number; error: string | null }
  | { kind: 'done'; verdicts: EmailVerdict[]; checkedAt: string }

/** Flagged rows shown on screen; the rest are in the download. */
const SHOWN_FLAGGED = 50

const VERDICTS: Verdict[] = ['ok', 'review', 'skip']

const VERDICT_ICON = {
  ok: IconCircleCheck,
  review: IconAlertTriangle,
  skip: IconCircleX
} as const

const VERDICT_TONE: Record<Verdict, string> = {
  ok: 'text-success',
  review: 'text-foreground',
  skip: 'text-destructive'
}

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`

function saveTextFile(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const emailKey = (raw: string | undefined) => (raw ?? '').trim()

/** A server error as one plain line: a function timeout or gateway page is not something to show raw. */
function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : ''
  if (!message || message.length > 200 || message.includes('\n') || /<|FUNCTION_INVOCATION|timeout|timed out|504|502/i.test(message)) {
    return 'The server took too long to answer or could not be reached'
  }
  return message.replace(/\.$/, '')
}

/** Passes over the remaining addresses before giving up on ones that keep running out of time. */
const MAX_PASSES = 3

export default function Bouncer() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [run, setRun] = useState<Run>({ kind: 'idle' })
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  // Verdicts by address, kept across "Try again" so finished batches aren't redone.
  const answers = useRef(new Map<string, EmailVerdict>())
  const cancelled = useRef(false)

  // Leaving the tab ends a run: no more calls for results nobody will see.
  useEffect(
    () => () => {
      cancelled.current = true
    },
    []
  )

  async function openFile(file: File) {
    setRun({ kind: 'idle' })
    answers.current = new Map()
    if (!/\.(csv|txt)$/i.test(file.name) && !file.type.includes('csv') && !file.type.startsWith('text/')) {
      setLoaded(null)
      setFileError(`${file.name} isn't a CSV file. Save the sheet as CSV and upload that.`)
      return
    }
    try {
      const read = readContacts(decodeCsv(await file.arrayBuffer()))
      if (!read.ok) {
        setLoaded(null)
        setFileError(read.error)
        return
      }
      setFileError(null)
      setLoaded({ fileName: file.name, sheet: read.sheet, emailColumn: read.emailColumn })
    } catch (err) {
      setLoaded(null)
      setFileError(`Couldn't read ${file.name}: ${(err as Error).message}`)
    }
  }

  async function check() {
    if (!loaded) return
    const { sheet, emailColumn } = loaded
    const distinct = [...new Set(sheet.rows.map(row => emailKey(row[emailColumn])))]
    const total = distinct.length
    const stop = (error: string | null) => setRun({ kind: 'stopped', done: answers.current.size, total, error })
    cancelled.current = false
    setRun({ kind: 'checking', done: answers.current.size, total, stopping: false })

    // Addresses the server hands back unchecked (their domain ran out of time)
    // stay out of `answers` and go round again on the next pass.
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const todo = distinct.filter(email => !answers.current.has(email))
      if (todo.length === 0) break
      for (let i = 0; i < todo.length; i += MAX_PER_CALL) {
        if (cancelled.current) return stop(null)
        const batch = todo.slice(i, i + MAX_PER_CALL)
        let verdicts: (EmailVerdict | null)[] | null = null
        let lastError: unknown = null
        // One retry: a batch can fail on a cold start or a dropped connection.
        for (let attempt = 0; attempt < 2 && !verdicts && !cancelled.current; attempt++) {
          try {
            verdicts = await checkEmails(batch)
          } catch (err) {
            lastError = err
          }
        }
        if (cancelled.current) return stop(null)
        if (!verdicts) return stop(friendlyError(lastError))
        batch.forEach((email, j) => {
          const verdict = verdicts![j]
          if (verdict) answers.current.set(email, verdict)
        })
        setRun({ kind: 'checking', done: answers.current.size, total, stopping: cancelled.current })
      }
    }
    if (answers.current.size < total) {
      return stop('Some domains were too slow to answer')
    }

    setRun({
      kind: 'done',
      verdicts: sheet.rows.map(row => answers.current.get(emailKey(row[emailColumn]))!),
      checkedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
    })
  }

  function reset() {
    cancelled.current = true
    answers.current = new Map()
    setLoaded(null)
    setFileError(null)
    setRun({ kind: 'idle' })
  }

  const busy = run.kind === 'checking'

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-medium">Email checker</h1>
          <p className="text-sm text-muted-foreground">
            Find the addresses that would bounce before you send to a list. Each address is checked for typos, throwaway
            domains and shared inboxes, and its domain for a working mail server. No mail is sent and nothing is saved.
          </p>
        </header>

        {!loaded && (
          <section
            className={cn(
              'flex flex-col items-center gap-3 rounded-xl px-6 py-10 text-center ring-1 ring-border',
              dragging ? 'bg-accent text-accent-foreground' : 'bg-card text-card-foreground'
            )}
            onDragOver={e => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files?.[0]
              if (file) void openFile(file)
            }}
          >
            <IconFileSpreadsheet className="size-8 text-muted-foreground" stroke={1.5} />
            <div className="flex flex-col gap-1">
              <p className="text-base">Drop a CSV file of contacts here</p>
              <p className="text-sm text-muted-foreground">
                It needs a column named Email. Up to 10,000 rows; other columns are kept as they are.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => fileRef.current?.click()}>
                <IconUpload data-icon="inline-start" stroke={1.75} />
                Choose file
              </Button>
              <Button variant="ghost" onClick={() => saveTextFile('contacts-template.csv', TEMPLATE_CSV)}>
                <IconDownload data-icon="inline-start" stroke={1.75} />
                Download template
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) void openFile(file)
                e.target.value = ''
              }}
            />
          </section>
        )}

        {fileError && (
          <Alert variant="destructive">
            <IconCircleX stroke={1.75} />
            <AlertTitle>This file can't be checked</AlertTitle>
            <AlertDescription>{fileError}</AlertDescription>
          </Alert>
        )}

        {loaded && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconFileSpreadsheet className="size-6 shrink-0 text-muted-foreground" stroke={1.5} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{loaded.fileName}</p>
                  <p className="text-sm text-muted-foreground">
                    {count(loaded.sheet.rows.length, 'contact')}, addresses in the “{loaded.sheet.headers[loaded.emailColumn]?.trim()}” column
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={reset} disabled={busy}>
                  Choose another file
                </Button>
                {run.kind === 'idle' && <Button onClick={() => void check()}>Check addresses</Button>}
              </div>
            </div>

            {(run.kind === 'checking' || run.kind === 'stopped') && (
              <Progress
                run={run}
                onCancel={() => {
                  cancelled.current = true
                  setRun(r => (r.kind === 'checking' ? { ...r, stopping: true } : r))
                }}
                onRetry={() => void check()}
              />
            )}

            {run.kind === 'done' && (
              <Results
                loaded={loaded}
                verdicts={run.verdicts}
                onDownload={() =>
                  saveTextFile(
                    `${loaded.fileName.replace(/\.(csv|txt)$/i, '')}-checked.csv`,
                    resultsCsv(loaded.sheet, run.verdicts, run.checkedAt)
                  )
                }
              />
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function Progress({
  run,
  onCancel,
  onRetry
}: {
  run: Extract<Run, { kind: 'checking' | 'stopped' }>
  onCancel: () => void
  onRetry: () => void
}) {
  const pct = run.total === 0 ? 0 : Math.round((run.done / run.total) * 100)
  return (
    <div className="flex flex-col gap-3">
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label="Addresses checked"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {run.kind === 'checking' ? 'Checked' : 'Stopped at'} {run.done.toLocaleString('en')} of {count(run.total, 'address', 'addresses')}
        </p>
        {run.kind === 'checking' ? (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={run.stopping}>
            {run.stopping ? 'Stopping after this batch' : 'Stop'}
          </Button>
        ) : (
          <Button size="sm" onClick={onRetry}>
            <IconRefresh data-icon="inline-start" stroke={1.75} />
            Continue checking
          </Button>
        )}
      </div>
      {run.kind === 'stopped' && run.error && (
        <Alert variant="destructive">
          <IconCircleX stroke={1.75} />
          <AlertTitle>Checking stopped</AlertTitle>
          <AlertDescription>{run.error}. The addresses checked so far are kept; continue to check the rest.</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

function Results({ loaded, verdicts, onDownload }: { loaded: Loaded; verdicts: EmailVerdict[]; onDownload: () => void }) {
  const byVerdict = Object.fromEntries(VERDICTS.map(v => [v, 0])) as Record<Verdict, number>
  const reasons = new Map<Reason, number>()
  for (const v of verdicts) {
    byVerdict[v.verdict]++
    if (v.reason_code) reasons.set(v.reason_code, (reasons.get(v.reason_code) ?? 0) + 1)
  }
  const flagged = loaded.sheet.rows
    .map((row, i) => ({ email: (row[loaded.emailColumn] ?? '').trim(), verdict: verdicts[i]! }))
    .filter(r => r.verdict.verdict !== 'ok')
    .sort((a, b) => (a.verdict.verdict === b.verdict.verdict ? 0 : a.verdict.verdict === 'skip' ? -1 : 1))

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {VERDICTS.map(v => {
          const Icon = VERDICT_ICON[v]
          return (
            <div key={v} className="flex flex-col gap-1">
              <div className={cn('flex items-center gap-1.5 text-sm', VERDICT_TONE[v])}>
                <Icon className="size-4" stroke={1.75} />
                {VERDICT_LABEL[v]}
              </div>
              <p className="text-2xl font-medium tabular-nums">{byVerdict[v].toLocaleString('en')}</p>
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onDownload}>
          <IconDownload data-icon="inline-start" stroke={1.75} />
          Download results
        </Button>
        <p className="text-sm text-muted-foreground">Your file with a verdict and reason added to every row</p>
      </div>

      {flagged.length === 0 ? (
        <p className="text-sm text-muted-foreground">Every address looks fine to send to.</p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-medium">Addresses to look at</h2>
            <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
              {[...reasons.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([reason, n]) => (
                  <li key={reason} className="tabular-nums">
                    {REASON_LABEL[reason]}: {n.toLocaleString('en')}
                  </li>
                ))}
            </ul>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Address</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Why</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flagged.slice(0, SHOWN_FLAGGED).map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="max-w-64 truncate">{r.email || <span className="text-muted-foreground">(empty)</span>}</TableCell>
                  <TableCell className={cn('whitespace-nowrap', VERDICT_TONE[r.verdict.verdict])}>{VERDICT_LABEL[r.verdict.verdict]}</TableCell>
                  <TableCell className="text-muted-foreground">{r.verdict.reason_code ? REASON_LABEL[r.verdict.reason_code] : ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {flagged.length > SHOWN_FLAGGED && (
            <p className="text-sm text-muted-foreground">
              {count(flagged.length - SHOWN_FLAGGED, 'more address', 'more addresses')} in the downloaded results
            </p>
          )}
        </div>
      )}
    </div>
  )
}

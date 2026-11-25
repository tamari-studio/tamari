// The few building blocks every starter template uses, so the five spaces look alike and match
// the app: a page with a header, buttons, form fields, badges, the empty state, the examples bar
// and the widget tile. Plain Tailwind with the app's theme tokens; no packages of its own.
//
// This file is the same in every starter template (cli/template.test.ts checks that). Change it
// freely once the space is yours.
import { useCallback, useEffect, useState, type ComponentProps, type ReactNode } from 'react'

export function cx(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

/** A full page in a tab: a slim header with the title, a count and actions, then the content. */
export function Page({ title, count, actions, children }: { title: string; count?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h1 className="px-2 text-sm font-medium">{title}</h1>
        {count && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto rounded-tl-xl bg-background p-6 shadow-xs">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">{children}</div>
      </main>
    </div>
  )
}

const BUTTON = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/80',
  outline: 'border-border bg-background hover:bg-muted',
  ghost: 'hover:bg-muted',
  danger: 'bg-destructive/10 text-destructive hover:bg-destructive/20'
}

export function Button({ variant = 'outline', className, type = 'button', ...props }: ComponentProps<'button'> & { variant?: keyof typeof BUTTON }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        BUTTON[variant],
        className
      )}
      {...props}
    />
  )
}

/** For `<input>`, `<select>` and `<textarea>`. */
export const inputClass =
  'min-h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50'

export function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cx('flex min-w-0 flex-col gap-1 text-sm', className)}>
      <span className="font-medium">
        {label}
        {hint && <span className="font-normal text-muted-foreground"> ({hint})</span>}
      </span>
      {children}
    </label>
  )
}

const BADGE = {
  plain: 'border-transparent bg-muted text-muted-foreground',
  accent: 'border-transparent bg-primary/10 text-primary',
  good: 'border-transparent bg-success/10 text-success',
  bad: 'border-transparent bg-destructive/10 text-destructive',
  outline: 'border-border text-muted-foreground'
}

export type Tone = keyof typeof BADGE

export function Badge({ tone = 'plain', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('inline-flex w-fit shrink-0 items-center rounded-sm border px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', BADGE[tone])}>{children}</span>
}

/** A card for a form or a group of rows. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-lg bg-card p-4 text-card-foreground ring-1 ring-border', className)}>{children}</section>
}

/** What a new team sees first: what the page is for, the first steps, and the two ways to start. */
export function Empty({ title, steps, children }: { title: string; steps: string[]; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-base font-medium">{title}</h2>
      <ol className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2">
            <span className="w-4 shrink-0 tabular-nums">{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-2 pt-1">{children}</div>
    </Card>
  )
}

/** Shown while example rows are in the list. */
export function ExamplesBar({ count, busy, onRemove }: { count: number; busy: boolean; onRemove: () => void }) {
  if (count === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 text-muted-foreground">
        {count === 1 ? '1 row is an example.' : `${count} rows are examples.`} Remove them when you have added your own. That also removes examples you changed.
      </span>
      <Button onClick={onRemove} disabled={busy}>
        Remove examples
      </Button>
    </div>
  )
}

export function Problem({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null
}

/**
 * A widget on the Widgets tab. It fills its tile at every size: the number stays, and the rows
 * below it are cut off where the tile ends.
 */
export function Tile({ title, value, note, tone, children }: { title: string; value?: string; note?: string; tone?: 'bad'; children?: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden p-3">
      <div className="flex shrink-0 flex-col gap-0.5">
        <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
        {value !== undefined && <span className={cx('truncate text-2xl leading-tight font-medium tabular-nums', tone === 'bad' && 'text-destructive')}>{value}</span>}
        {note && <span className="truncate text-xs text-muted-foreground">{note}</span>}
      </div>
      {children && <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">{children}</div>}
    </div>
  )
}

/** One line in a widget's list: what on the left, a short detail on the right. */
export function TileRow({ label, detail, tone }: { label: string; detail?: string; tone?: 'bad' }) {
  return (
    <div className="flex shrink-0 items-baseline gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {detail && <span className={cx('shrink-0 tabular-nums', tone === 'bad' ? 'text-destructive' : 'text-muted-foreground')}>{detail}</span>}
    </div>
  )
}

type Loaded<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; rows: T[] }

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Loads a list through a server function and runs changes on it. `run` shows what went wrong in
 * `problem` and loads the list again when the change worked.
 */
export function useRows<T>(load: () => Promise<T[]>) {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const reload = useCallback(
    () =>
      load().then(
        rows => setState({ status: 'ready', rows }),
        err => setState({ status: 'error', message: message(err) })
      ),
    [load]
  )
  useEffect(() => {
    void reload()
  }, [reload])

  const run = useCallback(
    async (change: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true)
      setProblem(null)
      try {
        await change()
        await reload()
        return true
      } catch (err) {
        setProblem(message(err))
        return false
      } finally {
        setBusy(false)
      }
    },
    [reload]
  )

  return { state, busy, problem, run }
}

/** The local day as YYYY-MM-DD. */
export function today(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

/** "4 Mar" for a YYYY-MM-DD day, '' for none. */
export function shortDay(day: string): string {
  return day ? DAY.format(new Date(`${day}T12:00:00`)) : ''
}

export function wholeNumber(n: number): string {
  return Math.round(n).toLocaleString()
}

// Usage: how the app is used, for admins and owners. Counts people and visits per day, space,
// tab, workspace page and action, from the events every signed-in browser sends
// (client/lib/usage.ts). Spaces and views the viewer's tier doesn't see are left out of every
// number. Owners also see when each member was last seen; nobody sees what one person opened.
import { useState } from 'react'
import { USAGE_DAYS, type UsageReport } from '../../lib/usage'
import { TIER_LABEL, usageTargetLabel } from '../lib/labels'
import { formatLastActive } from '../lib/relative-time'
import { useApplets, useUsageReport } from '../lib/queries'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { cn } from '../ui/utils'
import type { MemberTier } from '../../lib/types'

const DAY_LABEL = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const dayLabel = (day: string) => DAY_LABEL.format(new Date(`${day}T12:00:00`))
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-background px-4 py-3 shadow-xs">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-medium tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground">{hint}</span>
    </div>
  )
}

// People active per day: one bar per day, the value on hover and for screen readers.
function DailyChart({ daily }: { daily: UsageReport['daily'] }) {
  const max = Math.max(1, ...daily.map(d => d.users))
  const label = (d: UsageReport['daily'][number]) =>
    `${dayLabel(d.day)}: ${people(d.users)}, ${d.sessions} ${d.sessions === 1 ? 'session' : 'sessions'}`
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-background px-4 py-3 shadow-xs">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">People active per day</h2>
        <span className="text-xs text-muted-foreground tabular-nums">Most in a day: {max}</span>
      </div>
      <ol className="flex h-32 items-end justify-between gap-0.5" aria-label="People active per day">
        {daily.map(d => (
          <li key={d.day} className="group relative flex h-full min-w-0 max-w-10 flex-1 items-end" title={label(d)} aria-label={label(d)}>
            <div
              className={cn('w-full rounded-t-[4px] bg-primary/80 group-hover:bg-primary', d.users === 0 && 'bg-border')}
              style={{ height: d.users === 0 ? 2 : `${(d.users / max) * 100}%` }}
            />
          </li>
        ))}
      </ol>
      {daily.length > 0 && (
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{dayLabel(daily[0].day)}</span>
          <span>{dayLabel(daily[daily.length - 1].day)}</span>
        </div>
      )}
    </section>
  )
}

type Row = { key: string; label: string; detail?: string; count: number; users?: number }

function Ranked({ title, rows, unit, empty }: { title: string; rows: Row[]; unit: [string, string]; empty: string }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-background px-4 py-3 shadow-xs">
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th>Name</th>
              <th>{unit[1]}</th>
              {rows.some(r => r.users !== undefined) && <th>People</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="align-middle">
                <td className="max-w-0 py-1 pr-3">
                  <div className="truncate">{r.label}</div>
                  {r.detail && <div className="truncate text-xs text-muted-foreground">{r.detail}</div>}
                  <div className="mt-1 h-1 rounded-full bg-accent">
                    <div className="h-1 rounded-full bg-primary/70" style={{ width: `${(r.count / max) * 100}%` }} />
                  </div>
                </td>
                <td className="w-20 py-1 text-right text-xs tabular-nums whitespace-nowrap">
                  {r.count} {r.count === 1 ? unit[0] : unit[1]}
                </td>
                {r.users !== undefined && (
                  <td className="w-24 py-1 text-right text-xs text-muted-foreground tabular-nums whitespace-nowrap">{people(r.users)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function Members({ members }: { members: NonNullable<UsageReport['members']> }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-background px-4 py-3 shadow-xs">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-medium">Last seen</h2>
        <p className="text-xs text-muted-foreground">Owners only. When each member last used the app, not what they opened.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">Member</th>
            <th className="py-1 font-normal">Role</th>
            <th className="py-1 text-right font-normal">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.userId}>
              <td className="max-w-0 py-1 pr-3">
                <div className="truncate">{m.name ?? m.email.split('@')[0]}</div>
                <div className="truncate text-xs text-muted-foreground">{m.email}</div>
              </td>
              <td className="py-1 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                {m.status === 'active' ? (m.tier ? TIER_LABEL[m.tier as MemberTier] ?? m.tier : 'No role') : m.status === 'pending' ? 'Waiting' : 'Suspended'}
              </td>
              <td className="py-1 text-right text-xs tabular-nums whitespace-nowrap" title={m.lastSeenAt ?? undefined}>
                {formatLastActive(m.lastSeenAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export function UsagePage() {
  const [days, setDays] = useState<number>(30)
  const report = useUsageReport(days)
  const applets = useApplets()
  const data = report.data
  const spaceName = new Map(data?.spaces.map(s => [s.spaceId, s.name]))

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 max-md:p-4">
      <header className="flex items-end justify-between gap-4 max-md:flex-col max-md:items-start">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Usage</h1>
          <p className="text-sm text-muted-foreground">
            How people use the app: who is active, and which spaces, tabs and pages they open. Spaces you don't see are left out.
          </p>
        </div>
        <div role="group" aria-label="Time range" className="flex shrink-0 gap-1 rounded-lg bg-background p-1 shadow-xs">
          {USAGE_DAYS.map(d => (
            <Button key={d} size="xs" variant={d === days ? 'secondary' : 'ghost'} aria-pressed={d === days} onClick={() => setDays(d)}>
              {d} days
            </Button>
          ))}
        </div>
      </header>

      {report.isPending && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      )}
      {report.isError && <p className="text-sm text-destructive">Couldn't load usage: {report.error.message}</p>}

      {data && (
        <>
          <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Stat label="Active today" value={data.active.today} hint="people" />
            <Stat label="Active this week" value={data.active.week} hint="people, last 7 days" />
            <Stat label="Active this month" value={data.active.month} hint="people, last 30 days" />
            <Stat label="Sessions" value={data.totals.sessions} hint={`in the last ${data.days} days`} />
          </div>

          <DailyChart daily={data.daily} />

          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            <Ranked
              title="Spaces"
              unit={['visit', 'visits']}
              empty="Nobody has opened a space in this time."
              rows={data.spaces.map(s => ({ key: s.spaceId, label: s.name, count: s.views, users: s.users }))}
            />
            <Ranked
              title="Tabs"
              unit={['visit', 'visits']}
              empty="Nobody has opened a tab in this time."
              rows={data.tabs.slice(0, 15).map(t => ({
                key: `${t.spaceId} ${t.target}`,
                label: usageTargetLabel(t.target, applets),
                detail: spaceName.get(t.spaceId) ?? t.spaceId,
                count: t.views,
                users: t.users
              }))}
            />
            <Ranked
              title="Workspace pages"
              unit={['visit', 'visits']}
              empty="Nobody has opened a workspace page in this time."
              rows={data.pages.map(p => ({ key: p.target, label: usageTargetLabel(p.target, applets), count: p.views, users: p.users }))}
            />
            <Ranked
              title="Actions"
              unit={['time', 'times']}
              empty="Nobody has changed tabs, widgets or spaces in this time."
              rows={data.actions.map(a => ({ key: a.target, label: usageTargetLabel(a.target, applets), count: a.count, users: a.users }))}
            />
          </div>

          {data.weekly.length > 1 && (
            <Ranked
              title="People active per week"
              unit={['person', 'people']}
              empty=""
              rows={data.weekly.map(w => ({ key: w.week, label: `Week of ${dayLabel(w.week)}`, count: w.users }))}
            />
          )}

          {data.members && <Members members={data.members} />}
        </>
      )}
    </div>
  )
}

// People & access: one area for who is in the workspace (Members), how they are
// grouped (Departments) and who sees each space (Spaces). The three tabs keep
// the addresses the two old pages had, so old links still land.
import type { MouseEvent } from 'react'
import { hasAtLeast } from '../../vendor/dto-core/tier'
import { useMe } from '../lib/queries'
import { navigate } from '../lib/router'
import { Skeleton } from '../ui/skeleton'
import { cn } from '../ui/utils'
import { DepartmentsPage } from './DepartmentsPage'
import { MembersPage } from './MembersPage'
import { SpaceAccessPage } from './SpaceAccessPage'

const TABS = [
  { id: 'members', label: 'Members', path: '/members' },
  { id: 'departments', label: 'Teams', path: '/members/departments' },
  { id: 'spaces', label: 'Spaces', path: '/space-access' }
] as const

export type PeopleTab = (typeof TABS)[number]['id']

export function PeoplePage({ tab }: { tab: PeopleTab }) {
  const me = useMe()

  // Real links, so they can be opened in a new tab; a plain click stays in the app.
  const go = (path: string) => (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(path)
  }

  if (me.isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6 max-md:p-4">
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  // The API refuses anyone else; say so here instead of showing its error three times over.
  if (!hasAtLeast(me.data?.tier ?? null, me.data?.status ?? null, 'admin')) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm">
        <p className="font-medium">This page is for admins and owners.</p>
        <p className="text-muted-foreground">Ask an admin if you need a space opened to you or your team changed.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 max-md:p-4">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">People & access</h1>
        <nav aria-label="People and access" className="flex gap-1 border-b">
          {TABS.map(t => (
            <a
              key={t.id}
              href={t.path}
              onClick={go(t.path)}
              aria-current={t.id === tab ? 'page' : undefined}
              className={cn(
                '-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                t.id === tab ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      {tab === 'members' && <MembersPage />}
      {tab === 'departments' && <DepartmentsPage />}
      {tab === 'spaces' && <SpaceAccessPage />}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from 'miso'

import { historyPath, type ActivityItem, type ActivityPage } from '../lib/activity'
import { ActivityList } from '../ui/activity-list'
import { Button } from '../ui/button'

export const config = {
  title: 'Activity',
  icon: 'activity'
} as const

// Who changed what, when: shared data, pages and spaces, newest first. The app's own API answers
// as the person reading (GET /api/history), so everyone sees only the spaces they have access to.

async function loadPage(space: string, before: number | null): Promise<ActivityPage> {
  const res = await apiFetch(historyPath({ space: space || null, before }))
  if (!res.ok) throw new Error(String(res.status))
  return (await res.json()) as ActivityPage
}

type State = { items: ActivityItem[]; next: number | null; status: 'loading' | 'ready' | 'more' | 'failed' }

export default function Activity() {
  const [space, setSpace] = useState('')
  const [spaces, setSpaces] = useState<ActivityPage['spaces']>([])
  const [state, setState] = useState<State>({ items: [], next: null, status: 'loading' })

  const load = useCallback((spaceId: string) => {
    let stale = false
    setState({ items: [], next: null, status: 'loading' })
    loadPage(spaceId, null).then(
      page => {
        if (stale) return
        setSpaces(page.spaces)
        setState({ items: page.items, next: page.next, status: 'ready' })
      },
      () => !stale && setState({ items: [], next: null, status: 'failed' })
    )
    return () => {
      stale = true
    }
  }, [])

  useEffect(() => load(space), [load, space])

  const more = () => {
    if (state.next === null || state.status !== 'ready') return
    const asked = space
    setState(s => ({ ...s, status: 'more' }))
    loadPage(asked, state.next).then(
      page => setState(s => ({ items: [...s.items, ...page.items], next: page.next, status: 'ready' })),
      () => setState(s => ({ ...s, status: 'ready' }))
    )
  }

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-medium">Activity</h1>
            <p className="text-sm text-muted-foreground">Who changed what, in the spaces you have access to.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Show</span>
            <select
              value={space}
              onChange={e => setSpace(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">All spaces</option>
              {spaces.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </header>

        {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading…</p>}
        {state.status === 'failed' && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">The activity could not be loaded.</p>
            <Button variant="outline" onClick={() => load(space)}>
              Try again
            </Button>
          </div>
        )}
        {(state.status === 'ready' || state.status === 'more') &&
          (state.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {space ? 'Nothing has changed in this space yet.' : 'Nothing has changed yet.'} Changes show here as soon as someone saves
              something, opens or closes a page, or adds a space.
            </p>
          ) : (
            <>
              <ActivityList items={state.items} />
              {state.next !== null && (
                <Button variant="outline" className="self-start" disabled={state.status === 'more'} onClick={more}>
                  {state.status === 'more' ? 'Loading…' : 'Show earlier'}
                </Button>
              )}
            </>
          ))}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { apiFetch } from 'miso'

import { historyPath, type ActivityItem, type ActivityPage } from '../lib/activity'
import { ActivityList } from '../ui/activity-list'

export const config = {
  title: 'Recent activity',
  icon: 'activity',
  rowSpan: 2,
  colSpan: 2
} as const

// The latest changes in the spaces the reader has access to. The Activity page has the full list.
export default function RecentActivity() {
  const [items, setItems] = useState<ActivityItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let stale = false
    apiFetch(historyPath({ limit: 12 }))
      .then(res => (res.ok ? (res.json() as Promise<ActivityPage>) : Promise.reject(new Error(String(res.status)))))
      .then(
        page => !stale && setItems(page.items),
        () => !stale && setFailed(true)
      )
    return () => {
      stale = true
    }
  }, [])

  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden bg-card p-3 text-card-foreground">
      <h2 className="truncate text-sm font-medium">Recent activity</h2>
      <div className="min-h-0 flex-1 overflow-hidden">
        {failed ? (
          <p className="text-sm text-muted-foreground">The activity could not be loaded.</p>
        ) : items === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing has changed yet.</p>
        ) : (
          <ActivityList items={items} compact />
        )}
      </div>
    </div>
  )
}

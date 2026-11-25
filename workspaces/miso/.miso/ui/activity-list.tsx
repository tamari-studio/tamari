import { IconFile, IconFolder, IconLayoutGrid, IconRobot } from '@tabler/icons-react'

import { groupByDay, sentence, timeAgo, type ActivityItem } from '../lib/activity'

const KIND_ICON = { record: IconFile, tab: IconLayoutGrid, space: IconFolder } as const

function Row({ item, compact }: { item: ActivityItem; compact?: boolean }) {
  const s = sentence(item)
  const Icon = item.actor.automatic ? IconRobot : KIND_ICON[item.kind]
  const time = timeAgo(item.at)
  return (
    <li className="flex gap-3 py-2.5">
      <Icon stroke={1.5} size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className={compact ? 'line-clamp-1 text-sm break-words' : 'text-sm break-words'}>
          <span className="font-medium">{s.who}</span> {s.did} <span className="font-medium">{s.what}</span>
          {s.where}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {item.collectionTitle && `${item.collectionTitle} · `}
          <time dateTime={item.at} title={new Date(item.at).toLocaleString('en-GB')}>
            {time}
          </time>
        </p>
      </div>
    </li>
  )
}

// The feed, grouped by day, newest first. `compact` (the widget) is one flat list that shows only
// the rows that fit: a row that doesn't fit wraps into a second column, which the clip hides.
export function ActivityList({ items, compact }: { items: ActivityItem[]; compact?: boolean }) {
  if (compact)
    return (
      <ul className="flex h-full flex-col flex-wrap content-start overflow-hidden [&>li]:w-full [&>li]:border-border [&>li+li]:border-t">
        {items.map(item => (
          <Row key={item.id} item={item} compact />
        ))}
      </ul>
    )
  return (
    <div className="flex flex-col gap-5">
      {groupByDay(items).map(day => (
        <section key={`${day.title}-${day.items[0].id}`} className="flex flex-col">
          <h2 className="text-xs font-medium text-muted-foreground">{day.title}</h2>
          <ul className="flex flex-col divide-y divide-border">
            {day.items.map(item => (
              <Row key={item.id} item={item} compact={compact} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// The activity feed in plain words: what GET /api/history returns (app/server/history.ts), turned
// into sentences, grouped by day. No React here, so it can be tested.

export type ActivityItem = {
  id: number
  at: string
  kind: 'record' | 'tab' | 'space'
  action: 'insert' | 'update' | 'delete'
  actor: { id: string | null; name: string | null; automatic: boolean }
  space: { id: string; name: string | null } | null
  title: string
  collection: string | null
  collectionTitle: string | null
  key: string
  version: number | null
  from: string | null
}

export type ActivityPage = {
  items: ActivityItem[]
  next: number | null
  spaces: { id: string; name: string }[]
}

// A sentence in parts, so the page can set the name and the thing in a stronger weight.
export type Sentence = { who: string; did: string; what: string; where: string }

export function who(item: ActivityItem): string {
  if (item.actor.automatic) return 'An automatic update'
  return item.actor.name ?? 'Someone'
}

const RECORD_VERB = { insert: 'added', update: 'changed', delete: 'removed' } as const

export function sentence(item: ActivityItem): Sentence {
  const space = item.space?.name ?? null
  const inSpace = space ? ` in ${space}` : ''
  if (item.kind === 'tab') {
    if (item.action === 'insert') return { who: who(item), did: 'opened the page', what: item.title, where: inSpace }
    if (item.action === 'delete') return { who: who(item), did: 'closed the page', what: item.title, where: inSpace }
    const moved = `${item.from ? ` from ${item.from}` : ''}${space ? ` to ${space}` : ''}`
    return { who: who(item), did: 'moved the page', what: item.title, where: moved }
  }
  if (item.kind === 'space') {
    if (item.action === 'insert') return { who: who(item), did: 'added the space', what: item.title, where: '' }
    if (item.action === 'delete') return { who: who(item), did: 'deleted the space', what: item.title, where: '' }
    return item.from
      ? { who: who(item), did: 'renamed the space', what: item.from, where: ` to ${item.title}` }
      : { who: who(item), did: 'renamed the space', what: item.title, where: '' }
  }
  return { who: who(item), did: RECORD_VERB[item.action], what: item.title, where: inSpace }
}

export function sentenceText(item: ActivityItem): string {
  const s = sentence(item)
  return `${s.who} ${s.did} ${s.what}${s.where}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`

// "Just now", "5 minutes ago", "2 hours ago" for today and last night; a clock time before that,
// where the day's heading already says which day.
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  const age = now.getTime() - then.getTime()
  if (Number.isNaN(age)) return ''
  if (age < MINUTE) return 'Just now'
  if (age < HOUR) return plural(Math.floor(age / MINUTE), 'minute')
  if (age < 24 * HOUR) return plural(Math.floor(age / HOUR), 'hour')
  return then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

// "Today", "Yesterday", "Monday 16 November", and the year when it isn't this one.
export function dayTitle(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (dayKey(then) === dayKey(now)) return 'Today'
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(then) === dayKey(yesterday)) return 'Yesterday'
  // Put together by hand: browsers disagree on the commas.
  const part = (options: Intl.DateTimeFormatOptions) => then.toLocaleDateString('en-GB', options)
  const year = then.getFullYear() === now.getFullYear() ? '' : ` ${then.getFullYear()}`
  return `${part({ weekday: 'long' })} ${then.getDate()} ${part({ month: 'long' })}${year}`
}

export type Day = { title: string; items: ActivityItem[] }

// Items arrive newest first; each day keeps that order.
export function groupByDay(items: ActivityItem[], now: Date = new Date()): Day[] {
  const days: Day[] = []
  let current = ''
  for (const item of items) {
    const key = dayKey(new Date(item.at))
    if (key !== current) {
      days.push({ title: dayTitle(item.at, now), items: [] })
      current = key
    }
    days[days.length - 1].items.push(item)
  }
  return days
}

export function historyPath(options: { space?: string | null; before?: number | null; limit?: number }): string {
  const query = new URLSearchParams()
  if (options.space) query.set('space', options.space)
  if (options.before != null) query.set('before', String(options.before))
  if (options.limit) query.set('limit', String(options.limit))
  const text = query.toString()
  return text ? `/api/history?${text}` : '/api/history'
}

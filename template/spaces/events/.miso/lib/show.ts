// The run of show: what one item of the plan holds, the check every row goes through, and what
// the page and the widget work out from the list (the order, what is late, what comes next).
// No data access here (that is show.server.ts).
import { day, fields, text, time, yesNo } from './check'

export type Item = {
  /** YYYY-MM-DD. */
  day: string
  /** When it starts, HH:MM. */
  start: string
  title: string
  /** The room, stage or spot. */
  place: string
  /** Who on the team makes it happen. */
  owner: string
  done: boolean
}

export function parseItem(input: unknown): Item {
  const raw = fields(input)
  return {
    day: day(raw.day, 'Day', { required: true }),
    start: time(raw.start, 'Start time'),
    title: text(raw.title, 'What happens', { required: true, max: 120 }),
    place: text(raw.place, 'Where', { max: 60 }),
    owner: text(raw.owner, 'Owner', { max: 60 }),
    done: yesNo(raw.done)
  }
}

/** A moment as the person's own day and clock: { day: '2026-03-04', time: '09:30' }. */
export type Moment = { day: string; time: string }

const at = (item: Pick<Item, 'day' | 'start'>) => `${item.day} ${item.start}`

/** In the order things happen. */
export function inOrder<T extends Item>(items: T[]): T[] {
  return [...items].sort((a, b) => at(a).localeCompare(at(b)) || a.title.localeCompare(b.title))
}

/** The items of each day, days and items in the order they happen. */
export function byDay<T extends Item>(items: T[]): { day: string; items: T[] }[] {
  const days: { day: string; items: T[] }[] = []
  for (const item of inOrder(items)) {
    const last = days[days.length - 1]
    if (last && last.day === item.day) last.items.push(item)
    else days.push({ day: item.day, items: [item] })
  }
  return days
}

/** Not ticked off and its start time has passed. */
export const isLate = (item: Pick<Item, 'day' | 'start' | 'done'>, now: Moment) => !item.done && at(item) < `${now.day} ${now.time}`

/** Everything not ticked off yet, in order: late items first, then what is coming. This is what the widget lists. */
export function upNext<T extends Item>(items: T[]): T[] {
  return inOrder(items).filter(item => !item.done)
}

export function summary(items: Item[], now: Moment): { done: number; late: number; left: number } {
  return { done: items.filter(i => i.done).length, late: items.filter(i => isLate(i, now)).length, left: items.filter(i => !i.done).length }
}

export function addDays(dayText: string, days: number): string {
  const date = new Date(`${dayText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** An invented one-day conference: the set-up yesterday (done) and the event day `today`. */
export function exampleItems(today: string): Item[] {
  const item = (day: string, start: string, title: string, place: string, owner: string, done = false): Item => ({ day, start, title, place, owner, done })
  const before = addDays(today, -1)
  return [
    item(before, '15:00', 'Stage, sound and screen check', 'Main hall', 'Emil', true),
    item(before, '17:00', 'Name badges sorted and at the door', 'Entrance', 'Sara', true),
    item(today, '07:30', 'Team meets, radios handed out', 'Entrance', 'Sara'),
    item(today, '08:00', 'Doors open, coffee is ready', 'Foyer', 'Sara'),
    item(today, '09:00', 'Welcome from the host', 'Main hall', 'Emil'),
    item(today, '09:15', 'Opening talk', 'Main hall', 'Emil'),
    item(today, '10:30', 'Coffee break, partner stands open', 'Foyer', 'Nora'),
    item(today, '12:00', 'Lunch', 'Restaurant', 'Nora'),
    item(today, '13:00', 'Workshops in three rooms', 'Rooms 1 to 3', 'Emil'),
    item(today, '16:30', 'Closing words, then drinks', 'Main hall', 'Sara')
  ]
}

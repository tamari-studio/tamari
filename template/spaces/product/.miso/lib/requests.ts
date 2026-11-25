// Requests and the roadmap: what a request holds, the check every row goes through, and how the
// page and the widget sort them (the inbox of new requests, then the roadmap by status).
// No data access here (that is requests.server.ts).
import { amount, choice, fields, longText, text } from './check'

export const STATUSES = ['new', 'planned', 'building', 'shipped', 'declined'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<Status, string> = { new: 'New', planned: 'Planned', building: 'In progress', shipped: 'Shipped', declined: 'Not now' }

/** The roadmap, in the order the page shows it: what is being built, what is next, what is out. */
export const ROADMAP: readonly Status[] = ['building', 'planned', 'shipped']

export const MAX_ASKED = 9999

export type Request = {
  /** What people ask for, in one line. */
  title: string
  /** Who asked first: a customer, a colleague, a team. */
  from: string
  /** The problem behind it, in their words. */
  detail: string
  status: Status
  /** How many people or customers have asked for it. */
  asked: number
}

export function parseRequest(input: unknown): Request {
  const raw = fields(input)
  return {
    title: text(raw.title, 'Request', { required: true, max: 120 }),
    from: text(raw.from, 'Who asked', { max: 80 }),
    detail: longText(raw.detail, 'The problem behind it', 600),
    status: choice(raw.status, 'Status', STATUSES),
    asked: amount(raw.asked, 'How many asked', { min: 1, max: MAX_ASKED, whole: true }) ?? 1
  }
}

const mostAsked = (a: Request, b: Request) => b.asked - a.asked || a.title.localeCompare(b.title)

/** New requests nobody has decided on yet, the most asked first. */
export function inbox<T extends Request>(requests: T[]): T[] {
  return requests.filter(r => r.status === 'new').sort(mostAsked)
}

/** The roadmap groups in order, each with its requests, the most asked first. */
export function roadmap<T extends Request>(requests: T[]): { status: Status; requests: T[] }[] {
  return ROADMAP.map(status => ({ status, requests: requests.filter(r => r.status === status).sort(mostAsked) }))
}

export function declined<T extends Request>(requests: T[]): T[] {
  return requests.filter(r => r.status === 'declined').sort(mostAsked)
}

/** The step a request usually takes next, with the words for its button. Null when it is out or put aside. */
export function nextStep(status: Status): { to: Status; label: string } | null {
  if (status === 'new') return { to: 'planned', label: 'Plan it' }
  if (status === 'planned') return { to: 'building', label: 'Start' }
  if (status === 'building') return { to: 'shipped', label: 'Mark as shipped' }
  return null
}

export function summary(requests: Request[]): Record<Status, number> {
  const counts: Record<Status, number> = { new: 0, planned: 0, building: 0, shipped: 0, declined: 0 }
  for (const request of requests) counts[request.status] += 1
  return counts
}

/** "3 people asked", "1 person asked". */
export function askedText(asked: number): string {
  return `${asked} ${asked === 1 ? 'person' : 'people'} asked`
}

/** Invented requests for an invented booking product, at least one in every status. */
export function exampleRequests(): Request[] {
  return [
    { title: 'Export bookings to a spreadsheet', from: 'Harbour Sauna', detail: 'Their bookkeeper types the bookings into a sheet by hand every Friday.', status: 'new', asked: 6 },
    { title: 'Text message reminders', from: 'Support', detail: 'Guests forget their booking. Three customers say every tenth guest does not show up.', status: 'new', asked: 4 },
    { title: 'Dark mode', from: 'A colleague', detail: '', status: 'new', asked: 1 },
    { title: 'Move a booking without cancelling it', from: 'City Padel', detail: 'Today they cancel and book again, and the guest gets two confusing emails.', status: 'building', asked: 9 },
    { title: 'Gift cards', from: 'Sales', detail: 'Asked for in most first calls before December.', status: 'planned', asked: 5 },
    { title: 'Waiting list for full time slots', from: 'Harbour Sauna', detail: 'They keep the list on paper next to the till.', status: 'shipped', asked: 7 },
    { title: 'Our own app in the app stores', from: 'City Padel', detail: 'The booking page works in the phone browser. An app would cost more than it brings in.', status: 'declined', asked: 2 }
  ]
}

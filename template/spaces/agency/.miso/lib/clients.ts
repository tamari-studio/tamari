// The client list: what a client row holds, the check every row goes through, and the small
// sums the page and the widget show. No data access here (that is clients.server.ts).
import { choice, day, fields, text } from './check'

export const STATUSES = ['lead', 'active', 'paused', 'done'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<Status, string> = { lead: 'Lead', active: 'Active', paused: 'On hold', done: 'Finished' }

export type Client = {
  name: string
  /** The person at the client you talk to. */
  contact: string
  /** Who on your team looks after this client. */
  owner: string
  status: Status
  nextStep: string
  /** The day the next step is due, YYYY-MM-DD, or ''. */
  nextDate: string
}

export function parseClient(input: unknown): Client {
  const raw = fields(input)
  return {
    name: text(raw.name, 'Client name', { required: true, max: 80 }),
    contact: text(raw.contact, 'Contact', { max: 80 }),
    owner: text(raw.owner, 'Owner', { max: 60 }),
    status: choice(raw.status, 'Status', STATUSES),
    nextStep: text(raw.nextStep, 'Next step', { max: 160 }),
    nextDate: day(raw.nextDate, 'Due date')
  }
}

/** Leads and active clients are the ones with work to do. */
export const isOpen = (client: Pick<Client, 'status'>) => client.status === 'lead' || client.status === 'active'

export const isOverdue = (client: Pick<Client, 'status' | 'nextDate'>, today: string) => isOpen(client) && client.nextDate !== '' && client.nextDate < today

/** Open clients first, then by due date (rows without a date last), then by name. */
export function sortClients<T extends Client>(clients: T[]): T[] {
  const rank = (c: Client) => STATUSES.indexOf(c.status)
  return [...clients].sort((a, b) => rank(a) - rank(b) || (a.nextDate || '9999').localeCompare(b.nextDate || '9999') || a.name.localeCompare(b.name))
}

/** Open clients that have a next step, the soonest first. This is what the widget lists. */
export function nextSteps<T extends Client>(clients: T[]): T[] {
  return clients
    .filter(c => isOpen(c) && c.nextStep !== '')
    .sort((a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999') || a.name.localeCompare(b.name))
}

export function summary(clients: Client[], today: string): { active: number; leads: number; overdue: number } {
  return {
    active: clients.filter(c => c.status === 'active').length,
    leads: clients.filter(c => c.status === 'lead').length,
    overdue: clients.filter(c => isOverdue(c, today)).length
  }
}

export function addDays(dayText: string, days: number): string {
  const date = new Date(`${dayText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Invented clients, with dates around `today` so one step is overdue and the rest are coming up. */
export function exampleClients(today: string): Client[] {
  return [
    { name: 'Northside Dental', contact: 'Practice manager', owner: 'Maja', status: 'lead', nextStep: 'Call back about the website quote', nextDate: addDays(today, -1) },
    { name: 'Harbour Hotel', contact: 'Head of marketing', owner: 'Jonas', status: 'active', nextStep: 'Send the spring campaign plan', nextDate: addDays(today, 2) },
    { name: 'City Bike Rental', contact: 'Shop manager', owner: 'Maja', status: 'active', nextStep: 'Monthly report', nextDate: addDays(today, 9) },
    { name: 'Green Roof Builders', contact: 'Office lead', owner: 'Jonas', status: 'paused', nextStep: 'Check in after their busy season', nextDate: addDays(today, 30) },
    { name: 'Old Town Bakery', contact: 'Founder', owner: 'Maja', status: 'done', nextStep: '', nextDate: '' }
  ]
}

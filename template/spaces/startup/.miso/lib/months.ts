// The monthly update: the numbers and notes of one month, the check every row goes through, what
// is worked out from two months (growth, how long the cash lasts), and the text of the update a
// founder sends to investors. No data access here (that is months.server.ts).
import { amount, fields, longText, month, yesNo } from './check'

export type Month = {
  /** YYYY-MM. One row per month. */
  month: string
  /** Revenue that comes back every month. */
  revenue: number
  customers: number
  /** Cash in the bank at the end of the month. */
  cash: number
  /** Everything spent in the month. */
  spend: number
  wentWell: string
  wentBadly: string
  /** Where investors can help. */
  asks: string
  /** The update for this month has gone out. */
  sent: boolean
}

export function parseMonth(input: unknown): Month {
  const raw = fields(input)
  return {
    month: month(raw.month, 'Month'),
    revenue: amount(raw.revenue, 'Monthly revenue', { required: true })!,
    customers: amount(raw.customers, 'Customers', { required: true, whole: true, max: 100_000_000 })!,
    cash: amount(raw.cash, 'Cash in the bank', { required: true })!,
    spend: amount(raw.spend, 'Spent this month', { required: true })!,
    wentWell: longText(raw.wentWell, 'What went well', 1000),
    wentBadly: longText(raw.wentBadly, 'What did not go well', 1000),
    asks: longText(raw.asks, 'Where investors can help', 1000),
    sent: yesNo(raw.sent)
  }
}

/** Newest month first. */
export function newestFirst<T extends Month>(months: T[]): T[] {
  return [...months].sort((a, b) => b.month.localeCompare(a.month))
}

/** The newest row before `row`, which may be more than one month back. */
export function monthBefore<T extends Month>(months: T[], row: Month): T | undefined {
  return newestFirst(months).find(m => m.month < row.month)
}

/** Change from `before` to `now` in percent, or null when there is nothing to compare with. */
export function growth(now: number, before: number | undefined): number | null {
  if (before === undefined || before <= 0) return null
  return ((now - before) / before) * 100
}

/**
 * How many months the cash lasts when the month repeats: cash divided by what the month cost
 * after revenue. `'earning'` when revenue covers the spend.
 */
export function monthsOfCash(row: Pick<Month, 'cash' | 'spend' | 'revenue'>): number | 'earning' {
  const cost = row.spend - row.revenue
  return cost <= 0 ? 'earning' : row.cash / cost
}

export function cashText(row: Pick<Month, 'cash' | 'spend' | 'revenue'>): string {
  const left = monthsOfCash(row)
  if (left === 'earning') return 'Revenue covers the spend'
  if (left < 1) return 'Less than 1 month of cash'
  const rounded = Math.floor(left)
  return `${rounded} ${rounded === 1 ? 'month' : 'months'} of cash`
}

export function percent(value: number | null): string {
  if (value === null) return ''
  const rounded = Math.round(value)
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

export function monthLabel(value: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-15T00:00:00Z`))
}

const number = (n: number, locale?: string) => Math.round(n).toLocaleString(locale)

/** The update as plain text, ready to paste into an email. `before` adds the change since that month. */
export function updateText(row: Month, before?: Month, locale?: string): string {
  const change = before ? percent(growth(row.revenue, before.revenue)) : ''
  const more = before ? row.customers - before.customers : 0
  const lines = [
    `Update for ${monthLabel(row.month, locale)}`,
    '',
    'Numbers',
    `- Monthly revenue: ${number(row.revenue, locale)}${change ? ` (${change} since ${monthLabel(before!.month, locale)})` : ''}`,
    `- Customers: ${number(row.customers, locale)}${more !== 0 ? ` (${more > 0 ? '+' : ''}${more})` : ''}`,
    `- Cash in the bank: ${number(row.cash, locale)}`,
    `- Spent this month: ${number(row.spend, locale)}`,
    `- ${cashText(row)} at this pace`
  ]
  const part = (title: string, body: string) => (body ? ['', title, body] : [])
  return [...lines, ...part('What went well', row.wentWell), ...part('What did not go well', row.wentBadly), ...part('Where you can help', row.asks)].join('\n')
}

export function addMonths(value: string, months: number): string {
  const date = new Date(`${value}-15T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 7)
}

/** Three invented months that end with the month before `today`: the last one is not sent yet. */
export function exampleMonths(today: string): Month[] {
  const last = addMonths(today.slice(0, 7), -1)
  return [
    { month: addMonths(last, -2), revenue: 31000, customers: 22, cash: 690000, spend: 118000, wentWell: 'Two pilot customers signed a yearly plan.', wentBadly: 'The new onboarding took three weeks longer than planned.', asks: 'Introductions to operations leads at logistics firms.', sent: true },
    { month: addMonths(last, -1), revenue: 36000, customers: 26, cash: 605000, spend: 121000, wentWell: 'Onboarding is live: new customers are set up in two days, not ten.', wentBadly: 'One customer left. They wanted an invoicing feature we do not plan to build.', asks: 'A second opinion on our pricing page.', sent: true },
    { month: last, revenue: 42000, customers: 31, cash: 524000, spend: 123000, wentWell: 'Best month so far: five new customers, three of them from referrals.', wentBadly: 'Hiring a second engineer is slow. Two candidates said no.', asks: 'Know a backend engineer who wants to join a team of six? Send them our way.', sent: false }
  ]
}

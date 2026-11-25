// The pipeline: what a deal holds, the check every row goes through, and the sums the board and
// the widget show. No data access here (that is deals.server.ts).
import { amount, choice, day, fields, text } from './check'

export const STAGES = ['new', 'talking', 'offer', 'won', 'lost'] as const
export type Stage = (typeof STAGES)[number]

export const STAGE_LABEL: Record<Stage, string> = { new: 'New', talking: 'Talking', offer: 'Offer sent', won: 'Won', lost: 'Lost' }

/** The stages a deal is still open in, in the order it moves through them. */
export const OPEN: readonly Stage[] = ['new', 'talking', 'offer']

export type Deal = {
  /** The company the deal is with. */
  company: string
  /** What they would buy, in a few words. */
  what: string
  stage: Stage
  /** What the deal is worth, or null when not known yet. */
  value: number | null
  /** Who on your team runs the deal. */
  owner: string
  nextStep: string
  /** The day the next step is due, YYYY-MM-DD, or ''. */
  nextDate: string
}

export function parseDeal(input: unknown): Deal {
  const raw = fields(input)
  return {
    company: text(raw.company, 'Company', { required: true, max: 80 }),
    what: text(raw.what, 'What they would buy', { max: 120 }),
    stage: choice(raw.stage, 'Stage', STAGES),
    value: amount(raw.value, 'Value'),
    owner: text(raw.owner, 'Owner', { max: 60 }),
    nextStep: text(raw.nextStep, 'Next step', { max: 160 }),
    nextDate: day(raw.nextDate, 'Due date')
  }
}

export const isOpen = (deal: Pick<Deal, 'stage'>) => OPEN.includes(deal.stage)

export const isOverdue = (deal: Pick<Deal, 'stage' | 'nextDate'>, today: string) => isOpen(deal) && deal.nextDate !== '' && deal.nextDate < today

/** The stage after this one, or null for a deal that is won or lost. A sent offer moves on to won. */
export function nextStage(stage: Stage): Stage | null {
  const index = OPEN.indexOf(stage)
  if (index < 0) return null
  return OPEN[index + 1] ?? 'won'
}

const worth = (deals: Deal[]) => deals.reduce((sum, deal) => sum + (deal.value ?? 0), 0)

/** The deals of each stage: the soonest next step first, then the biggest deal. */
export function byStage<T extends Deal>(deals: T[]): { stage: Stage; deals: T[]; value: number }[] {
  return STAGES.map(stage => {
    const inStage = deals.filter(d => d.stage === stage).sort((a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999') || (b.value ?? 0) - (a.value ?? 0) || a.company.localeCompare(b.company))
    return { stage, deals: inStage, value: worth(inStage) }
  })
}

export function summary(deals: Deal[], today: string): { open: number; openValue: number; wonValue: number; overdue: number } {
  const open = deals.filter(isOpen)
  return { open: open.length, openValue: worth(open), wonValue: worth(deals.filter(d => d.stage === 'won')), overdue: deals.filter(d => isOverdue(d, today)).length }
}

export function addDays(dayText: string, days: number): string {
  const date = new Date(`${dayText}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Invented deals, at least one in every stage, with dates around `today` so one step is overdue. */
export function exampleDeals(today: string): Deal[] {
  return [
    { company: 'Fjord Ferries', what: 'Yearly plan, 40 people', stage: 'new', value: null, owner: 'Ida', nextStep: 'Reply to their form and book a call', nextDate: addDays(today, 1) },
    { company: 'Nordlys Clinics', what: 'Pilot for two clinics', stage: 'talking', value: 60000, owner: 'Ida', nextStep: 'Demo for the head of operations', nextDate: addDays(today, -2) },
    { company: 'Birch & Co', what: 'Yearly plan, 15 people', stage: 'talking', value: 45000, owner: 'Oskar', nextStep: 'Send answers to their security questions', nextDate: addDays(today, 3) },
    { company: 'Kystbyg', what: 'Yearly plan, 80 people', stage: 'offer', value: 180000, owner: 'Oskar', nextStep: 'Call about the offer', nextDate: addDays(today, 5) },
    { company: 'Lindholm Schools', what: 'Three schools, one year', stage: 'won', value: 95000, owner: 'Ida', nextStep: '', nextDate: '' },
    { company: 'Vesterport Hotel', what: 'Pilot for the front desk', stage: 'lost', value: 30000, owner: 'Oskar', nextStep: '', nextDate: '' }
  ]
}

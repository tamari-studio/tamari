// Server functions for the monthly update. Rows live in the shared-records collection
// `startup-months` (no table of its own). Every argument comes from the browser, so each one is
// checked in lib/check.ts or lib/months.ts before anything is saved.
import { requireCaller } from '@miso/caller'
import { collection } from '@miso/store'
import { day, yesNo } from './check'
import { exampleMonths, monthLabel, parseMonth, type Month } from './months'
import { rows, type Saved } from './rows'

const months = () =>
  rows(collection<Month>('startup-months'), {
    parse: parseMonth,
    examples: exampleMonths,
    unique: { of: row => row.month, taken: row => `There is already a row for ${monthLabel(row.month, 'en')}. Edit that one.` }
  })

export async function listMonths(): Promise<Saved<Month>[]> {
  requireCaller()
  return months().list()
}

/** Saves a new month, or the month with `input.key` again. */
export async function saveMonth(input: unknown): Promise<Saved<Month>> {
  requireCaller()
  return months().save(input)
}

/** Marks the update of one month as sent, or as not sent. */
export async function markSent(key: unknown, sent: unknown): Promise<Saved<Month>> {
  requireCaller()
  const value = yesNo(sent)
  return months().update(key, row => ({ ...row, sent: value }))
}

export async function removeMonth(key: unknown): Promise<void> {
  requireCaller()
  await months().remove(key)
}

/** `today` is the person's own day (YYYY-MM-DD), so the examples end with last month. */
export async function loadExampleMonths(today: unknown): Promise<number> {
  requireCaller()
  return months().loadExamples(day(today, 'Today', { required: true }))
}

export async function removeExampleMonths(): Promise<number> {
  requireCaller()
  return months().removeExamples()
}

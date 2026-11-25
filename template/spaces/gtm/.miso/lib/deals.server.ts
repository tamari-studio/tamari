// Server functions for the pipeline. Rows live in the shared-records collection `gtm-deals` (no
// table of its own). Every argument comes from the browser, so each one is checked in
// lib/check.ts or lib/deals.ts before anything is saved.
import { requireCaller } from '@miso/caller'
import { collection } from '@miso/store'
import { choice, day } from './check'
import { STAGES, exampleDeals, parseDeal, type Deal } from './deals'
import { rows, type Saved } from './rows'

const deals = () => rows(collection<Deal>('gtm-deals'), { parse: parseDeal, examples: exampleDeals })

export async function listDeals(): Promise<Saved<Deal>[]> {
  requireCaller()
  return deals().list()
}

/** Saves a new deal, or the deal with `input.key` again. */
export async function saveDeal(input: unknown): Promise<Saved<Deal>> {
  requireCaller()
  return deals().save(input)
}

/** Moves one deal to another stage. */
export async function moveDeal(key: unknown, stage: unknown): Promise<Saved<Deal>> {
  requireCaller()
  const to = choice(stage, 'Stage', STAGES)
  return deals().update(key, row => ({ ...row, stage: to }))
}

export async function removeDeal(key: unknown): Promise<void> {
  requireCaller()
  await deals().remove(key)
}

/** `today` is the person's own day (YYYY-MM-DD), so the example dates sit around it. */
export async function loadExampleDeals(today: unknown): Promise<number> {
  requireCaller()
  return deals().loadExamples(day(today, 'Today', { required: true }))
}

export async function removeExampleDeals(): Promise<number> {
  requireCaller()
  return deals().removeExamples()
}

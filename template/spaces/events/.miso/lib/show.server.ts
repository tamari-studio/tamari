// Server functions for the run of show. Rows live in the shared-records collection
// `events-run-of-show` (no table of its own). Every argument comes from the browser, so each one
// is checked in lib/check.ts or lib/show.ts before anything is saved.
import { requireCaller } from '@miso/caller'
import { collection } from '@miso/store'
import { day, yesNo } from './check'
import { exampleItems, parseItem, type Item } from './show'
import { rows, type Saved } from './rows'

const items = () => rows(collection<Item>('events-run-of-show'), { parse: parseItem, examples: exampleItems })

export async function listItems(): Promise<Saved<Item>[]> {
  requireCaller()
  return items().list()
}

/** Saves a new item, or the item with `input.key` again. */
export async function saveItem(input: unknown): Promise<Saved<Item>> {
  requireCaller()
  return items().save(input)
}

/** Ticks one item off, or puts it back. */
export async function markDone(key: unknown, done: unknown): Promise<Saved<Item>> {
  requireCaller()
  const value = yesNo(done)
  return items().update(key, row => ({ ...row, done: value }))
}

export async function removeItem(key: unknown): Promise<void> {
  requireCaller()
  await items().remove(key)
}

/** `today` is the person's own day (YYYY-MM-DD): the example event is on that day. */
export async function loadExampleItems(today: unknown): Promise<number> {
  requireCaller()
  return items().loadExamples(day(today, 'Today', { required: true }))
}

export async function removeExampleItems(): Promise<number> {
  requireCaller()
  return items().removeExamples()
}

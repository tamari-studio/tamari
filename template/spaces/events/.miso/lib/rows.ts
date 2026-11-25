// One list of rows in a shared-records collection (`@miso/store`): read, save, remove, and the
// example rows a new team can load and remove again. The server file hands in the collection, so
// this file has no secrets and tests run it against a list in memory.
//
// - Rows are checked when they are saved and again when they are read. A row that does not pass
//   (another space wrote it, or the fields changed) is left out instead of breaking the page.
// - Example rows have a key that starts with `example-`. They stay examples when someone edits
//   them, so "Remove examples" also removes edited ones. The page says so.
// - A store error is logged on the server and the person gets a plain sentence.
//
// This file is the same in every starter template (cli/template.test.ts checks that).
import { fields, rowKey } from './check'

export type Store<T> = {
  list(options?: { limit?: number }): Promise<{ key: string; data: T }[]>
  put(key: string, data: T): Promise<unknown>
  putMany(entries: { key: string; data: T }[]): Promise<number>
  remove(key: string): Promise<void>
}

export type Saved<T> = T & { key: string; example: boolean }

export const EXAMPLE = 'example-'
export const MAX_ROWS = 500

const isExample = (key: string) => key.startsWith(EXAMPLE)

async function plain<R>(doing: string, work: () => Promise<R>): Promise<R> {
  try {
    return await work()
  } catch (err) {
    console.error(`[starter template] ${doing}:`, err)
    throw new Error(`Could not ${doing}. Try again; if it keeps happening, tell an admin.`)
  }
}

export type Options<T> = {
  /** Checks a row and returns only its known fields. Throws a sentence the person can act on. */
  parse: (input: unknown) => T
  examples: (today: string) => T[]
  /** For a list where two rows must not be about the same thing (one row per month, say). */
  unique?: { of: (row: T) => string; taken: (row: T) => string }
}

export function rows<T extends object>(store: Store<T>, options: Options<T>) {
  const { parse, examples, unique } = options
  const saved = (key: string, data: T): Saved<T> => ({ ...data, key, example: isExample(key) })

  async function list(): Promise<Saved<T>[]> {
    const stored = await plain('load the list', () => store.list({ limit: MAX_ROWS }))
    return stored.flatMap(row => {
      try {
        return [saved(row.key, parse(row.data))]
      } catch {
        return []
      }
    })
  }

  return {
    list,

    /** Saves a new row, or the row with `input.key` again. */
    async save(input: unknown): Promise<Saved<T>> {
      const raw = fields(input)
      const data = parse(raw)
      const isNew = raw.key === undefined || raw.key === null || raw.key === ''
      const key = isNew ? `r-${crypto.randomUUID()}` : rowKey(raw.key)
      if (isNew || unique) {
        const all = await list()
        if (isNew && all.length >= MAX_ROWS) throw new Error(`This list is full (${MAX_ROWS} rows). Remove some rows first.`)
        if (unique && all.some(row => row.key !== key && unique.of(row) === unique.of(data))) throw new Error(unique.taken(data))
      }
      await plain('save that', () => store.put(key, data))
      return saved(key, data)
    },

    /** Changes one saved row on the server, so a small action (tick a box, move a card) sends only what changes. */
    async update(key: unknown, change: (row: T) => T): Promise<Saved<T>> {
      const clean = rowKey(key)
      const row = (await list()).find(r => r.key === clean)
      if (!row) throw new Error('That row is gone. Someone may have removed it. Reload the page.')
      const data = parse(change(row))
      await plain('save that', () => store.put(clean, data))
      return saved(clean, data)
    },

    async remove(key: unknown): Promise<void> {
      const clean = rowKey(key)
      await plain('remove that', () => store.remove(clean))
    },

    /** Adds the example rows. Loading twice writes the same keys again, so nothing doubles. */
    async loadExamples(today: string): Promise<number> {
      const entries = examples(today).map((data, i) => ({ key: `${EXAMPLE}${i + 1}`, data: parse(data) }))
      await plain('add the examples', () => store.putMany(entries))
      return entries.length
    },

    async removeExamples(): Promise<number> {
      const keys = (await plain('load the list', () => store.list({ limit: MAX_ROWS }))).map(row => row.key).filter(isExample)
      await plain('remove the examples', async () => {
        for (const key of keys) await store.remove(key)
      })
      return keys.length
    }
  }
}

/** A list in memory with the same methods as a collection, for tests. */
export function memoryStore<T>(): Store<T> & { data: Map<string, T> } {
  const data = new Map<string, T>()
  return {
    data,
    async list() {
      return [...data].map(([key, value]) => ({ key, data: value }))
    },
    async put(key, value) {
      data.set(key, value)
    },
    async putMany(entries) {
      for (const entry of entries) data.set(entry.key, entry.data)
      return entries.length
    },
    async remove(key) {
      data.delete(key)
    }
  }
}

// Server functions for the client list. Rows live in the shared-records collection
// `agency-clients` (no table of its own). Every argument comes from the browser, so each one is
// checked in lib/check.ts or lib/clients.ts before anything is saved.
import { requireCaller } from '@miso/caller'
import { collection } from '@miso/store'
import { day } from './check'
import { exampleClients, parseClient, type Client } from './clients'
import { rows, type Saved } from './rows'

const clients = () => rows(collection<Client>('agency-clients'), { parse: parseClient, examples: exampleClients })

export async function listClients(): Promise<Saved<Client>[]> {
  requireCaller()
  return clients().list()
}

/** Saves a new client, or the client with `input.key` again. */
export async function saveClient(input: unknown): Promise<Saved<Client>> {
  requireCaller()
  return clients().save(input)
}

export async function removeClient(key: unknown): Promise<void> {
  requireCaller()
  await clients().remove(key)
}

/** `today` is the person's own day (YYYY-MM-DD), so the example dates sit around it. */
export async function loadExampleClients(today: unknown): Promise<number> {
  requireCaller()
  return clients().loadExamples(day(today, 'Today', { required: true }))
}

export async function removeExampleClients(): Promise<number> {
  requireCaller()
  return clients().removeExamples()
}

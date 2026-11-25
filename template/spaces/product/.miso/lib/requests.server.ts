// Server functions for requests and the roadmap. Rows live in the shared-records collection
// `product-requests` (no table of its own). Every argument comes from the browser, so each one is
// checked in lib/check.ts or lib/requests.ts before anything is saved.
import { requireCaller } from '@miso/caller'
import { collection } from '@miso/store'
import { choice } from './check'
import { MAX_ASKED, STATUSES, exampleRequests, parseRequest, type Request } from './requests'
import { rows, type Saved } from './rows'

const requests = () => rows(collection<Request>('product-requests'), { parse: parseRequest, examples: exampleRequests })

export async function listRequests(): Promise<Saved<Request>[]> {
  requireCaller()
  return requests().list()
}

/** Saves a new request, or the request with `input.key` again. */
export async function saveRequest(input: unknown): Promise<Saved<Request>> {
  requireCaller()
  return requests().save(input)
}

/** Moves one request to another status: onto the roadmap, along it, or aside. */
export async function setStatus(key: unknown, status: unknown): Promise<Saved<Request>> {
  requireCaller()
  const to = choice(status, 'Status', STATUSES)
  return requests().update(key, row => ({ ...row, status: to }))
}

/** One more person asked for it. The count is read on the server, not sent by the browser. Two people adding in the same instant can still count as one. */
export async function addAsk(key: unknown): Promise<Saved<Request>> {
  requireCaller()
  return requests().update(key, row => ({ ...row, asked: Math.min(row.asked + 1, MAX_ASKED) }))
}

export async function removeRequest(key: unknown): Promise<void> {
  requireCaller()
  await requests().remove(key)
}

export async function loadExampleRequests(): Promise<number> {
  requireCaller()
  return requests().loadExamples('')
}

export async function removeExampleRequests(): Promise<number> {
  requireCaller()
  return requests().removeExamples()
}

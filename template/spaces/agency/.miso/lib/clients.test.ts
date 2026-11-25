import { afterEach, expect, test } from 'bun:test'

import { addDays, exampleClients, isOverdue, nextSteps, parseClient, sortClients, summary, type Client } from './clients'
import { listClients, loadExampleClients, removeClient, saveClient } from './clients.server'

const client = (patch: Partial<Client>): Client => ({ name: 'A', contact: '', owner: '', status: 'active', nextStep: '', nextDate: '', ...patch })
const TODAY = '2026-03-04'

test('parseClient keeps the known fields, cleaned', () => {
  expect(parseClient({ name: ' Harbour  Hotel ', status: 'active', nextStep: 'Send plan', nextDate: '2026-03-06', key: 'r-1', extra: 'x' })).toEqual({
    name: 'Harbour Hotel',
    contact: '',
    owner: '',
    status: 'active',
    nextStep: 'Send plan',
    nextDate: '2026-03-06'
  })
})

test('parseClient refuses a missing name, an unknown status and a bad date', () => {
  expect(() => parseClient({ status: 'active' })).toThrow('Client name is needed.')
  expect(() => parseClient({ name: 'A', status: 'won' })).toThrow('Status must be one of')
  expect(() => parseClient({ name: 'A', status: 'lead', nextDate: 'tomorrow' })).toThrow('Due date must be a date.')
  expect(() => parseClient({ name: 'x'.repeat(81), status: 'lead' })).toThrow('too long')
})

test('a step is overdue only for leads and active clients with a past date', () => {
  expect(isOverdue(client({ nextDate: '2026-03-03' }), TODAY)).toBe(true)
  expect(isOverdue(client({ nextDate: TODAY }), TODAY)).toBe(false)
  expect(isOverdue(client({ nextDate: '2026-03-03', status: 'paused' }), TODAY)).toBe(false)
  expect(isOverdue(client({}), TODAY)).toBe(false)
})

test('sortClients puts open clients first, then the soonest date', () => {
  const sorted = sortClients([client({ name: 'Done', status: 'done' }), client({ name: 'Later', nextDate: '2026-04-01' }), client({ name: 'No date' }), client({ name: 'Lead', status: 'lead' }), client({ name: 'Soon', nextDate: '2026-03-05' })])
  expect(sorted.map(c => c.name)).toEqual(['Lead', 'Soon', 'Later', 'No date', 'Done'])
})

test('nextSteps lists open clients that have a step, soonest first', () => {
  const list = [client({ name: 'B', nextStep: 'Call', nextDate: '2026-03-09' }), client({ name: 'A', nextStep: 'Mail' }), client({ name: 'C', nextStep: 'Quote', nextDate: '2026-03-03', status: 'lead' }), client({ name: 'D', nextStep: 'Wait', status: 'paused' }), client({ name: 'E' })]
  expect(nextSteps(list).map(c => c.name)).toEqual(['C', 'B', 'A'])
})

test('the examples pass the check and show every state once', () => {
  const examples = exampleClients(TODAY)
  expect(examples.map(parseClient)).toEqual(examples)
  expect(summary(examples, TODAY)).toEqual({ active: 2, leads: 1, overdue: 1 })
  expect(new Set(examples.map(c => c.status)).size).toBe(4)
  expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
})

// The server functions: nobody signed in, nothing happens; a bad argument stops before the store.
const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})
const signIn = () => {
  process.env.MISO_CALLER_EMAIL = 'a@example.com'
  process.env.MISO_CALLER_ID = 'u1'
}

test('every server function needs a signed-in member', async () => {
  delete process.env.MISO_CALLER_EMAIL
  delete process.env.MISO_CALLER_ID
  await expect(listClients()).rejects.toThrow('signed-in member')
  await expect(saveClient({ name: 'A', status: 'lead' })).rejects.toThrow('signed-in member')
  await expect(removeClient('r-1')).rejects.toThrow('signed-in member')
})

test('server functions refuse bad arguments', async () => {
  signIn()
  await expect(saveClient({ name: '', status: 'lead' })).rejects.toThrow('Client name is needed.')
  await expect(saveClient(null)).rejects.toThrow('could not be read')
  await expect(removeClient('../x')).rejects.toThrow('could not be found')
  await expect(loadExampleClients('yesterday')).rejects.toThrow('Today must be a date.')
})

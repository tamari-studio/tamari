import { afterEach, expect, test } from 'bun:test'

import { STATUSES, askedText, declined, exampleRequests, inbox, nextStep, parseRequest, roadmap, summary, type Request } from './requests'
import { addAsk, listRequests, removeRequest, saveRequest, setStatus } from './requests.server'

const request = (patch: Partial<Request>): Request => ({ title: 'A', from: '', detail: '', status: 'new', asked: 1, ...patch })

test('parseRequest keeps the known fields, cleaned, and counts one person when left out', () => {
  expect(parseRequest({ title: ' Export  bookings ', from: 'Support', detail: ' By hand \r\nevery Friday ', status: 'new', key: 'r-1', extra: 'x' })).toEqual({
    title: 'Export bookings',
    from: 'Support',
    detail: 'By hand \nevery Friday',
    status: 'new',
    asked: 1
  })
  expect(parseRequest({ ...request({}), asked: '12' }).asked).toBe(12)
})

test('parseRequest refuses a missing title, an unknown status and a count that is not a whole number from 1', () => {
  expect(() => parseRequest(request({ title: '' }))).toThrow('Request is needed.')
  expect(() => parseRequest({ ...request({}), status: 'later' })).toThrow('Status must be one of')
  expect(() => parseRequest(request({ asked: 0 }))).toThrow('How many asked must be from 1 to 9999.')
  expect(() => parseRequest(request({ asked: 1.5 }))).toThrow('How many asked must be a whole number.')
  expect(() => parseRequest({ ...request({}), asked: 'many' })).toThrow('How many asked must be a number.')
  expect(() => parseRequest(request({ detail: 'x'.repeat(601) }))).toThrow('too long')
})

test('the inbox has the new requests, the most asked first', () => {
  const list = [request({ title: 'B', asked: 2 }), request({ title: 'C', asked: 5 }), request({ title: 'A', asked: 2 }), request({ title: 'D', status: 'planned', asked: 9 })]
  expect(inbox(list).map(r => r.title)).toEqual(['C', 'A', 'B'])
})

test('the roadmap shows what is in progress, then planned, then shipped', () => {
  const list = [request({ title: 'Out', status: 'shipped' }), request({ title: 'Next', status: 'planned' }), request({ title: 'Now', status: 'building' }), request({ title: 'New' }), request({ title: 'No', status: 'declined' })]
  expect(roadmap(list).map(g => [g.status, g.requests.map(r => r.title)])).toEqual([
    ['building', ['Now']],
    ['planned', ['Next']],
    ['shipped', ['Out']]
  ])
  expect(declined(list).map(r => r.title)).toEqual(['No'])
  expect(summary(list)).toEqual({ new: 1, planned: 1, building: 1, shipped: 1, declined: 1 })
})

test('a request goes from new to planned to in progress to shipped, and stops there', () => {
  expect(STATUSES.map(status => nextStep(status)?.to ?? null)).toEqual(['planned', 'building', 'shipped', null, null])
  expect(nextStep('new')?.label).toBe('Plan it')
})

test('askedText counts people', () => {
  expect(askedText(1)).toBe('1 person asked')
  expect(askedText(4)).toBe('4 people asked')
})

test('the examples pass the check and show every status', () => {
  const examples = exampleRequests()
  expect(examples.map(parseRequest)).toEqual(examples)
  expect(Object.values(summary(examples)).every(count => count >= 1)).toBe(true)
  expect(inbox(examples)[0]!.title).toBe('Export bookings to a spreadsheet')
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
  await expect(listRequests()).rejects.toThrow('signed-in member')
  await expect(saveRequest(request({}))).rejects.toThrow('signed-in member')
  await expect(setStatus('r-1', 'planned')).rejects.toThrow('signed-in member')
  await expect(addAsk('r-1')).rejects.toThrow('signed-in member')
  await expect(removeRequest('r-1')).rejects.toThrow('signed-in member')
})

test('server functions refuse bad arguments', async () => {
  signIn()
  await expect(saveRequest(request({ title: '' }))).rejects.toThrow('Request is needed.')
  await expect(saveRequest('x')).rejects.toThrow('could not be read')
  await expect(setStatus('r-1', 'later')).rejects.toThrow('Status must be one of')
  await expect(setStatus('../x', 'planned')).rejects.toThrow('could not be found')
  await expect(addAsk('../x')).rejects.toThrow('could not be found')
  await expect(removeRequest(null)).rejects.toThrow('could not be found')
})

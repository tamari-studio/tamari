import { afterEach, expect, test } from 'bun:test'

import { STAGES, addDays, byStage, exampleDeals, isOverdue, nextStage, parseDeal, summary, type Deal } from './deals'
import { listDeals, loadExampleDeals, moveDeal, removeDeal, saveDeal } from './deals.server'

const deal = (patch: Partial<Deal>): Deal => ({ company: 'A', what: '', stage: 'talking', value: null, owner: '', nextStep: '', nextDate: '', ...patch })
const TODAY = '2026-03-04'

test('parseDeal keeps the known fields, cleaned, and reads a value typed in a form', () => {
  expect(parseDeal({ company: ' Birch  & Co ', stage: 'offer', value: '45000', nextDate: '2026-03-06', key: 'r-1', extra: 'x' })).toEqual({
    company: 'Birch & Co',
    what: '',
    stage: 'offer',
    value: 45000,
    owner: '',
    nextStep: '',
    nextDate: '2026-03-06'
  })
  expect(parseDeal(deal({})).value).toBeNull()
  expect(parseDeal({ ...deal({}), value: '' }).value).toBeNull()
})

test('parseDeal refuses a missing company, an unknown stage, a bad value and a bad date', () => {
  expect(() => parseDeal(deal({ company: '' }))).toThrow('Company is needed.')
  expect(() => parseDeal({ ...deal({}), stage: 'maybe' })).toThrow('Stage must be one of')
  expect(() => parseDeal({ ...deal({}), value: 'big' })).toThrow('Value must be a number.')
  expect(() => parseDeal(deal({ value: -5 }))).toThrow('Value must be from 0')
  expect(() => parseDeal(deal({ nextDate: 'soon' }))).toThrow('Due date must be a date.')
})

test('a deal moves from new to talking to offer to won, and stops there', () => {
  expect(STAGES.map(nextStage)).toEqual(['talking', 'offer', 'won', null, null])
})

test('a step is overdue only on an open deal with a past date', () => {
  expect(isOverdue(deal({ nextDate: '2026-03-03' }), TODAY)).toBe(true)
  expect(isOverdue(deal({ nextDate: TODAY }), TODAY)).toBe(false)
  expect(isOverdue(deal({ nextDate: '2026-03-03', stage: 'won' }), TODAY)).toBe(false)
  expect(isOverdue(deal({}), TODAY)).toBe(false)
})

test('byStage has every stage in order, with its deals and what they are worth', () => {
  const board = byStage([deal({ company: 'Late', nextDate: '2026-04-01', value: 10 }), deal({ company: 'Soon', nextDate: '2026-03-05', value: 20 }), deal({ company: 'Big', value: 500 }), deal({ company: 'Small', value: 5 }), deal({ company: 'Won', stage: 'won', value: 7 })])
  expect(board.map(c => c.stage)).toEqual([...STAGES])
  expect(board[1]!.deals.map(d => d.company)).toEqual(['Soon', 'Late', 'Big', 'Small'])
  expect(board.map(c => c.value)).toEqual([0, 535, 0, 7, 0])
})

test('the examples pass the check, fill every stage and add up', () => {
  const examples = exampleDeals(TODAY)
  expect(examples.map(parseDeal)).toEqual(examples)
  expect(byStage(examples).every(c => c.deals.length >= 1)).toBe(true)
  expect(summary(examples, TODAY)).toEqual({ open: 4, openValue: 285000, wonValue: 95000, overdue: 1 })
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
  await expect(listDeals()).rejects.toThrow('signed-in member')
  await expect(saveDeal(deal({}))).rejects.toThrow('signed-in member')
  await expect(moveDeal('r-1', 'won')).rejects.toThrow('signed-in member')
  await expect(removeDeal('r-1')).rejects.toThrow('signed-in member')
})

test('server functions refuse bad arguments', async () => {
  signIn()
  await expect(saveDeal(deal({ company: '' }))).rejects.toThrow('Company is needed.')
  await expect(saveDeal(null)).rejects.toThrow('could not be read')
  await expect(moveDeal('r-1', 'maybe')).rejects.toThrow('Stage must be one of')
  await expect(moveDeal('../x', 'won')).rejects.toThrow('could not be found')
  await expect(removeDeal('../x')).rejects.toThrow('could not be found')
  await expect(loadExampleDeals('yesterday')).rejects.toThrow('Today must be a date.')
})

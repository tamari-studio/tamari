import { expect, test } from 'bun:test'
import { setupSteps } from './setup'

const done = (facts: Parameters<typeof setupSteps>[0]) => setupSteps(facts).filter(s => s.done).map(s => s.id)

test('a new workspace has done nothing yet', () => {
  expect(done({ connectors: 0, others: 0, waiting: 0, departments: 0, spaces: 1 })).toEqual([])
})

test('people count as let in only when someone else is active and nobody waits', () => {
  expect(done({ connectors: 0, others: 2, waiting: 1, departments: 0, spaces: 1 })).toEqual([])
  expect(done({ connectors: 0, others: 2, waiting: 0, departments: 0, spaces: 1 })).toEqual(['people'])
})

test('every step done', () => {
  expect(done({ connectors: 1, others: 1, waiting: 0, departments: 1, spaces: 2 })).toEqual(['connect', 'people', 'departments', 'space'])
})

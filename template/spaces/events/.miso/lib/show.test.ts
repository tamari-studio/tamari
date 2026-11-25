import { afterEach, expect, test } from 'bun:test'

import { addDays, byDay, exampleItems, inOrder, isLate, parseItem, summary, upNext, type Item } from './show'
import { listItems, loadExampleItems, markDone, removeItem, saveItem } from './show.server'

const item = (patch: Partial<Item>): Item => ({ day: '2026-03-04', start: '09:00', title: 'A', place: '', owner: '', done: false, ...patch })
const NOW = { day: '2026-03-04', time: '09:30' }

test('parseItem keeps the known fields, cleaned', () => {
  expect(parseItem({ day: '2026-03-04', start: '09:15', title: ' Opening  talk ', place: 'Main hall', done: true, key: 'r-1', extra: 'x' })).toEqual({
    day: '2026-03-04',
    start: '09:15',
    title: 'Opening talk',
    place: 'Main hall',
    owner: '',
    done: true
  })
})

test('parseItem refuses a missing day, a bad time and a missing title', () => {
  expect(() => parseItem(item({ day: '' }))).toThrow('Day is needed.')
  expect(() => parseItem(item({ day: '2026-02-30' }))).toThrow('Day must be a date.')
  expect(() => parseItem(item({ start: '9.15' }))).toThrow('Start time must be a time, such as 09:30.')
  expect(() => parseItem(item({ start: '24:00' }))).toThrow('Start time must be a time')
  expect(() => parseItem(item({ title: ' ' }))).toThrow('What happens is needed.')
  expect(() => parseItem(item({ place: 'x'.repeat(61) }))).toThrow('too long')
  expect(parseItem({ ...item({}), done: 'yes' }).done).toBe(false)
})

test('items are listed in the order they happen, grouped by day', () => {
  const list = [item({ title: 'Lunch', start: '12:00' }), item({ title: 'Check', day: '2026-03-03', start: '15:00' }), item({ title: 'Doors', start: '08:00' }), item({ title: 'Badges', start: '08:00' })]
  expect(inOrder(list).map(i => i.title)).toEqual(['Check', 'Badges', 'Doors', 'Lunch'])
  expect(byDay(list).map(d => [d.day, d.items.map(i => i.title)])).toEqual([
    ['2026-03-03', ['Check']],
    ['2026-03-04', ['Badges', 'Doors', 'Lunch']]
  ])
  expect(byDay([])).toEqual([])
})

test('an item is late when its start has passed and it is not ticked off', () => {
  expect(isLate(item({ start: '09:00' }), NOW)).toBe(true)
  expect(isLate(item({ start: '09:30' }), NOW)).toBe(false)
  expect(isLate(item({ start: '09:00', done: true }), NOW)).toBe(false)
  expect(isLate(item({ day: '2026-03-03', start: '23:00' }), NOW)).toBe(true)
  expect(isLate(item({ day: '2026-03-05', start: '08:00' }), NOW)).toBe(false)
})

test('upNext lists what is not ticked off, late items first', () => {
  const list = [item({ title: 'Lunch', start: '12:00' }), item({ title: 'Doors', start: '08:00', done: true }), item({ title: 'Welcome', start: '09:00' })]
  expect(upNext(list).map(i => i.title)).toEqual(['Welcome', 'Lunch'])
  expect(summary(list, NOW)).toEqual({ done: 1, late: 1, left: 2 })
})

test('the examples pass the check: the set-up yesterday is done, the event is today', () => {
  const examples = exampleItems('2026-03-01')
  expect(examples.map(parseItem)).toEqual(examples)
  expect(byDay(examples).map(d => [d.day, d.items.length, d.items.every(i => i.done)])).toEqual([
    ['2026-02-28', 2, true],
    ['2026-03-01', 8, false]
  ])
  expect(inOrder(examples)).toEqual(examples)
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
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
  await expect(listItems()).rejects.toThrow('signed-in member')
  await expect(saveItem(item({}))).rejects.toThrow('signed-in member')
  await expect(markDone('r-1', true)).rejects.toThrow('signed-in member')
  await expect(removeItem('r-1')).rejects.toThrow('signed-in member')
})

test('server functions refuse bad arguments', async () => {
  signIn()
  await expect(saveItem(item({ start: 'noon' }))).rejects.toThrow('Start time must be a time')
  await expect(saveItem([])).rejects.toThrow('could not be read')
  await expect(markDone('../x', true)).rejects.toThrow('could not be found')
  await expect(removeItem(7)).rejects.toThrow('could not be found')
  await expect(loadExampleItems('yesterday')).rejects.toThrow('Today must be a date.')
})

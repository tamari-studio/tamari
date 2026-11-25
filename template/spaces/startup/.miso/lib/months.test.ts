import { afterEach, expect, test } from 'bun:test'

import { addMonths, cashText, exampleMonths, growth, monthBefore, monthLabel, monthsOfCash, newestFirst, parseMonth, percent, updateText, type Month } from './months'
import { listMonths, loadExampleMonths, markSent, removeMonth, saveMonth } from './months.server'

const row = (patch: Partial<Month>): Month => ({ month: '2026-03', revenue: 1000, customers: 10, cash: 50000, spend: 6000, wentWell: '', wentBadly: '', asks: '', sent: false, ...patch })
const TODAY = '2026-03-04'

test('parseMonth keeps the known fields and reads numbers typed in a form', () => {
  expect(parseMonth({ month: '2026-03', revenue: '42000', customers: '31', cash: '524000,5', spend: 123000, wentWell: ' Good \r\nmonth ', sent: true, key: 'r-1', extra: 'x' })).toEqual({
    month: '2026-03',
    revenue: 42000,
    customers: 31,
    cash: 524000.5,
    spend: 123000,
    wentWell: 'Good \nmonth',
    wentBadly: '',
    asks: '',
    sent: true
  })
})

test('parseMonth refuses a bad month, a missing number and half a customer', () => {
  expect(() => parseMonth(row({ month: '2026-13' }))).toThrow('Month must be a month, such as 2026-03.')
  expect(() => parseMonth({ ...row({}), revenue: '' })).toThrow('Monthly revenue is needed.')
  expect(() => parseMonth({ ...row({}), cash: 'a lot' })).toThrow('Cash in the bank must be a number.')
  expect(() => parseMonth(row({ customers: 2.5 }))).toThrow('Customers must be a whole number.')
  expect(() => parseMonth(row({ spend: -1 }))).toThrow('Spent this month must be from 0')
  expect(() => parseMonth(row({ asks: 'x'.repeat(1001) }))).toThrow('too long')
  expect(parseMonth({ ...row({}), sent: 'yes' }).sent).toBe(false)
})

test('months are shown newest first, and the month before may be further back', () => {
  const list = [row({ month: '2026-01' }), row({ month: '2026-03' }), row({ month: '2025-11' })]
  expect(newestFirst(list).map(m => m.month)).toEqual(['2026-03', '2026-01', '2025-11'])
  expect(monthBefore(list, list[0]!)?.month).toBe('2025-11')
  expect(monthBefore(list, list[2]!)).toBeUndefined()
})

test('growth is in percent, and there is none without something to compare with', () => {
  expect(growth(120, 100)).toBe(20)
  expect(growth(90, 100)).toBe(-10)
  expect(growth(100, 0)).toBeNull()
  expect(growth(100, undefined)).toBeNull()
  expect(percent(16.7)).toBe('+17%')
  expect(percent(-10)).toBe('-10%')
  expect(percent(0)).toBe('0%')
  expect(percent(null)).toBe('')
})

test('months of cash is the cash divided by what the month cost after revenue', () => {
  expect(monthsOfCash({ cash: 50000, spend: 6000, revenue: 1000 })).toBe(10)
  expect(monthsOfCash({ cash: 50000, spend: 1000, revenue: 1000 })).toBe('earning')
  expect(cashText({ cash: 50000, spend: 6000, revenue: 1000 })).toBe('10 months of cash')
  expect(cashText({ cash: 7500, spend: 6000, revenue: 1000 })).toBe('1 month of cash')
  expect(cashText({ cash: 100, spend: 6000, revenue: 1000 })).toBe('Less than 1 month of cash')
  expect(cashText({ cash: 0, spend: 500, revenue: 1000 })).toBe('Revenue covers the spend')
})

test('the update reads as an email, with the change since the month before', () => {
  const before = row({ month: '2026-02', revenue: 800, customers: 8 })
  const text = updateText(row({ wentWell: 'Two new customers.', asks: 'Introductions.' }), before, 'en')
  expect(text).toBe(
    [
      'Update for March 2026',
      '',
      'Numbers',
      '- Monthly revenue: 1,000 (+25% since February 2026)',
      '- Customers: 10 (+2)',
      '- Cash in the bank: 50,000',
      '- Spent this month: 6,000',
      '- 10 months of cash at this pace',
      '',
      'What went well',
      'Two new customers.',
      '',
      'Where you can help',
      'Introductions.'
    ].join('\n')
  )
  expect(updateText(row({}), undefined, 'en')).not.toContain('since')
})

test('the examples pass the check: three months in a row that end last month, the last one not sent', () => {
  const examples = exampleMonths(TODAY)
  expect(examples.map(parseMonth)).toEqual(examples)
  expect(examples.map(m => m.month)).toEqual(['2025-12', '2026-01', '2026-02'])
  expect(examples.map(m => m.sent)).toEqual([true, true, false])
  expect(addMonths('2026-01', -1)).toBe('2025-12')
  expect(addMonths('2026-03', -1)).toBe('2026-02')
  expect(monthLabel('2026-02', 'en')).toBe('February 2026')
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
  await expect(listMonths()).rejects.toThrow('signed-in member')
  await expect(saveMonth(row({}))).rejects.toThrow('signed-in member')
  await expect(markSent('r-1', true)).rejects.toThrow('signed-in member')
  await expect(removeMonth('r-1')).rejects.toThrow('signed-in member')
})

test('server functions refuse bad arguments', async () => {
  signIn()
  await expect(saveMonth(row({ month: 'March' }))).rejects.toThrow('Month must be a month')
  await expect(saveMonth('2026-03')).rejects.toThrow('could not be read')
  await expect(markSent('../x', true)).rejects.toThrow('could not be found')
  await expect(removeMonth(null)).rejects.toThrow('could not be found')
  await expect(loadExampleMonths('yesterday')).rejects.toThrow('Today must be a date.')
})

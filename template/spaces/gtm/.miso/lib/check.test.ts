import { expect, test } from 'bun:test'

import { amount, choice, day, fields, longText, month, rowKey, text, time, yesNo } from './check'

test('fields takes an object and nothing else', () => {
  expect(fields({ a: 1 })).toEqual({ a: 1 })
  for (const bad of [null, undefined, 'x', 3, [1]]) expect(() => fields(bad)).toThrow('could not be read')
})

test('text trims, joins spaces, and enforces needed and length', () => {
  expect(text('  Harbour   Hotel ', 'Name')).toBe('Harbour Hotel')
  expect(text(undefined, 'Name')).toBe('')
  expect(() => text('', 'Name', { required: true })).toThrow('Name is needed.')
  expect(() => text('x'.repeat(11), 'Name', { max: 10 })).toThrow('too long')
  expect(() => text(42, 'Name')).toThrow('must be text')
  expect(() => text({ toString: () => 'x' }, 'Name')).toThrow('must be text')
})

test('longText keeps line breaks', () => {
  expect(longText(' a\r\nb ', 'Notes')).toBe('a\nb')
  expect(() => longText('x'.repeat(6), 'Notes', 5)).toThrow('too long')
})

test('choice only lets listed values through', () => {
  expect(choice('active', 'Status', ['lead', 'active'] as const)).toBe('active')
  expect(() => choice('__proto__', 'Status', ['lead', 'active'] as const)).toThrow('Status must be one of: lead, active.')
  expect(() => choice(undefined, 'Status', ['lead'] as const)).toThrow('Status')
})

test('day wants a real YYYY-MM-DD date or nothing', () => {
  expect(day('2026-03-04', 'Due date')).toBe('2026-03-04')
  expect(day('', 'Due date')).toBe('')
  expect(() => day('', 'Due date', { required: true })).toThrow('is needed')
  for (const bad of ['2026-02-30', '04/03/2026', '2026-3-4', 20260304]) expect(() => day(bad, 'Due date')).toThrow('must be a date')
})

test('month and time', () => {
  expect(month('2026-03', 'Month')).toBe('2026-03')
  for (const bad of ['2026-13', '2026-3', '', null]) expect(() => month(bad, 'Month')).toThrow('must be a month')
  expect(time('09:30', 'Start')).toBe('09:30')
  for (const bad of ['24:00', '9:30', '09:60', '']) expect(() => time(bad, 'Start')).toThrow('must be a time')
})

test('amount reads numbers and form text, within limits', () => {
  expect(amount(12, 'Value')).toBe(12)
  expect(amount(' 12,5 ', 'Value')).toBe(12.5)
  expect(amount('', 'Value')).toBeNull()
  expect(() => amount('', 'Value', { required: true })).toThrow('is needed')
  expect(() => amount('12.5', 'Value', { whole: true })).toThrow('whole number')
  expect(() => amount(-1, 'Value')).toThrow('must be from 0')
  expect(amount(-1, 'Value', { min: -10 })).toBe(-1)
  for (const bad of ['abc', '1e9', NaN, Infinity, {}, true]) expect(() => amount(bad, 'Value')).toThrow('must be a number')
})

test('yesNo is true only for true', () => {
  expect(yesNo(true)).toBe(true)
  for (const other of ['true', 1, undefined, null]) expect(yesNo(other)).toBe(false)
})

test('rowKey refuses anything that is not a plain key', () => {
  expect(rowKey('r-0b1e-4c')).toBe('r-0b1e-4c')
  for (const bad of ['', '../x', 'A', 'a b', 'x'.repeat(65), 7, null, '%']) expect(() => rowKey(bad)).toThrow('could not be found')
})

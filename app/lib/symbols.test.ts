import { expect, test } from 'bun:test'

import { isSymbol, SYMBOLS } from './symbols'

test('only listed ids are symbols, each in the shape the database accepts', () => {
  expect(isSymbol('rocket')).toBe(true)
  expect(isSymbol('Rocket')).toBe(false)
  expect(isSymbol('<svg>')).toBe(false)
  expect(isSymbol(null)).toBe(false)
  for (const id of SYMBOLS) expect(id).toMatch(/^[a-z0-9-]{1,32}$/)
})

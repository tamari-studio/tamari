import { expect, test } from 'bun:test'
import { visit } from './visited'

test('a view visited twice in a row is kept once', () => {
  expect(visit(visit([], 'view:a', 3), 'view:a', 3)).toEqual(['view:a'])
})

test('the last few views stay, the oldest goes', () => {
  expect(['a', 'b', 'c', 'd'].reduce((v, ref) => visit(v, ref, 3), [] as string[])).toEqual(['b', 'c', 'd'])
  expect(visit(['a', 'b', 'c'], 'a', 3)).toEqual(['a', 'b', 'c'])
})

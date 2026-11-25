import { expect, test } from 'bun:test'

import { countChanges, diffRows } from './diff'

test('changed lines show as removed and added, far-away lines are folded', () => {
  const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n'
  const after = before.replace('line 10\n', 'line ten\n')
  const rows = diffRows(before, after, 2)
  expect(rows).toEqual([
    { type: 'skip', count: 7 },
    { type: 'same', text: 'line 8' },
    { type: 'same', text: 'line 9' },
    { type: 'remove', text: 'line 10' },
    { type: 'add', text: 'line ten' },
    { type: 'same', text: 'line 11' },
    { type: 'same', text: 'line 12' },
    { type: 'skip', count: 8 }
  ])
  expect(countChanges(rows)).toEqual({ added: 1, removed: 1 })
})

test('a new note is all added lines', () => {
  expect(diffRows('', '# New\n\nHello\n')).toEqual([
    { type: 'add', text: '# New' },
    { type: 'add', text: '' },
    { type: 'add', text: 'Hello' }
  ])
})

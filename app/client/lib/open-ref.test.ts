import { expect, test } from 'bun:test'

import { resolveOpen, type OpenContext } from './open-ref'

const funding = { id: 's-funding', slug: 'funding', folder: 'cvr-funds', name: 'Funding' }
const data = { id: 's-data', slug: 'data', folder: 'dto', name: 'Data' }
const view = (title: string) => ({ title })
const all = new Map([
  ['view:dto/data', view('Data')],
  ['view:cvr-funds/fondenradar', view('Fondenradar')],
  ['view:ibtikar/company-budget', view('Company budget')]
])
const visible = new Map([...all].filter(([ref]) => !ref.startsWith('view:ibtikar/')))
const context: OpenContext = { current: funding, spaces: [funding, data], visible, all }

test("another space's view opens in its own space", () => {
  expect(resolveOpen('cvr-funds', 'view:dto/data', context)).toEqual({ kind: 'open', space: data, ref: 'view:dto/data' })
})

test("a space's own view opens in the space on screen, named with or without its folder", () => {
  const here = { kind: 'open', space: funding, ref: 'view:cvr-funds/fondenradar' } as const
  expect(resolveOpen('cvr-funds', 'view:fondenradar', context)).toEqual(here)
  expect(resolveOpen('cvr-funds', 'view:cvr-funds/fondenradar', context)).toEqual(here)
  // A view shown in another space's tabs still opens its own space's views next to itself.
  expect(resolveOpen('cvr-funds', 'view:fondenradar', { ...context, current: data })).toEqual({ ...here, space: data })
})

test('a link from a borrowed view back to the space on screen stays there', () => {
  expect(resolveOpen('cvr-funds', 'view:dto/data', { ...context, current: data })).toEqual({ kind: 'open', space: data, ref: 'view:dto/data' })
})

test('a view this person may not see is refused in plain words, and so is one that is gone', () => {
  const hidden = resolveOpen('cvr-funds', 'view:ibtikar/company-budget', context)
  expect(hidden).toEqual({ kind: 'refuse', message: "You don't have access to Company budget. Ask an admin or owner if you need it.", tone: 'info' })
  const gone = resolveOpen('cvr-funds', 'view:dto/nope', context)
  expect(gone.kind).toBe('refuse')
  expect(gone).toMatchObject({ tone: 'error' })
})

test("a visible view whose space this person doesn't have opens here, as it always did", () => {
  expect(resolveOpen('cvr-funds', 'view:dto/data', { ...context, spaces: [funding] })).toEqual({ kind: 'open', space: funding, ref: 'view:dto/data' })
})

test('widgets opens here; chat is refused; anything else, or no space on screen, is ignored', () => {
  expect(resolveOpen('cvr-funds', 'widgets', context)).toEqual({ kind: 'open', space: funding, ref: 'widgets' })
  expect(resolveOpen('cvr-funds', 'agent', context).kind).toBe('refuse')
  expect(resolveOpen('cvr-funds', 'settings', context)).toEqual({ kind: 'ignore' })
  expect(resolveOpen('cvr-funds', 'widgets', { ...context, current: undefined })).toEqual({ kind: 'ignore' })
  expect(resolveOpen('cvr-funds', 'view:fondenradar', { ...context, current: undefined })).toEqual({ kind: 'ignore' })
})

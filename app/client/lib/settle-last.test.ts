import { expect, spyOn, test } from 'bun:test'
import { MutationObserver, QueryClient } from '@tanstack/react-query'

import { settleLast } from './queries'

test('scoped saves run one at a time, and only the last one refetches', async () => {
  const qc = new QueryClient()
  const invalidate = spyOn(qc, 'invalidateQueries')
  const order: string[] = []
  const save = (name: string) =>
    new MutationObserver(qc, {
      mutationKey: ['workspace'],
      scope: { id: 'workspace' },
      mutationFn: async () => {
        order.push(`${name} start`)
        await new Promise(resolve => setTimeout(resolve, 5))
        order.push(`${name} end`)
      },
      onSettled: () => settleLast(qc, ['workspace'])
    }).mutate()
  await Promise.all([save('a'), save('b')])
  expect(order).toEqual(['a start', 'a end', 'b start', 'b end'])
  expect(invalidate).toHaveBeenCalledTimes(1)
})

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { stringify } from 'devalue'

import { borrowRetry, rpc } from './rpc'
import { hideApplet, setCurrentSpace, showApplet } from './session'

type Sent = { url: string; space: string | null }

const realFetch = globalThis.fetch
let sent: Sent[] = []
let replies: Response[] = []
const mounted: symbol[] = []

beforeEach(() => {
  sent = []
  replies = []
  borrowRetry.delayMs = 0
  setCurrentSpace(null)
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, space: new Headers(init.headers).get('x-miso-space') })
    return replies.shift() ?? new Response(stringify('ok'))
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  for (const token of mounted.splice(0)) hideApplet(token)
})

function mount(spaceId: string, folder: string): symbol {
  const token = Symbol(folder)
  mounted.push(token)
  showApplet(token, spaceId, folder)
  return token
}

const refused = () => new Response('Not found', { status: 404, headers: { 'x-miso-borrow': 'refused' } })

test('a borrowed widget calls as the space displaying it, even before the shell sets one', async () => {
  mount('sp-mgmt', 'ops')
  expect(await rpc('ops', 'widgets/kpi', 'load')()).toBe('ok')
  expect(sent).toEqual([{ url: '/api/rpc/ops/widgets/kpi/load', space: 'sp-mgmt' }])
})

test('with the folder shown in two spaces, the one on screen wins', async () => {
  mount('sp-ops', 'ops')
  mount('sp-mgmt', 'ops')
  setCurrentSpace('sp-ops')
  await rpc('ops', 'lib/dto', 'loadSnapshot')()
  expect(sent[0]!.space).toBe('sp-ops')
})

test('an unmounted applet stops naming its space; the space on screen is the fallback', async () => {
  hideApplet(mount('sp-mgmt', 'ops'))
  setCurrentSpace('sp-data')
  await rpc('ops', 'lib/dto', 'loadSnapshot')()
  expect(sent[0]!.space).toBe('sp-data')
})

test('a refused borrow is retried exactly once', async () => {
  mount('sp-mgmt', 'ops')
  replies = [refused(), new Response(stringify(42))]
  expect(await rpc('ops', 'lib/dto', 'loadSnapshot')()).toBe(42)
  expect(sent.length).toBe(2)

  sent = []
  replies = [refused(), refused(), new Response(stringify('never'))]
  await expect(rpc('ops', 'lib/dto', 'loadSnapshot')()).rejects.toThrow('Not found')
  expect(sent.length).toBe(2)
})

test('any other 404 is not retried', async () => {
  replies = [new Response('No server module', { status: 404 })]
  await expect(rpc('ops', 'lib/dto', 'missing')()).rejects.toThrow('No server module')
  expect(sent.length).toBe(1)
})

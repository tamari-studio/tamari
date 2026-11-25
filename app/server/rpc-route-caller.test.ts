import { expect, mock, test } from 'bun:test'
import { parse } from 'devalue'
import type { MiddlewareHandler } from 'hono'

import type { Catalog } from '../lib/types'
import * as realConnectors from './connectors'
import * as realDtoSession from './dto-session'

// The route would otherwise reach Supabase for connector values and the
// brokered token. Only those two functions are replaced.
mock.module('./connectors', () => ({ ...realConnectors, connectorEnvForSpace: async () => ({}) }))
mock.module('./dto-session', () => ({ ...realDtoSession, hostedDtoToken: async () => 'brokered-token' }))

const { createApp } = await import('./app')
const { callerEmail, callerId } = await (await import('./caller-testing')).loadCaller()
import type { AuthEnv } from './auth'
import { memorySpaceAccessStore } from './space-access-testing'

const catalog: Catalog = {
  spaces: [{ id: 'sp-ops', slug: 'ops', folder: 'ops', previousSlugs: [], position: 0, name: 'ops', theme: {} }],
  applets: []
}

const signedIn: MiddlewareHandler<AuthEnv> = async (c, next) => {
  c.set('user', { id: 'u-ada', email: 'ada@example.com', name: null, avatarUrl: null, tier: 'member', status: 'active', token: 'secret-user-jwt' })
  await next()
}

const app = createApp({
  catalog,
  modules: {
    'ops/who': async () => ({
      whoami: async () => ({ email: callerEmail(), id: callerId() }),
      refuse: async () => {
        throw new Error('Pick a date first. ' + 'x'.repeat(600))
      }
    }),
    // The shell's own plumbing failing, not the space's code.
    'ops/broken': async () => {
      throw new Error('relation "miso.secret_table" does not exist')
    }
  },
  commit: null,
  builtAt: '',
  requireUser: signedIn,
  spaceAccessStore: () => memorySpaceAccessStore()
})

test('the RPC route passes the signed-in member as the caller, not a spoofed header', async () => {
  const res = await app.request('/api/rpc/ops/who/whoami', {
    method: 'POST',
    headers: {
      'x-miso-space': 'sp-ops',
      'x-miso-caller-email': 'boss@example.com',
      'x-miso-caller-id': 'u-boss'
    },
    body: ''
  })
  expect(res.status).toBe(200)
  const text = await res.text()
  expect(parse(text)).toEqual({ email: 'ada@example.com', id: 'u-ada' })
  expect(text).not.toContain('boss@example.com')
  expect(text).not.toContain('secret-user-jwt')
})

test("a space function's own error reaches the person, cut to 500 characters", async () => {
  const res = await app.request('/api/rpc/ops/who/refuse', { method: 'POST', headers: { 'x-miso-space': 'sp-ops' }, body: '' })
  expect(res.status).toBe(500)
  const text = await res.text()
  expect(text.startsWith('Pick a date first. ')).toBe(true)
  expect(text).toHaveLength(500)
})

test("the shell's own failure around the call stays generic", async () => {
  const { SERVER_ERROR } = await import('./app')
  const res = await app.request('/api/rpc/ops/broken/anything', { method: 'POST', headers: { 'x-miso-space': 'sp-ops' }, body: '' })
  expect(res.status).toBe(500)
  const text = await res.text()
  expect(text).not.toContain('secret_table')
  expect(JSON.parse(text)).toEqual({ error: SERVER_ERROR })
})

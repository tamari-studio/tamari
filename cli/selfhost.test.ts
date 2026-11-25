import { expect, test } from 'bun:test'

import { buildEnv, start } from './selfhost'

test('start migrates, then sets up, then serves', async () => {
  const order: string[] = []
  await start(
    {
      migrate: async () => (order.push('migrate'), '1 migrations applied'),
      setup: async () => void order.push('setup'),
      serve: async () => void order.push('serve')
    },
    () => {}
  )
  expect(order).toEqual(['migrate', 'setup', 'serve'])
})

test('a failed migration stops the start: nothing is set up and the app does not serve', async () => {
  const order: string[] = []
  const run = start(
    {
      migrate: async () => {
        throw new Error('shell/20261123000300_ai_tokens.sql failed, nothing after it ran')
      },
      setup: async () => void order.push('setup'),
      serve: async () => void order.push('serve')
    },
    () => {}
  )
  await expect(run).rejects.toThrow('ai_tokens.sql failed')
  expect(order).toEqual([])
})

test("the build's environment has the public address and key, never the database's password or secret key", () => {
  const env = buildEnv({ PATH: '/bin', SUPABASE_URL: 'http://kong:8000', SUPABASE_PUBLISHABLE_KEY: 'pk', SUPABASE_SECRET_KEY: 'sk', DATABASE_URL: 'postgres://x', MISO_VAULT_EMAIL: 'v@x', MISO_SECRET: 's', BUN_INSTALL: '/b', OTHER: 'o' })
  expect(env).toEqual({ PATH: '/bin', SUPABASE_URL: 'http://kong:8000', SUPABASE_PUBLISHABLE_KEY: 'pk', MISO_VAULT_EMAIL: 'v@x', BUN_INSTALL: '/b' })
})

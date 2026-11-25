import { expect, mock, test } from 'bun:test'
import { createClient } from '@supabase/supabase-js'
import { parse, stringify } from 'devalue'

import * as realConnectors from './connectors'
import * as realDtoSession from './dto-session'

// Only the two calls that would reach Supabase are replaced, as in rpc-caller.test.ts.
mock.module('./connectors', () => ({ ...realConnectors, connectorEnvForSpace: async () => ({ TITO_TOKEN: 'tito' }) }))
mock.module('./dto-session', () => ({ ...realDtoSession, hostedDtoToken: async () => 'brokered-token' }))

const { callServerFunction } = await import('./rpc')

test('a space call builds its Supabase client from the deployment, and sees no other deployment secret', async () => {
  const saved = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, secret: process.env.CRON_SECRET }
  process.env.SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_x'
  process.env.CRON_SECRET = 'deploy-only'
  try {
    const modules = {
      'ops/db': async () => ({
        probe: async () => {
          const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } })
          return { built: typeof db.from === 'function', cron: process.env.CRON_SECRET ?? null, tito: process.env.TITO_TOKEN ?? null }
        }
      })
    }
    const text = await callServerFunction({ modules, folder: 'ops', moduleKey: 'db', fn: 'probe', spaceId: 'sp1', body: stringify([]) })
    expect(parse(text)).toEqual({ built: true, cron: null, tito: 'tito' })
  } finally {
    for (const [key, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_PUBLISHABLE_KEY', saved.key], ['CRON_SECRET', saved.secret]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

import { afterEach, expect, test } from 'bun:test'

import { createApp } from './app'

const saved = { url: process.env.SUPABASE_URL, pub: process.env.SUPABASE_PUBLIC_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY }
afterEach(() => {
  for (const [name, value] of [['SUPABASE_URL', saved.url], ['SUPABASE_PUBLIC_URL', saved.pub], ['SUPABASE_PUBLISHABLE_KEY', saved.key]] as const) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

const config = async () => {
  const app = createApp({ catalog: { spaces: [], applets: [] }, modules: {}, commit: null, builtAt: '' })
  return (await (await app.request('/api/config')).json()) as { supabaseUrl: string }
}

test('the browser gets SUPABASE_URL when no public address is set', async () => {
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'pk'
  delete process.env.SUPABASE_PUBLIC_URL
  expect((await config()).supabaseUrl).toBe('http://127.0.0.1:54321')
})

test('the browser gets SUPABASE_PUBLIC_URL when it is set, the server keeps its own address', async () => {
  process.env.SUPABASE_URL = 'http://kong:8000'
  process.env.SUPABASE_PUBLIC_URL = 'https://tamari.example.com'
  process.env.SUPABASE_PUBLISHABLE_KEY = 'pk'
  expect((await config()).supabaseUrl).toBe('https://tamari.example.com')
})

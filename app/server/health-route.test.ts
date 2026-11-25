import { expect, spyOn, test } from 'bun:test'

import { createApp, HEALTH_TTL_MS } from './app'

const appWith = (checkHealth: () => Promise<void>) =>
  createApp({ catalog: { spaces: [], applets: [] }, modules: {}, commit: null, builtAt: '', checkHealth })

test('health is public and answers ok when the database check passes', async () => {
  const res = await appWith(async () => {}).request('/api/health')
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test('a failing check is a 503 that says only "not ok"', async () => {
  const quiet = spyOn(console, 'error').mockImplementation(() => {})
  try {
    const res = await appWith(async () => {
      throw new Error('relation "miso.spaces" does not exist')
    }).request('/api/health')
    expect(res.status).toBe(503)
    expect(await res.text()).toBe('{"ok":false}')
  } finally {
    quiet.mockRestore()
  }
})

test('the answer is kept for 5 seconds, so a loop of requests reads the database once per 5 s', async () => {
  let checks = 0
  let now = 1_000_000
  const clock = spyOn(Date, 'now').mockImplementation(() => now)
  try {
    const app = appWith(async () => void checks++)
    await Promise.all([app.request('/api/health'), app.request('/api/health')])
    now += HEALTH_TTL_MS - 1
    expect((await app.request('/api/health')).status).toBe(200)
    expect(checks).toBe(1)
    now += 1
    await app.request('/api/health')
    expect(checks).toBe(2)
  } finally {
    clock.mockRestore()
  }
})

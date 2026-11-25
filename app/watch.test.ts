import { expect, test } from 'bun:test'

import { rebuildOnChange } from './watch'

// A build the test finishes by hand, so changes can arrive while it runs.
function harness() {
  const builds: { done: (ok: boolean) => void }[] = []
  let restarts = 0
  const onChange = rebuildOnChange({
    build: () => new Promise<boolean>(done => builds.push({ done })),
    restart: () => void restarts++,
    log: () => {},
    delayMs: 0
  })
  return { onChange, builds, restarts: () => restarts }
}

const tick = () => Bun.sleep(5)

test('a change builds once and a passing build restarts', async () => {
  const h = harness()
  h.onChange('change', 'workspaces/acme/.miso/views/home.tsx')
  await tick()
  expect(h.builds.length).toBe(1)
  h.builds[0]!.done(true)
  await tick()
  expect(h.restarts()).toBe(1)
})

test('changes during a build queue exactly one more build', async () => {
  const h = harness()
  h.onChange('change', 'a.tsx')
  await tick()
  for (const file of ['b.tsx', 'c.tsx', 'd.tsx']) {
    h.onChange('change', file)
    await tick()
  }
  expect(h.builds.length).toBe(1)
  h.builds[0]!.done(true)
  await tick()
  expect(h.builds.length).toBe(2)
  h.builds[1]!.done(true)
  await tick()
  expect(h.builds.length).toBe(2)
  expect(h.restarts()).toBe(2)
})

test('a failed build does not restart', async () => {
  const h = harness()
  h.onChange('change', 'a.tsx')
  await tick()
  h.builds[0]!.done(false)
  await tick()
  expect(h.restarts()).toBe(0)
})

test('ignored paths do not build', async () => {
  const h = harness()
  for (const file of ['.git/index', 'acme/.miso/node_modules/x/index.js', '.generated/entry.ts', 'server.log', null]) h.onChange('change', file)
  await tick()
  expect(h.builds.length).toBe(0)
})

import { afterEach, expect, spyOn, test } from 'bun:test'

import { getVault } from './vault.server'

const saved = { ...process.env }
afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

test('without a connector the vault is "not configured"', async () => {
  process.env.MISO_CALLER_EMAIL = 'a@b.c'
  process.env.MISO_CALLER_ID = 'u1'
  delete process.env.VAULT_REPO
  expect(await getVault()).toEqual({ configured: false })
})

test('reads notes and skills from the repo, skipping dot folders', async () => {
  process.env.MISO_CALLER_EMAIL = 'a@b.c'
  process.env.MISO_CALLER_ID = 'u1'
  process.env.VAULT_REPO = 'acme/vault-test'
  process.env.VAULT_TOKEN = 't'
  const urls: string[] = []
  const spy = spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('/git/trees/')) {
      const tree = ['index.md', '02-Projects/a.md', '.obsidian/x.md', '.claude/skills/plan/SKILL.md'].map(path => ({ path, type: 'blob' }))
      return new Response(JSON.stringify({ tree, truncated: false }))
    }
    return new Response('---\nname: plan\ndescription: Pick the next task. Use when the day starts.\n---\n')
  }) as typeof fetch)
  try {
    const vault = await getVault()
    expect(vault).toMatchObject({ configured: true, repo: 'acme/vault-test', ref: 'HEAD', notes: ['index.md', '02-Projects/a.md'], skills: [{ id: 'plan', name: 'plan' }] })
  } finally {
    spy.mockRestore()
  }
})

test('a malformed VAULT_REPO is refused before any request', async () => {
  process.env.MISO_CALLER_EMAIL = 'a@b.c'
  process.env.MISO_CALLER_ID = 'u1'
  process.env.VAULT_REPO = '../etc'
  process.env.VAULT_TOKEN = 't'
  await expect(getVault()).rejects.toThrow('owner/name')
})

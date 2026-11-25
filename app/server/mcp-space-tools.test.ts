import { expect, test } from 'bun:test'

import type { AuthedUser } from './auth'
import { SPACE_TOOLS } from './mcp-space-tools'
import { createAiToken, type AiTokenStore } from './mcp-tokens'
import { ToolRefusal, type ToolContext } from './mcp-tools'

const person = (tier: AuthedUser['tier']): AuthedUser => ({ id: 'u1', email: 'u1@example.com', name: 'U', avatarUrl: null, tier, status: 'active', token: 's' })
// `now`: the tier read fresh on the call; `tier`: what the sign-in cache still says.
const ctx = (tier: AuthedUser['tier'], editsSpaces: boolean, now: string | null = tier, extra: Partial<ToolContext> = {}): ToolContext =>
  ({
    user: person(tier),
    editsSpaces,
    currentTier: async () => now,
    hidden: async () => ({ folders: new Set(), spaceIds: new Set(), viewRefs: new Set(), widgetRefs: new Set() }),
    ...extra
  }) as unknown as ToolContext
const run = (name: string, c: ToolContext, args: unknown) => SPACE_TOOLS.find(t => t.name === name)!.run(c, args as never)

const writers = ['change_space_files', 'create_space', 'edit_tabs', 'edit_layout', 'delete_draft_space', 'submit_proposal']

test('every changing tool refuses a read-only token, even an owner’s', async () => {
  for (const name of writers) await expect(run(name, ctx('owner', false), {})).rejects.toThrow('can only read')
})

test('a member with an edit token reaches only their own drafts: another space is refused', async () => {
  // The repo's own workspaces/ has no spaces.json there, so no space is anyone's draft.
  for (const name of ['change_space_files', 'edit_tabs', 'edit_layout', 'delete_draft_space']) {
    await expect(run(name, ctx('member', true), { space: 'miso', summary: 'x', write: [], tabs: [], widgets: [] })).rejects.toThrow(ToolRefusal)
  }
})

test('someone no longer a member a moment ago is refused, though the sign-in cache still has them', async () => {
  for (const name of writers) await expect(run(name, ctx('admin', true, null), {})).rejects.toThrow('not an active member')
})

test('edit_tabs checks every ref before it changes anything', async () => {
  const calls: string[] = []
  const c = ctx('admin', true, 'admin', {
    catalog: { spaces: [], applets: [{ ref: 'acme/home', folder: 'acme', name: 'home', kind: 'view', file: '', title: 'Home', requiredEnv: [] }] },
    api: async (method: string, path: string) => {
      calls.push(`${method} ${path}`)
      return { spaces: [{ id: 'acme-1', slug: 'acme' }], tabs: [{ id: 't1', spaceId: 'acme-1', ref: 'view:acme/home', position: 0 }] }
    }
  } as Partial<ToolContext>)
  await expect(run('edit_tabs', c, { space: 'acme', tabs: ['widgets', 'view:acme/nope'] })).rejects.toThrow('No such view in this build: view:acme/nope')
  expect(calls).toEqual([])
})

test('only the changing tools are marked as writing', () => {
  expect(SPACE_TOOLS.filter(t => t.writes).map(t => t.name).sort()).toEqual([...writers].sort())
})

test('any member may make a token that may change spaces; the flag is true or false', async () => {
  const store: AiTokenStore = {
    list: async () => ({ available: true, tokens: [] }),
    create: async (name, _hash, editsSpaces) => ({ id: 't', name, createdAt: '', lastUsedAt: null, editsSpaces }),
    remove: async () => false
  }
  await expect(createAiToken(store, { name: 'Claude', editsSpaces: 'yes' })).rejects.toThrow('true or false')
  expect((await createAiToken(store, { name: 'Claude', editsSpaces: true }))?.editsSpaces).toBe(true)
  expect((await createAiToken(store, { name: 'Claude' }))?.editsSpaces).toBe(false)
})

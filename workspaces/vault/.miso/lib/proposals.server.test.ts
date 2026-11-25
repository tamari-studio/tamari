import { afterEach, beforeEach, expect, test } from 'bun:test'

import { vaultCache } from './github'
import { proposeChange } from './notes.server'
import { branchName, parseBranch, parseMarker, pullRequestBody } from './proposals'
import { getProposal, listProposals, withdrawProposal } from './proposals.server'
import { fakeGitHub, restoreEnv, signIn, TOKEN, type FakeGitHub } from './testing'

const REPO = 'acme/handbook'
const PATH = 'People/Expenses.md'
const OLD = '# Expenses\n\nKeep the receipt.\n'
const NEW = '# Expenses\n\nKeep the receipt for 5 years.\n'
const mia = { id: 'u-mia', email: 'mia@example.com' }
const sam = { id: 'u-sam', email: 'sam@example.com' }

let hub: FakeGitHub

beforeEach(() => {
  vaultCache.clear()
  hub = fakeGitHub(REPO, { [PATH]: OLD, 'index.md': '# Handbook\n' })
})

afterEach(() => {
  hub.restore()
  restoreEnv()
})

/** Mia proposes the edit; returns the pull request number. */
async function proposed(input: { path?: string; content?: string; baseSha?: string | null } = {}): Promise<number> {
  signIn(mia, REPO)
  const path = input.path ?? PATH
  const filed = await proposeChange({ path, content: input.content ?? NEW, reason: 'Tax rule', baseSha: input.baseSha === undefined ? hub.sha(path) : input.baseSha })
  return filed.number
}

test('lists open proposals with their pull request, and opens one with both texts', async () => {
  const n = await proposed()
  signIn(sam, REPO)
  const list = await listProposals()
  expect(list.me).toBe('u-sam')
  expect(list.proposals).toMatchObject([{ number: n, status: 'open', url: `https://github.com/${REPO}/pull/${n}`, proposer: mia, reason: 'Tax rule', kind: 'edit', path: PATH }])
  expect(list.proposals[0]).not.toHaveProperty('marker')

  const detail = await getProposal(n)
  expect(detail).toMatchObject({ oldContent: OLD, newContent: NEW, conflict: false, canWithdraw: false })
  signIn(mia, REPO)
  expect((await getProposal(n)).canWithdraw).toBe(true)
  expect(JSON.stringify([list, detail])).not.toContain(TOKEN)
})

test('merged and closed on GitHub show as such, and the diff still loads once the branch is gone', async () => {
  const merged = await proposed()
  const closed = await proposed({ path: 'index.md', content: '# Handbook v2\n' })
  hub.merge(merged)
  hub.branches.delete(hub.pulls.get(merged)!.head.ref)
  hub.pulls.get(closed)!.state = 'closed'

  expect((await listProposals('open')).proposals).toEqual([])
  const done = (await listProposals('closed')).proposals
  expect(done.map(p => [p.number, p.status])).toEqual([
    [closed, 'closed'],
    [merged, 'merged']
  ])
  expect(done[1].closedAt).toBeString()
  expect(await getProposal(merged)).toMatchObject({ oldContent: OLD, newContent: NEW, canWithdraw: false, proposal: { status: 'merged' } })
  expect(hub.files.get(PATH)).toBe(NEW)
  await expect(withdrawProposal(merged)).rejects.toThrow('already merged')
})

test('the proposer withdraws: the pull request closes and its branch goes', async () => {
  const n = await proposed()
  const branch = hub.pulls.get(n)!.head.ref
  expect(await withdrawProposal(n)).toMatchObject({ number: n, status: 'closed' })
  expect(hub.pulls.get(n)!.state).toBe('closed')
  expect(hub.branches.has(branch)).toBe(false)
  await expect(withdrawProposal(n)).rejects.toThrow('already closed')
})

test('withdrawing works when a developer already deleted the branch', async () => {
  const n = await proposed()
  hub.branches.delete(hub.pulls.get(n)!.head.ref)
  expect(await withdrawProposal(n)).toMatchObject({ status: 'closed' })
})

test("nobody withdraws someone else's proposal: ownership is read from GitHub", async () => {
  const n = await proposed()
  signIn(sam, REPO)
  expect((await getProposal(n)).canWithdraw).toBe(false)
  await expect(withdrawProposal(n)).rejects.toThrow('Only the person who made')
  // Sam can't pose as Mia by sending her data; the functions only take a number.
  await expect(withdrawProposal({ number: n, proposer: mia } as never)).rejects.toThrow('not a proposal')
  expect(hub.pulls.get(n)!.state).toBe('open')
  expect(hub.requests.filter(r => r.method === 'PATCH' || r.method === 'DELETE')).toEqual([])
})

test('pull requests this space did not make are not proposals', async () => {
  const mine = await proposed()
  const real = hub.pulls.get(mine)!
  const markerFor = (by: string, id = 'abc-12345678') => pullRequestBody({ id, by, email: `${by}@example.com`, path: PATH, kind: 'edit', base: real.head.sha }, 'r')
  const forged = [
    // A developer's own pull request.
    hub.addPull({ body: 'Fix typo', head: { ref: 'fix-typo', sha: real.head.sha, repo: { full_name: REPO } } }),
    // From a fork, with a branch and marker that look right.
    hub.addPull({ body: markerFor('u-sam'), head: { ref: 'miso/u-sam/abc-12345678', sha: real.head.sha, repo: { full_name: 'evil/handbook' } } }),
    // The marker names someone other than the branch.
    hub.addPull({ body: markerFor('u-mia'), head: { ref: 'miso/u-sam/abc-12345678', sha: real.head.sha, repo: { full_name: REPO } } }),
    // Into another branch.
    hub.addPull({ body: markerFor('u-sam'), head: { ref: 'miso/u-sam/abc-12345678', sha: real.head.sha, repo: { full_name: REPO } }, base: { ref: 'other', repo: { full_name: REPO } } }),
    // The marker not on the first line.
    hub.addPull({ body: `hello\n${markerFor('u-sam')}`, head: { ref: 'miso/u-sam/abc-12345678', sha: real.head.sha, repo: { full_name: REPO } } })
  ]
  signIn(sam, REPO)
  expect((await listProposals()).proposals.map(p => p.number)).toEqual([mine])
  for (const n of [...forged, 999]) {
    await expect(getProposal(n)).rejects.toThrow('does not exist')
    await expect(withdrawProposal(n)).rejects.toThrow('does not exist')
  }
  for (const bad of [0, -1, 1.5, '1', null, 1e12]) await expect(getProposal(bad as never)).rejects.toThrow('not a proposal')
})

test('GitHub saying the pull request cannot be merged shows as a conflict', async () => {
  const n = await proposed()
  hub.pulls.get(n)!.mergeable = false
  expect((await getProposal(n)).conflict).toBe(true)
})

test('a token that cannot read pull requests says so', async () => {
  await proposed()
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => (String(input).includes('/pulls') ? new Response('{}', { status: 403 }) : realFetch(input, init))) as typeof fetch
  try {
    await expect(listProposals()).rejects.toThrow('Pull requests: Read and write')
  } finally {
    globalThis.fetch = realFetch
  }
  await expect(listProposals('all' as never)).rejects.toThrow('open or closed')
})

test('branch names and markers: the member id must be safe, and the marker is parsed from line one only', () => {
  expect(branchName('u-mia', 'abc-12345678')).toBe('miso/u-mia/abc-12345678')
  expect(() => branchName('../main', 'abc-12345678')).toThrow()
  expect(() => branchName('u-mia', 'x')).toThrow()
  expect(parseBranch('miso/u-mia/abc-12345678')).toEqual({ memberId: 'u-mia', proposalId: 'abc-12345678' })
  for (const ref of ['miso/u-mia', 'main', 'miso/a/b/abc-12345678', 'x/u-mia/abc-12345678', 7]) expect(parseBranch(ref)).toBeNull()

  const body = pullRequestBody({ id: 'abc-12345678', by: 'u-mia', email: 'mia@example.com --> <b>', path: PATH, kind: 'edit', base: 'a'.repeat(40) }, 'r')
  // The only "-->" on the marker line is the one that ends it.
  expect(body.split('\n')[0].slice(0, -4)).not.toContain('-->')
  expect(parseMarker(body)).toMatchObject({ by: 'u-mia', email: 'mia@example.com --> <b>' })
  expect(parseMarker('<!-- miso-proposal {"id":"abc-12345678","by":"u-mia","email":"a","path":"../x.md","kind":"edit","base":"' + 'a'.repeat(40) + '"} -->')).toBeNull()
  expect(parseMarker(null)).toBeNull()
})

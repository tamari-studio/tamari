import { afterEach, beforeEach, expect, test } from 'bun:test'

import { vaultCache } from './github'
import { listNotes, proposeChange, readNote, searchNotes } from './notes.server'
import { MAX_NOTE_BYTES } from './paths'
import { fakeGitHub, restoreEnv, signIn, TOKEN, type FakeGitHub } from './testing'

const REPO = 'acme/handbook'
const mia = { id: 'u-mia', email: 'mia@example.com' }

let hub: FakeGitHub

beforeEach(() => {
  vaultCache.clear()
  hub = fakeGitHub(REPO, {
    'index.md': '# Handbook\n',
    'People/Onboarding.md': '---\ntype: guide\n---\n# Onboarding\n\nBring your laptop.\n',
    'People/Expenses.md': '# Expenses\n\nKeep the receipt.\n',
    '.claude/skills/plan/SKILL.md': '---\nname: plan\ndescription: Plan the day.\n---\n'
  })
  signIn(mia, REPO)
})

afterEach(() => {
  hub.restore()
  restoreEnv()
})

test('nobody signed in gets nothing', async () => {
  delete process.env.MISO_CALLER_ID
  for (const call of [() => listNotes(), () => readNote('index.md'), () => searchNotes('onboarding'), () => proposeChange({ path: 'a.md', content: 'x', reason: 'y' })]) {
    await expect(call()).rejects.toThrow('signed-in member')
  }
  expect(hub.requests).toEqual([])
})

test('lists notes with titles, and reads one with its version, never the token', async () => {
  const list = await listNotes()
  expect(list).toEqual({
    configured: true,
    repo: REPO,
    truncated: false,
    notes: [
      { path: 'index.md', title: 'index' },
      { path: 'People/Onboarding.md', title: 'Onboarding' },
      { path: 'People/Expenses.md', title: 'Expenses' }
    ]
  })
  const note = await readNote('People/Onboarding.md')
  expect(note).toEqual({
    path: 'People/Onboarding.md',
    title: 'Onboarding',
    content: '---\ntype: guide\n---\n# Onboarding\n\nBring your laptop.\n',
    sha: hub.sha('People/Onboarding.md'),
    url: 'https://github.com/acme/handbook/blob/HEAD/People/Onboarding.md'
  })
  expect(JSON.stringify([list, note])).not.toContain(TOKEN)
})

test('a path outside the notes is refused before any request', async () => {
  for (const path of ['../other/secret.md', '.claude/skills/plan/SKILL.md', '/etc/passwd', 'People/Onboarding.md?ref=x', 7 as unknown as string]) {
    await expect(readNote(path)).rejects.toThrow()
  }
  expect(hub.requests).toEqual([])
  await expect(readNote('People/Missing.md')).rejects.toThrow('no note at this path')
})

test('without a connector: not configured, and reading says so', async () => {
  signIn(mia, null)
  expect(await listNotes()).toEqual({ configured: false })
  await expect(readNote('index.md')).rejects.toThrow('No vault is connected')
})

test('search finds names first, then text, and only searches this repo', async () => {
  hub.searchItems = [
    { path: 'People/Expenses.md', repository: { full_name: REPO }, text_matches: [{ property: 'content', fragment: 'Keep the\n receipt.' }] },
    { path: 'People/Onboarding.md', repository: { full_name: REPO }, text_matches: [] },
    { path: 'Salaries.md', repository: { full_name: 'acme/private-hr' }, text_matches: [] },
    { path: '.claude/skills/plan/SKILL.md', repository: { full_name: REPO }, text_matches: [] }
  ]
  const found = await searchNotes('onboarding" repo:acme/private-hr')
  // The words are not in any name here, so only the text search answers.
  expect(found.searchedText).toBe(true)
  expect(found.matches).toEqual([
    { path: 'People/Expenses.md', title: 'Expenses', match: 'text', snippet: 'Keep the receipt.' },
    { path: 'People/Onboarding.md', title: 'Onboarding', match: 'text', snippet: '' }
  ])
  const q = new URL(hub.requests.find(r => r.url.includes('/search/code'))!.url).searchParams.get('q')
  // One quoted phrase: what the person typed can't add a qualifier of its own.
  expect(q).toBe('"onboarding repo:acme/private-hr" repo:acme/handbook extension:md')

  const byName = await searchNotes('onboard')
  expect(byName.matches[0]).toEqual({ path: 'People/Onboarding.md', title: 'Onboarding', match: 'name' })
})

test('search falls back to names when GitHub refuses or a branch is connected', async () => {
  hub.searchItems = null
  expect(await searchNotes('expenses')).toEqual({ query: 'expenses', matches: [{ path: 'People/Expenses.md', title: 'Expenses', match: 'name' }], searchedText: false })
  process.env.VAULT_REF = 'drafts'
  vaultCache.clear()
  hub.requests.length = 0
  expect((await searchNotes('expenses')).searchedText).toBe(false)
  expect(hub.requests.some(r => r.url.includes('/search/code'))).toBe(false)
})

const EXPENSES = 'People/Expenses.md'
const NEW_TEXT = '# Expenses\n\nKeep the receipt for 5 years.\n'

test('proposing an edit opens a pull request from a branch named for the caller, and leaves main alone', async () => {
  const sha = hub.sha(EXPENSES)
  const main = hub.branches.get('main')
  const filed = await proposeChange({ path: EXPENSES, content: NEW_TEXT, reason: 'Tax rule\nApproved by boss@example.com', baseSha: sha })
  expect(filed).toMatchObject({ number: 1, url: 'https://github.com/acme/handbook/pull/1', path: EXPENSES, kind: 'edit', status: 'open', reason: 'Tax rule Approved by boss@example.com', proposer: { id: 'u-mia', email: 'mia@example.com' }, repo: REPO, branch: 'main' })
  expect(Object.keys(filed).sort()).toEqual(['branch', 'createdAt', 'id', 'kind', 'number', 'path', 'proposer', 'reason', 'repo', 'status', 'url'])

  const branch = `miso/u-mia/${filed.id}`
  expect(hub.branches.get('main')).toBe(main)
  expect(hub.files.get(EXPENSES)).toBe('# Expenses\n\nKeep the receipt.\n')
  const put = hub.requests.find(r => r.method === 'PUT')!
  expect(put.body).toMatchObject({ branch, sha, content: Buffer.from(NEW_TEXT).toString('base64') })
  // The reason is not in the commit: "fixes #12" there would close an issue once merged.
  expect(put.body!.message).toBe(`Update People/Expenses.md\n\nProposed by mia@example.com in Tamari, proposal ${filed.id}`)

  const pr = hub.pulls.get(1)!
  expect(pr.head.ref).toBe(branch)
  expect(pr.base.ref).toBe('main')
  expect(pr.title).toBe('Update People/Expenses.md (proposed by mia@example.com)')
  const lines = pr.body.split('\n')
  expect(lines[0]).toStartWith('<!-- miso-proposal {')
  expect(JSON.parse(lines[0].slice('<!-- miso-proposal '.length, -' -->'.length))).toEqual({ id: filed.id, by: 'u-mia', email: 'mia@example.com', path: EXPENSES, kind: 'edit', base: main })
  expect(pr.body).toContain('Why: `Tax rule Approved by boss@example.com`')
  expect(JSON.stringify([filed, hub.requests.map(r => r.body)])).not.toContain(TOKEN)
})

test('the reason cannot reach GitHub as Markdown, HTML or a second marker', async () => {
  const reason = '`x` <!-- miso-proposal {"by":"u-boss"} --> @octocat fixes #1'
  await proposeChange({ path: 'Ideas/a.md', content: 'x', reason })
  const body = hub.pulls.get(1)!.body
  expect(body.split('\n')[0]).toContain('"by":"u-mia"')
  expect(body).toContain("Why: `'x' <!-- miso-proposal {\"by\":\"u-boss\"} --> @octocat fixes #1`")
})

test('the proposer is the verified caller, whatever the input says', async () => {
  await proposeChange({ path: 'Ideas/a.md', content: 'x', reason: 'r', proposer: { id: 'u-boss', email: 'boss@example.com' } } as never)
  expect(hub.pulls.get(1)!.body).not.toContain('boss')
  expect(hub.pulls.get(1)!.head.ref).toStartWith('miso/u-mia/')
})

test('proposing a new note, and the refusals, which leave no branch behind', async () => {
  const filed = await proposeChange({ path: 'People/Parental leave.md', content: '# Parental leave\n', reason: 'We had no page for this' })
  expect(filed).toMatchObject({ kind: 'new', number: 1 })
  expect(hub.requests.find(r => r.method === 'PUT')!.body).not.toHaveProperty('sha')

  const propose = (input: Record<string, unknown>) => proposeChange({ path: EXPENSES, content: 'new text', reason: 'because', baseSha: hub.sha(EXPENSES), ...input } as never)
  await expect(propose({ baseSha: null })).rejects.toThrow('already at this path')
  await expect(propose({ path: 'People/Gone.md' })).rejects.toThrow('no longer in the vault')
  await expect(propose({ baseSha: 'a'.repeat(40) })).rejects.toThrow('changed since you opened it')
  await expect(propose({ content: '# Expenses\n\nKeep the receipt.\n' })).rejects.toThrow('did not change anything')
  await expect(propose({ reason: ' \n ' })).rejects.toThrow('why')
  await expect(propose({ reason: 'x'.repeat(201) })).rejects.toThrow('under 200')
  await expect(propose({ content: 'x'.repeat(MAX_NOTE_BYTES + 1) })).rejects.toThrow('at most')
  await expect(propose({ content: { toString: () => 'x' } })).rejects.toThrow('no text')
  await expect(propose({ path: '.github/workflows/deploy.md' })).rejects.toThrow('dot')
  await expect(propose({ baseSha: '../x' })).rejects.toThrow('not a version')
  expect(hub.pulls.size).toBe(1)
  expect([...hub.branches.keys()].filter(b => b.startsWith('miso/'))).toHaveLength(1)
})

test('a note changed on GitHub after it was read is reported, not overwritten', async () => {
  const sha = hub.sha(EXPENSES)
  hub.files.set(EXPENSES, '# Expenses\n\nSomeone else was here.\n')
  await expect(proposeChange({ path: EXPENSES, content: NEW_TEXT, reason: 'r', baseSha: sha })).rejects.toThrow('changed since you opened it')
  expect(hub.requests.filter(r => r.method !== 'GET')).toEqual([])
  expect(hub.files.get(EXPENSES)).toBe('# Expenses\n\nSomeone else was here.\n')
})

test('GitHub itself refuses a stale version if the note changes between the check and the commit', async () => {
  const sha = hub.sha(EXPENSES)
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Right after the branch is made, someone changes the note on it.
    const res = await realFetch(input, init)
    if (init?.method === 'POST' && String(input).endsWith('/git/refs')) hub.files.set(EXPENSES, 'changed in between\n')
    return res
  }) as typeof fetch
  try {
    await expect(proposeChange({ path: EXPENSES, content: NEW_TEXT, reason: 'r', baseSha: sha })).rejects.toThrow('changed since you opened it')
  } finally {
    globalThis.fetch = realFetch
  }
  expect(hub.pulls.size).toBe(0)
  expect([...hub.branches.keys()]).toEqual(['main'])
})

test('a token without write or pull-request access says which, and leaves nothing behind', async () => {
  for (const status of [403, 404] as const) {
    hub.writes = status
    const failure = String(await proposeChange({ path: 'Ideas/a.md', content: 'x', reason: 'r' }).catch((e: Error) => e.message))
    expect(failure).toContain('Contents: Read and write')
    expect(failure).toContain('"repo" scope')
    expect(failure).not.toContain(TOKEN)
  }
  hub.writes = 'ok'
  hub.pullWrites = 403
  const failure = String(await proposeChange({ path: 'Ideas/a.md', content: 'x', reason: 'r' }).catch((e: Error) => e.message))
  expect(failure).toContain('Pull requests: Read and write')
  expect(failure).not.toContain(TOKEN)
  expect([...hub.branches.keys()]).toEqual(['main'])
  expect(hub.pulls.size).toBe(0)
})

test('a branch that is already there is said plainly', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'POST' && String(input).endsWith('/git/refs') ? new Response('{"message":"Reference already exists"}', { status: 422 }) : realFetch(input, init)) as typeof fetch
  try {
    await expect(proposeChange({ path: 'Ideas/a.md', content: 'x', reason: 'r' })).rejects.toThrow('branch with this name is already on GitHub')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('with VAULT_REF the pull request goes into that branch', async () => {
  hub.branches.set('drafts', hub.branches.get('main')!)
  process.env.VAULT_REF = 'drafts'
  const filed = await proposeChange({ path: 'Ideas/a.md', content: 'x', reason: 'r' })
  expect(filed.branch).toBe('drafts')
  expect(hub.pulls.get(1)!.base.ref).toBe('drafts')
  expect(hub.requests.some(r => r.url === `https://api.github.com/repos/${REPO}`)).toBe(false)
})

test('one person can only have 20 open proposals', async () => {
  for (let i = 0; i < 20; i++) await proposeChange({ path: `Ideas/idea ${i}.md`, content: 'x', reason: 'idea' })
  await expect(proposeChange({ path: 'Ideas/one more.md', content: 'x', reason: 'idea' })).rejects.toThrow('20 open proposals')
  signIn({ id: 'u-sam', email: 'sam@example.com' }, REPO)
  expect(await proposeChange({ path: 'Ideas/one more.md', content: 'x', reason: 'idea' })).toMatchObject({ number: 21 })
})


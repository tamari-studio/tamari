// Test helpers: a made-up vault repo (commits, branches, pull requests) behind a mocked `fetch`.
// Nothing here reaches GitHub or Supabase.
import { createHash } from 'node:crypto'

export const TOKEN = 'ghp_test_token_never_shown'

const blobSha = (content: string) => createHash('sha1').update(content).digest('hex')

interface FakePull {
  number: number
  state: 'open' | 'closed'
  title: string
  body: string
  html_url: string
  created_at: string
  closed_at: string | null
  merged_at: string | null
  mergeable: boolean | null
  head: { ref: string; sha: string; repo: { full_name: string } | null }
  base: { ref: string; repo: { full_name: string } }
}

export interface FakeGitHub {
  /** The notes on main now. Setting one is someone else changing main on GitHub. */
  files: Map<string, string>
  /** Branch name to commit sha. */
  branches: Map<string, string>
  pulls: Map<number, FakePull>
  /** How the repo answers a write to contents or branches: it saves, or the token may not write (403 fine-grained, 404 classic). */
  writes: 'ok' | 403 | 404
  /** How it answers opening a pull request: it opens, or the token has no pull-request access. */
  pullWrites: 'ok' | 403
  /** What code search answers; null makes it refuse (rate limit). */
  searchItems: unknown[] | null
  requests: { method: string; url: string; body: Record<string, unknown> | null }[]
  sha(path: string): string
  /** A developer merges pull request `number` on GitHub. */
  merge(number: number): void
  /** A pull request someone opened by hand, or from a fork. */
  addPull(pull: Partial<FakePull> & { head: FakePull['head'] }): number
  restore(): void
}

export function fakeGitHub(repo: string, initial: Record<string, string>): FakeGitHub {
  const commits = new Map<string, Map<string, string>>()
  let count = 0
  const commit = (files: Map<string, string>) => {
    const sha = createHash('sha1').update(`commit ${++count}`).digest('hex')
    commits.set(sha, files)
    return sha
  }
  const branches = new Map([['main', commit(new Map(Object.entries(initial)))]])
  const pulls = new Map<number, FakePull>()
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const at = (ref: string) => commits.get(branches.get(ref === 'HEAD' ? 'main' : ref) ?? ref)
  const realFetch = globalThis.fetch
  const now = () => new Date('2026-11-23T10:00:00Z').toISOString()

  const state: FakeGitHub = {
    get files() {
      return commits.get(branches.get('main')!)!
    },
    branches,
    pulls,
    writes: 'ok',
    pullWrites: 'ok',
    searchItems: [],
    requests: [],
    sha: path => blobSha(state.files.get(path) ?? ''),
    merge(number) {
      const pr = pulls.get(number)!
      branches.set(pr.base.ref, commit(new Map(commits.get(pr.head.sha))))
      Object.assign(pr, { state: 'closed', merged_at: now(), closed_at: now() })
    },
    addPull(pull) {
      const number = pulls.size + 1
      pulls.set(number, { number, state: 'open', title: 'x', body: '', html_url: `https://github.com/${repo}/pull/${number}`, created_at: now(), closed_at: null, merged_at: null, mergeable: true, base: { ref: 'main', repo: { full_name: repo } }, ...pull })
      return number
    },
    restore: () => void (globalThis.fetch = realFetch)
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    state.requests.push({ method, url: url.href, body })
    if (url.pathname === '/search/code') return state.searchItems ? json({ items: state.searchItems }) : json({ message: 'rate limited' }, 403)
    if (url.pathname === `/repos/${repo}`) return json({ full_name: repo, default_branch: 'main' })
    const prefix = `/repos/${repo}/`
    if (!url.pathname.startsWith(prefix)) return json({ message: 'Not Found' }, 404)
    const rest = decodeURIComponent(url.pathname.slice(prefix.length))
    const forbidden = () => json({ message: 'Resource not accessible by personal access token' }, state.writes as number)

    if (rest.startsWith('git/trees/')) return json({ tree: [...(at(rest.slice('git/trees/'.length)) ?? new Map()).keys()].map(path => ({ path, type: 'blob' })), truncated: false })
    if (rest.startsWith('git/ref/heads/') && method === 'GET') {
      const sha = branches.get(rest.slice('git/ref/heads/'.length))
      return sha ? json({ object: { sha } }) : json({ message: 'Not Found' }, 404)
    }
    if (rest === 'git/refs' && method === 'POST') {
      if (state.writes !== 'ok') return forbidden()
      const name = String(body?.ref).replace(/^refs\/heads\//, '')
      if (branches.has(name)) return json({ message: 'Reference already exists' }, 422)
      branches.set(name, String(body?.sha))
      return json({ ref: body?.ref }, 201)
    }
    if (rest.startsWith('git/refs/heads/') && method === 'DELETE') {
      if (state.writes !== 'ok') return forbidden()
      return branches.delete(rest.slice('git/refs/heads/'.length)) ? new Response(null, { status: 204 }) : json({ message: 'Reference does not exist' }, 422)
    }

    if (rest.startsWith('contents/')) {
      const path = rest.slice('contents/'.length)
      if (method === 'GET') {
        const current = at(url.searchParams.get('ref') ?? 'HEAD')?.get(path)
        if (current === undefined) return json({ message: 'Not Found' }, 404)
        return json({ type: 'file', sha: blobSha(current), size: Buffer.byteLength(current), encoding: 'base64', content: Buffer.from(current).toString('base64') })
      }
      if (state.writes !== 'ok') return forbidden()
      const branch = String(body?.branch ?? 'main')
      const files = new Map(commits.get(branches.get(branch) ?? '') ?? [])
      const current = files.get(path)
      if (current !== undefined && !body?.sha) return json({ message: '"sha" wasn\'t supplied.' }, 422)
      if (current !== undefined && body?.sha !== blobSha(current)) return json({ message: 'is at another sha' }, 409)
      files.set(path, Buffer.from(String(body?.content), 'base64').toString('utf8'))
      branches.set(branch, commit(files))
      return json({ content: { sha: blobSha(files.get(path)!) }, commit: { sha: branches.get(branch) } }, current === undefined ? 201 : 200)
    }

    if (rest === 'pulls' && method === 'POST') {
      if (state.pullWrites !== 'ok') return json({ message: 'Resource not accessible by personal access token' }, state.pullWrites)
      const head = String(body?.head)
      if (!branches.has(head)) return json({ message: 'Validation Failed' }, 422)
      const number = state.addPull({ title: String(body?.title), body: String(body?.body), base: { ref: String(body?.base), repo: { full_name: repo } }, head: { ref: head, sha: branches.get(head)!, repo: { full_name: repo } } })
      return json(pulls.get(number), 201)
    }
    if (rest === 'pulls' && method === 'GET') {
      const want = url.searchParams.get('state')
      const base = url.searchParams.get('base')
      return json([...pulls.values()].filter(p => p.state === want && (!base || p.base.ref === base)).sort((a, b) => b.number - a.number))
    }
    const one = /^pulls\/(\d+)$/.exec(rest)
    if (one) {
      const pr = pulls.get(Number(one[1]))
      if (!pr) return json({ message: 'Not Found' }, 404)
      if (method === 'PATCH') Object.assign(pr, { state: body?.state ?? pr.state, closed_at: now() })
      return json(pr)
    }
    return json({ message: 'Not Found' }, 404)
  }) as typeof fetch
  return state
}

/** Signs a member in for the rest of the test. Pair with `restoreEnv` in afterEach. */
export function signIn(who: { id: string; email: string }, repo: string | null): void {
  process.env.MISO_CALLER_ID = who.id
  process.env.MISO_CALLER_EMAIL = who.email
  if (repo) {
    process.env.VAULT_REPO = repo
    process.env.VAULT_TOKEN = TOKEN
  } else {
    delete process.env.VAULT_REPO
    delete process.env.VAULT_TOKEN
  }
  delete process.env.VAULT_REF
}

const saved = { ...process.env }
export function restoreEnv(): void {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
}

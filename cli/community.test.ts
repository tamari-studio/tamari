// community/ (community/README.md): the spaces other teams can try, working ones and blueprints,
// and `miso template add <name> --community`.
//
// The spaces came out of one company's own workspace, so the first job of this file is to keep
// that company, its secrets and its data out: it fails on a `.env` file, a key-like string, or the
// company's name anywhere in `community/`. The rest checks each space's shape, that it installs,
// that it type-checks against this shell (the test that decides whether a space may be shared at
// all), and that the working ones pass their own tests. `bun test` does not look inside dot
// folders such as `.miso`, so the tests of a space run here in a child process: a space's
// `mock.module` must not leak into the other test files.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { COMMUNITY, findTarget, listTemplates, main, type Target } from './template'

const ROOT = join(import.meta.dir, '..')
const COMMENT = 'The spaces this app shows.'

const names = readdirSync(COMMUNITY, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()
const spaceDir = (name: string) => join(COMMUNITY, name)
/** A blueprint is an empty draft with a spec; anything else is a working space. */
const isBlueprint = (name: string) => existsSync(join(spaceDir(name), 'SPACE.md'))
/** Packages of its own: it type-checks and tests only after `bun install` in its .miso folder. */
const hasPackages = (name: string) => existsSync(join(spaceDir(name), '.miso', 'package.json'))
const installed = (name: string) => !hasPackages(name) || existsSync(join(spaceDir(name), '.miso', 'node_modules'))

function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap(name => {
    if (name === 'node_modules') return []
    const path = rel ? `${rel}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path]
  })
}

const allFiles = walk(COMMUNITY)
const BINARY = /\.(png|jpe?g|webp|gif|ico|woff2?|pdf|zip)$/i
const textFiles = allFiles.filter(file => !BINARY.test(file))

describe('what must never be in community/', () => {
  test('there are spaces to check', () => {
    expect(names.length).toBeGreaterThanOrEqual(10)
    expect(textFiles.length).toBeGreaterThan(30)
  })

  test('no secret file, no folder of someone else\'s agent', () => {
    const bad = allFiles.filter(file => {
      const base = file.split('/').pop()!
      return /^\.env/.test(base) || /\.env$/.test(base) || file.split('/').includes('.claude')
    })
    expect(bad).toEqual([])
  })

  // A named setting goes on the Connectors page. A value in a file is a leak.
  const SECRETS: [string, RegExp][] = [
    ['an Anthropic or OpenAI-style key', /\bsk-(ant-)?[A-Za-z0-9_-]{16,}/],
    ['a GitHub token', /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}/],
    ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
    ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
    ['a JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/],
    ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['a Supabase or database url with a password', /\b(postgres(ql)?|mysql|mongodb(\+srv)?):\/\/[^\s:@/]+:[^\s@/]+@/i]
  ]
  test.each(SECRETS)('no key-like string: %s', (_what, pattern) => {
    const hits = textFiles.filter(file => pattern.test(readFileSync(join(COMMUNITY, file), 'utf8')))
    expect(hits).toEqual([])
  })

  // The company the spaces came from, in any spelling, in any file (also in tests and fixtures).
  const COMPANY = /tech(no)?[\s_-]?bbq/i
  test('the name of the company the spaces came from does not appear', () => {
    const hits = allFiles.filter(file => COMPANY.test(file) || (!BINARY.test(file) && COMPANY.test(readFileSync(join(COMMUNITY, file), 'utf8'))))
    expect(hits).toEqual([])
  })

  test('every address in a file is at an invented domain', () => {
    const REAL = /[A-Za-z0-9._%+-]+@(?![-.]|example\.|[a-z0-9-]*\.example\b|acme|mailinator\.com|x\.|y\.|a\.|b\.|c\.)[A-Za-z0-9-]+\.(com|org|net|io|dk|co|eu|ai)\b/i
    const hits = textFiles.filter(file => !file.endsWith('_bounce-lists.ts') && REAL.test(readFileSync(join(COMMUNITY, file), 'utf8')))
    expect(hits).toEqual([])
  })

  test('code imports only what this shell has', () => {
    // The company's own database layer (@miso/dto-core/queries and the like) and its campaign
    // package are not in this repo: a space that needs them cannot be installed here.
    const ALLOWED = new Set(['@miso/caller', '@miso/store', '@miso/dto-core/session', '@miso/dto-core/tier'])
    const bad = textFiles
      .filter(file => /\.tsx?$/.test(file))
      .flatMap(file => [...readFileSync(join(COMMUNITY, file), 'utf8').matchAll(/from\s+['"](@miso\/[^'"]+)['"]/g)].map(m => ({ file, from: m[1]! })))
      .filter(({ from }) => !ALLOWED.has(from))
    expect(bad).toEqual([])
  })
})

describe('the community spaces', () => {
  const all = listTemplates(COMMUNITY, true)

  test('every folder is a space with a title, a space name and its job', () => {
    expect(all.map(t => t.type)).toEqual(names)
    for (const t of all) {
      expect(t.title.length).toBeGreaterThan(2)
      expect(t.space.length).toBeGreaterThan(2)
      expect(t.job.length).toBeGreaterThan(20)
      expect(t.notes).toEqual([])
    }
  })

  test('each has a .workspace.json with a name and nothing else', () => {
    for (const name of names) {
      expect(JSON.parse(readFileSync(join(spaceDir(name), '.miso', '.workspace.json'), 'utf8'))).toEqual({ name: expect.any(String) })
    }
  })

  test('there are 3 working spaces and 8 blueprints', () => {
    expect(names.filter(name => !isBlueprint(name))).toEqual(['email-checker', 'newsletter', 'pr-writer'])
    expect(names.filter(isBlueprint)).toEqual(['budget', 'floorplan', 'funding', 'handbook', 'kpi-board', 'my-day', 'outreach', 'roadmap'])
  })

  test('a blueprint is one page that uses the kit, and a spec with the parts an agent needs', () => {
    for (const name of names.filter(isBlueprint)) {
      const views = readdirSync(join(spaceDir(name), '.miso', 'views'))
      expect(views).toEqual([`${name}.tsx`])
      expect(readFileSync(join(spaceDir(name), '.miso', 'views', views[0]!), 'utf8')).toContain('<Empty')
      expect(existsSync(join(spaceDir(name), '.miso', 'ui', 'kit.tsx'))).toBe(true)
      const spec = readFileSync(join(spaceDir(name), 'SPACE.md'), 'utf8')
      for (const heading of ['## Who uses it', '## Views', '## Widgets', '## Data', '## Server functions', '## Connectors', '## Acceptance checks', '## Out of scope']) {
        expect({ name, heading, has: spec.includes(heading) }).toEqual({ name, heading, has: true })
      }
      expect(spec.startsWith('# ')).toBe(true)
      expect(spec.split('\n').length).toBeGreaterThan(50)
    }
  })

  test('a working space has a page, and tests of its own', () => {
    for (const name of names.filter(name => !isBlueprint(name))) {
      const files = walk(join(spaceDir(name), '.miso'))
      expect(files.some(f => /^views\/[^_][^/]*\.tsx$/.test(f))).toBe(true)
      expect(files.filter(f => f.endsWith('.test.ts')).length).toBeGreaterThanOrEqual(3)
    }
  })

  test('the README lists every space once, ready ones and blueprints in their own lists', () => {
    const readme = readFileSync(join(COMMUNITY, 'README.md'), 'utf8')
    const at = readme.indexOf('## Blueprints')
    const ready = readme.slice(readme.indexOf('## Ready to use'), at)
    const blueprints = readme.slice(at, readme.indexOf('## What is checked'))
    const listed = (text: string) => [...text.matchAll(/^- `([a-z0-9-]+)`:/gm)].map(m => m[1]!).sort()
    expect(listed(ready)).toEqual(names.filter(name => !isBlueprint(name)))
    expect(listed(blueprints)).toEqual(names.filter(isBlueprint))
  })
})

/** A new clone: one space, spaces.json with its comment. */
function clone(): Target {
  const root = mkdtempSync(join(tmpdir(), 'miso-community-'))
  mkdirSync(join(root, 'workspaces', 'miso', '.miso', 'views'), { recursive: true })
  writeFileSync(join(root, 'workspaces', 'miso', '.miso', 'views', 'home.tsx'), 'export default function Home() { return null }\n')
  writeFileSync(join(root, 'spaces.json'), `${JSON.stringify({ $comment: COMMENT, spaces: [{ folder: 'miso', id: 'miso', slug: 'miso' }] }, null, 2)}\n`)
  return findTarget(root)
}

describe('miso template add --community', () => {
  test('every space installs, without template.json, and is listed in spaces.json', () => {
    const target = clone()
    const lines: string[] = []
    for (const name of names) main(['add', name, '--community'], target.root, line => lines.push(line))
    const json = JSON.parse(readFileSync(target.file, 'utf8')) as { $comment: string; spaces: { folder: string; id: string; slug: string }[] }
    expect(json.$comment).toBe(COMMENT)
    expect(json.spaces.map(s => s.folder)).toEqual(['miso', ...names])
    for (const name of names) {
      const dest = join(target.spacesDir, name)
      expect(existsSync(join(dest, '.miso', '.workspace.json'))).toBe(true)
      expect(existsSync(join(dest, 'template.json'))).toBe(false)
      expect(existsSync(join(dest, 'SPACE.md'))).toBe(isBlueprint(name))
    }
    expect(lines.filter(line => line.includes('It is a blueprint'))).toHaveLength(names.filter(isBlueprint).length)
    expect(lines.join('\n')).not.toContain('Try it with examples')
  })

  test('it does not overwrite, and --as picks another folder', () => {
    const target = clone()
    main(['add', 'budget', '--community'], target.root, () => {})
    expect(() => main(['add', 'budget', '--community'], target.root, () => {})).toThrow(/already a space folder "budget"/)
    main(['add', 'budget', '--community', '--as', 'family-budget'], target.root, () => {})
    expect(existsSync(join(target.spacesDir, 'family-budget', 'SPACE.md'))).toBe(true)
  })

  test('a name that is only a starter template is not a community space, and the other way round', () => {
    const target = clone()
    expect(() => main(['add', 'agency', '--community'], target.root, () => {})).toThrow(/No community space "agency"/)
    expect(() => main(['add', 'budget'], target.root, () => {})).toThrow(/No starter template "budget"/)
    expect(() => main(['add', 'budget', '--community', '--vault', '.'], target.root, () => {})).toThrow(/--vault does not go with --community/)
  })

  test('list --community names every space', () => {
    const lines: string[] = []
    main(['list', '--community'], ROOT, line => lines.push(line))
    for (const name of names) expect(lines.some(line => line.startsWith(name))).toBe(true)
    expect(lines.at(-1)).toContain('--community')
  })
})

describe('they work in this shell', () => {
  test('the spaces that need nothing but the shell type-check', () => {
    const tsc = (...args: string[]) => Bun.spawnSync([process.execPath, 'x', 'tsc', '--noEmit', '-p', 'community', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    const listed = tsc('--listFilesOnly').stdout.toString()
    for (const name of names.filter(name => !hasPackages(name))) expect(listed).toContain(`/community/${name}/.miso/views/`)
    const run = tsc()
    expect(run.stdout.toString() + run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
  }, 120_000)

  const withPackages = names.filter(hasPackages)
  const ready = withPackages.every(installed)
  test.skipIf(!ready)('the spaces with packages of their own type-check (after bun install in their .miso)', () => {
    const run = Bun.spawnSync([process.execPath, 'x', 'tsc', '--noEmit', '-p', 'community/tsconfig.deps.json'], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    expect(run.stdout.toString() + run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
  }, 120_000)

  for (const name of names.filter(name => !isBlueprint(name))) {
    test.skipIf(!installed(name))(`${name}: its own tests pass`, () => {
      const files = walk(join(spaceDir(name), '.miso'))
        .filter(f => f.endsWith('.test.ts'))
        .map(f => `./${relative(ROOT, join(spaceDir(name), '.miso', f))}`)
      const run = Bun.spawnSync([process.execPath, 'test', ...files], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
      expect({ name, exit: run.exitCode, out: run.exitCode === 0 ? '' : run.stdout.toString() + run.stderr.toString() }).toEqual({ name, exit: 0, out: '' })
    }, 120_000)
  }
})

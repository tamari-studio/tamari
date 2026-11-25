import { describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configText, parseConfig, withVersion } from './org'
import { cloneShell, gitAuthArgs } from './shell'
import { copySpaces, prepareVercel, WORKFLOW, writeWorkflow } from './vercel'

describe('runtime', () => {
  const base = { name: 'acme', title: 'Acme', shell: 'tamari-studio/tamari', version: 'v0.2.0', port: 13410, supabase: '' }

  test('runtime defaults to local, so an existing miso.yaml does not change', () => {
    const text = configText({ ...base, runtime: 'local' })
    expect(text).not.toContain('runtime')
    expect(parseConfig(text).runtime).toBe('local')
  })

  test('vercel is written, read back and kept when the pin moves', () => {
    const text = configText({ ...base, runtime: 'vercel' })
    expect(text).toContain('runtime: vercel')
    expect(parseConfig(text).runtime).toBe('vercel')
    const next = withVersion(text, 'v0.3.0')
    expect(parseConfig(next)).toEqual({ ...base, version: 'v0.3.0', runtime: 'vercel' })
  })

  test('any other runtime is refused', () => {
    expect(() => parseConfig(configText({ ...base, runtime: 'local' }) + 'runtime: fly\n')).toThrow('runtime')
  })
})

describe('private shell repo', () => {
  test('no token, no auth arguments', () => {
    expect(gitAuthArgs(undefined)).toEqual([])
    expect(gitAuthArgs('')).toEqual([])
  })

  test('a token becomes a basic-auth header for github.com only', () => {
    const [flag, value] = gitAuthArgs('tok_123')
    expect(flag).toBe('-c')
    expect(value).toBe(`http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from('x-access-token:tok_123').toString('base64')}`)
    expect(value).not.toContain('tok_123')
  })

  test('a failed clone never prints the token', () => {
    const saved = process.env.MISO_SHELL_TOKEN
    try {
      process.env.MISO_SHELL_TOKEN = 'tok_secret_456'
      let message = ''
      try {
        cloneShell(join(tmpdir(), 'miso-no-such-repo'), 'v9.9.9', join(mkdtempSync(join(tmpdir(), 'miso-dest-')), 'x'))
      } catch (err) {
        message = String(err)
      }
      expect(message).toContain('failed')
      expect(message).not.toContain('tok_secret_456')
      expect(message).not.toContain(Buffer.from('x-access-token:tok_secret_456').toString('base64'))
    } finally {
      if (saved === undefined) delete process.env.MISO_SHELL_TOKEN
      else process.env.MISO_SHELL_TOKEN = saved
    }
  })
})

describe('vercel runtime', () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(['git', '-c', 'user.name=t', '-c', 'user.email=t@example.test', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
    if (!r.success) throw new Error(r.stderr.toString())
  }

  /** A shell repo with one release tag, and an org repo that pins it and holds one space. */
  function fixture(opts: { vercelJson?: boolean } = {}) {
    const shell = mkdtempSync(join(tmpdir(), 'miso-shell-'))
    git(shell, 'init', '-q')
    mkdirSync(join(shell, 'workspaces', 'starter'), { recursive: true })
    writeFileSync(join(shell, 'workspaces', 'starter', 'a.txt'), 'the shell starter space')
    writeFileSync(join(shell, 'spaces.json'), '{"spaces":[{"id":"starter","folder":"starter"}]}')
    if (opts.vercelJson !== false) writeFileSync(join(shell, 'vercel.json'), '{}')
    git(shell, 'add', '-A')
    git(shell, 'commit', '-q', '-m', 'shell')
    git(shell, 'tag', 'v1.0.0')

    const root = mkdtempSync(join(tmpdir(), 'miso-org-'))
    mkdirSync(join(root, '.miso', 'spaces', 'sales', '.miso', 'node_modules'), { recursive: true })
    writeFileSync(join(root, '.miso', 'spaces', 'spaces.json'), '{"spaces":[{"id":"sales","folder":"sales"}]}')
    writeFileSync(join(root, '.miso', 'spaces', 'sales', '.miso', 'view.tsx'), 'the org space')
    writeFileSync(join(root, '.miso', 'spaces', 'sales', '.miso', 'node_modules', 'big.js'), 'installed on a Mac')
    writeFileSync(join(root, '.miso', 'spaces', 'sales', '.env'), 'SECRET=1')
    const config = { name: 'acme', title: 'Acme', shell, version: 'v1.0.0', port: 13410, supabase: '', runtime: 'vercel' as const }
    writeFileSync(join(root, '.miso', 'miso.yaml'), configText(config))
    return { shell, root, org: { root, config } }
  }

  test('prepare clones the pinned tag and swaps in the org spaces as real files', () => {
    const { root, org } = fixture()
    const lines: string[] = []
    const dir = prepareVercel(org, { build: false }, l => lines.push(l))
    expect(dir).toBe(join(root, '.miso', 'vercel'))
    expect(lines.join('\n')).toContain('cloning')
    expect(readFileSync(join(dir, 'spaces.json'), 'utf8')).toContain('"sales"')
    expect(lstatSync(join(dir, 'workspaces')).isSymbolicLink()).toBe(false)
    expect(lstatSync(join(dir, 'spaces.json')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(dir, 'workspaces', 'sales', '.miso', 'view.tsx'), 'utf8')).toBe('the org space')
    // The shell's own starter space and the Mac-local files stay behind.
    expect(existsSync(join(dir, 'workspaces', 'starter'))).toBe(false)
    expect(existsSync(join(dir, 'workspaces', 'sales', '.miso', 'node_modules'))).toBe(false)
    expect(existsSync(join(dir, 'workspaces', 'sales', '.env'))).toBe(false)
  })

  test('a second run reuses the clone of the pinned tag', () => {
    const { org } = fixture()
    prepareVercel(org, { build: false }, () => {})
    const lines: string[] = []
    prepareVercel(org, { build: false }, l => lines.push(l))
    expect(lines.join('\n')).toContain('using the clone of v1.0.0')
  })

  test('it follows links in the spaces, so a space that links a shared folder carries it', () => {
    const { root, org } = fixture()
    const shared = mkdtempSync(join(tmpdir(), 'miso-shared-'))
    writeFileSync(join(shared, 'lib.ts'), 'shared code')
    symlinkSync(shared, join(root, '.miso', 'spaces', 'sales', 'shared'))
    const dir = prepareVercel(org, { build: false }, () => {})
    expect(lstatSync(join(dir, 'workspaces', 'sales', 'shared')).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(dir, 'workspaces', 'sales', 'shared', 'lib.ts'), 'utf8')).toBe('shared code')
  })

  test('it refuses an unpinned twin, a shell without a vercel.json, and spaces without spaces.json', () => {
    const { org } = fixture()
    expect(() => prepareVercel({ ...org, config: { ...org.config, version: 'none' } }, { build: false }, () => {})).toThrow('Pin a shell release')
    expect(() => prepareVercel(fixture({ vercelJson: false }).org, { build: false }, () => {})).toThrow('no vercel.json')
    const dest = mkdtempSync(join(tmpdir(), 'miso-dest-'))
    expect(() => copySpaces(mkdtempSync(join(tmpdir(), 'miso-empty-')), dest)).toThrow('spaces.json')
  })

  test('the deploy workflow is written once and never overwritten', () => {
    const root = mkdtempSync(join(tmpdir(), 'miso-flow-'))
    expect(writeWorkflow(root)).toBe(true)
    const file = join(root, WORKFLOW)
    expect(writeWorkflow(root)).toBe(false)
    writeFileSync(file, 'edited by the org')
    expect(writeWorkflow(root)).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('edited by the org')
  })

  test('the workflow template is valid YAML that names the secrets and the prepare step', () => {
    const root = mkdtempSync(join(tmpdir(), 'miso-flow-'))
    writeWorkflow(root)
    const text = readFileSync(join(root, WORKFLOW), 'utf8')
    const flow = Bun.YAML.parse(text) as { name: string; jobs: { deploy: { steps: { name?: string; run?: string }[] } } }
    expect(flow.name).toBe('Deploy')
    const runs = flow.jobs.deploy.steps.map(s => s.run ?? '').join('\n')
    expect(runs).toContain('miso.ts vercel prepare --build')
    for (const secret of ['MISO_SHELL_TOKEN', 'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']) expect(text).toContain(`secrets.${secret}`)
    // Production only gets its address after the new build has answered a request.
    expect(text).toContain('--skip-domain')
    expect(text).toContain(' promote ')
  })
})

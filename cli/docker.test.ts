import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeDockerFiles } from './docker'
import { configText, parseConfig, withVersion } from './org'

const base = { name: 'acme', title: 'Acme', shell: 'tamari-studio/tamari', version: 'v0.3.0', port: 13410, supabase: '' }
const dockerfile = readFileSync(join(import.meta.dir, 'templates', 'docker', 'Dockerfile'), 'utf8')
const dockerignore = readFileSync(join(import.meta.dir, 'templates', 'docker', 'dockerignore'), 'utf8')

describe('docker runtime', () => {
  test('docker is written, read back and kept when the pin moves', () => {
    const text = configText({ ...base, runtime: 'docker' })
    expect(text).toContain('runtime: docker')
    expect(parseConfig(text).runtime).toBe('docker')
    expect(parseConfig(withVersion(text, 'v0.4.0'))).toEqual({ ...base, version: 'v0.4.0', runtime: 'docker' })
  })

  test('the runtime error names all three', () => {
    expect(() => parseConfig(configText({ ...base, runtime: 'local' }) + 'runtime: swarm\n')).toThrow('`local`, `vercel` or `docker`')
  })

  test('the Dockerfile and .dockerignore are written once and never overwritten', () => {
    const root = mkdtempSync(join(tmpdir(), 'miso-docker-'))
    expect(writeDockerFiles(root)).toEqual({ wrote: ['Dockerfile', '.dockerignore'], kept: [] })
    writeFileSync(join(root, 'Dockerfile'), 'edited by the org')
    expect(writeDockerFiles(root)).toEqual({ wrote: [], kept: ['Dockerfile', '.dockerignore'] })
    expect(readFileSync(join(root, 'Dockerfile'), 'utf8')).toBe('edited by the org')
    expect(readFileSync(join(root, '.dockerignore'), 'utf8')).toBe(dockerignore)
  })
})

describe('the Dockerfile template', () => {
  test('serves on one port, on every address, as a plain user, and says when it is unhealthy', () => {
    expect(dockerfile).toContain('ENV PORT=13380 HOST=0.0.0.0')
    expect(dockerfile).toContain('EXPOSE 13380')
    expect(dockerfile).toContain('USER bun')
    expect(dockerfile).toContain('HEALTHCHECK')
    // Keys and schema, not only a configured env (app/server/app.ts).
    expect(dockerfile).toContain("'/api/health'")
    expect(dockerfile).toContain('CMD ["bun", "app/serve.ts"]')
  })

  test('reads the private shell with a build secret, never a build argument', () => {
    expect(dockerfile).toContain('--mount=type=secret,id=MISO_SHELL_TOKEN')
    expect(dockerfile).not.toMatch(/^ARG .*TOKEN/m)
    expect(dockerfile).not.toMatch(/^ENV .*TOKEN/m)
  })

  test('takes a local shell through a named build context, empty by default', () => {
    expect(dockerfile).toContain('FROM scratch AS shell-source')
    expect(dockerfile).toContain('COPY --from=shell-source / /shell-source/')
  })

  test('holds no app key: those are environment variables of the container', () => {
    // Only the `...` placeholders of the usage comment; no value that looks like a key or an address.
    expect(dockerfile).not.toMatch(/SUPABASE_\w+=[A-Za-z0-9_:/-]{8,}/)
  })

  test('its sed lines read the repo and the pin from a miso.yaml with comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miso-sed-'))
    mkdirSync(join(dir, '.miso'))
    writeFileSync(join(dir, '.miso', 'miso.yaml'), configText({ ...base, runtime: 'docker' }))
    const line = (name: string) => dockerfile.split('\n').find(l => l.startsWith(`${name}=$(sed`))!
    const run = (name: string) => {
      const out = Bun.spawnSync(['sh', '-c', `${line(name)}; printf %s "$${name}"`], { cwd: dir, stdout: 'pipe' })
      return out.stdout.toString()
    }
    expect(run('repo')).toBe('tamari-studio/tamari')
    expect(run('tag')).toBe('v0.3.0')
  })
})

describe('the .dockerignore template', () => {
  test('keeps keys, installs, and the Mac-local shell out of the build', () => {
    const lines = dockerignore.split('\n')
    for (const pattern of ['.env', '.env.*', '**/.env', '**/.env.*', '.miso/shell', '.miso/vercel', '**/node_modules', '.git']) expect(lines).toContain(pattern)
    // The spaces and the pin are what the build needs.
    expect(lines).not.toContain('.miso')
    expect(lines).not.toContain('.miso/spaces')
    expect(lines).not.toContain('.miso/miso.yaml')
  })
})

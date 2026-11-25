import { describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyPending, applySql, decodeKeychainToken, isMissingLedger, LEDGER_DDL, planMigrations, readLedger, type MigrationFile } from './migrate'
import { addDesignRules, configText, DESIGN_HEADING, findOrgRoot, parseConfig, withVersion } from './org'
import { cloneShell, gitAuthArgs, plist, repoUrl, sortTags } from './shell'
import { copySpaces, prepareVercel, WORKFLOW, writeWorkflow } from './vercel'

const file = (source: 'shell' | 'org', filename: string, sha256 = 'h-' + filename): MigrationFile => ({ source, filename, sha256, sql: `select '${filename}'` })

describe('org config', () => {
  const good = configText({ name: 'acme', title: 'Acme', shell: 'tamari-studio/tamari', version: 'v0.1.0', port: 13400, supabase: 'abcdefghijklmnopqrst', runtime: 'local' })

  test('round-trips through configText and parseConfig', () => {
    expect(parseConfig(good)).toEqual({ name: 'acme', title: 'Acme', shell: 'tamari-studio/tamari', version: 'v0.1.0', port: 13400, supabase: 'abcdefghijklmnopqrst', runtime: 'local' })
  })

  test('rejects a bad name, port or project ref', () => {
    expect(() => parseConfig(good.replace('name: acme', 'name: Twin Ton'))).toThrow('name')
    expect(() => parseConfig(good.replace('port: 13400', 'port: 80'))).toThrow('port')
    expect(() => parseConfig(good.replace('abcdefghijklmnopqrst', 'https://x.supabase.co'))).toThrow('supabase')
  })

  test('an empty supabase is allowed (no database)', () => {
    expect(parseConfig(good.replace(/^supabase:.*$/m, 'supabase:')).supabase).toBe('')
  })

  test('withVersion moves only the pin and keeps comments', () => {
    const next = withVersion(good, 'v0.2.0')
    expect(parseConfig(next).version).toBe('v0.2.0')
    expect(next.split('\n').length).toBe(good.split('\n').length)
    expect(next).toContain('# LaunchAgent')
  })

  test('findOrgRoot walks up to the folder with .miso/miso.yaml', () => {
    const root = mkdtempSync(join(tmpdir(), 'miso-org-'))
    mkdirSync(join(root, '.miso'))
    writeFileSync(join(root, '.miso', 'miso.yaml'), good)
    mkdirSync(join(root, 'a', 'b'), { recursive: true })
    expect(findOrgRoot(join(root, 'a', 'b'))).toBe(root)
    expect(findOrgRoot(tmpdir())).toBeNull()
  })
})

describe('design rules in the org repo', () => {
  const org = () => mkdtempSync(join(tmpdir(), 'miso-design-'))
  const count = (text: string) => text.split(DESIGN_HEADING).length - 1

  test('appends once to an existing AGENTS.md and keeps what is there', () => {
    const root = org()
    writeFileSync(join(root, 'AGENTS.md'), '# Acme\n\nOur rules.\n')
    expect(addDesignRules(root)).toBe(true)
    expect(addDesignRules(root)).toBe(false)
    const text = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    expect(text.startsWith('# Acme\n\nOur rules.\n\n## Designing')).toBe(true)
    expect(count(text)).toBe(1)
  })

  test('writes into CLAUDE.md when only that exists', () => {
    const root = org()
    writeFileSync(join(root, 'CLAUDE.md'), '# Notes\n')
    addDesignRules(root)
    expect(existsSync(join(root, 'AGENTS.md'))).toBe(false)
    expect(count(readFileSync(join(root, 'CLAUDE.md'), 'utf8'))).toBe(1)
  })

  test('with neither, makes AGENTS.md and links CLAUDE.md to it', () => {
    const root = org()
    addDesignRules(root)
    expect(lstatSync(join(root, 'CLAUDE.md')).isSymbolicLink()).toBe(true)
    expect(count(readFileSync(join(root, 'CLAUDE.md'), 'utf8'))).toBe(1)
  })

  test('the pointer names a file the shell ships', () => {
    expect(existsSync(join(import.meta.dir, '..', 'docs', 'space-design.md'))).toBe(true)
    expect(existsSync(join(import.meta.dir, '..', 'template', 'spaces', 'agency', '.miso', 'ui', 'kit.tsx'))).toBe(true)
  })
})

describe('migrations', () => {
  test('plan sorts files into applied, pending and edited per source', () => {
    const files = [file('shell', '1.sql'), file('shell', '2.sql'), file('org', '1.sql', 'new')]
    const p = planMigrations(files, [
      { source: 'shell', filename: '1.sql', checksum: 'h-1.sql' },
      { source: 'org', filename: '1.sql', checksum: 'old' },
      { source: 'org', filename: 'gone.sql', checksum: 'x' }
    ])
    expect(p.applied.map(f => `${f.source}/${f.filename}`)).toEqual(['shell/1.sql'])
    expect(p.pending.map(f => `${f.source}/${f.filename}`)).toEqual(['shell/2.sql'])
    expect(p.edited).toEqual([{ source: 'org', filename: '1.sql' }])
    expect(p.missing).toEqual(['org/gone.sql'])
  })

  test('the same filename in shell and org are different migrations', () => {
    const p = planMigrations([file('shell', '1.sql'), file('org', '1.sql')], [{ source: 'shell', filename: '1.sql', checksum: 'h-1.sql' }])
    expect(p.pending.map(f => f.source)).toEqual(['org'])
  })

  test('applySql wraps the file and its ledger row in one transaction', () => {
    const sql = applySql({ ...file('org', "it's.sql"), sql: 'create table t (id int)' })
    expect(sql.startsWith('begin;\ncreate table t (id int)\n;\n')).toBe(true)
    expect(sql).toContain("values ('org', 'it''s.sql', 'h-it''s.sql');")
    expect(sql.endsWith('commit;')).toBe(true)
  })

  test('a database with no ledger yet reads as empty, other errors throw', async () => {
    expect(await readLedger(async () => { throw new Error('ERROR: 42P01: relation "public.miso_migrations" does not exist') })).toEqual([])
    expect(isMissingLedger(new Error('permission denied'))).toBe(false)
    await expect(readLedger(async () => { throw new Error('permission denied') })).rejects.toThrow('permission denied')
  })

  test('applyPending creates the ledger, runs in order and stops at the first failure', async () => {
    const sent: string[] = []
    const query = async (sql: string) => {
      sent.push(sql)
      if (sql.includes("'2.sql'")) throw new Error('boom')
      return []
    }
    const p = planMigrations([file('shell', '1.sql'), file('shell', '2.sql'), file('org', '3.sql')], [])
    await expect(applyPending(query, p, () => {})).rejects.toThrow('shell/2.sql failed')
    expect(sent[0]).toBe(LEDGER_DDL)
    expect(sent.length).toBe(3)
  })

  test('applyPending refuses when an applied file was edited', async () => {
    const p = planMigrations([file('org', '1.sql', 'new')], [{ source: 'org', filename: '1.sql', checksum: 'old' }])
    await expect(applyPending(async () => [], p, () => {})).rejects.toThrow('edited')
  })

  test('decodes the CLI keychain token', () => {
    expect(decodeKeychainToken('go-keyring-base64:' + Buffer.from('sbp_abc').toString('base64'))).toBe('sbp_abc')
    expect(decodeKeychainToken('sbp_plain\n')).toBe('sbp_plain')
  })
})

describe('shell', () => {
  test('sortTags keeps release tags only, in version order', () => {
    expect(sortTags(['v0.10.0', 'v0.2.0', 'backup', 'v0.2.0-rc1', 'v1.0.0', 'v0.9.9'])).toEqual(['v0.2.0', 'v0.9.9', 'v0.10.0', 'v1.0.0'])
  })

  test('repoUrl maps owner/name to GitHub and leaves paths alone', () => {
    expect(repoUrl('tamari-studio/tamari')).toBe('https://github.com/tamari-studio/tamari.git')
    expect(repoUrl('/tmp/x')).toBe('/tmp/x')
  })

  test('plist runs the installed shell on the org port', () => {
    const text = plist(parseConfig(configText({ name: 'acme', title: 'T', shell: 's/s', version: 'v0.1.0', port: 13400, supabase: '', runtime: 'local' })), '/o & r', '/bin/bun')
    expect(text).toContain('<string>com.miso.acme</string>')
    expect(text).toContain('<string>/o &amp; r/.miso/shell</string>')
    expect(text).toContain('<string>13400</string>')
  })
})

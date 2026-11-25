// The starter templates (template/spaces/, template/vault-starters/) and `miso template`.
//
// The templates are not in spaces.json, so the build never sees them, and `bun test` does not look
// inside dot folders such as `.miso`. This file is what puts them under `bun run test`: it runs
// each template's own tests, type-checks them (template/tsconfig.json), and installs each one into
// a temporary folder to check its shape the way the shell reads a space.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { scanSource } from '../app/build/data-map'
import { serverExports } from '../app/build/plugins'
import { scanCatalog } from '../app/lib/catalog'
import { configText } from './org'
import { addTemplate, findTarget, freeName, listTemplates, main, slugify, starterNotes, TEMPLATES, type Target } from './template'

const ROOT = join(import.meta.dir, '..')
const TYPES = ['agency', 'email-check', 'events', 'gtm', 'product', 'startup', 'writer']
// A template keeps its rows in shared records. The one connector key it may read is named here:
// `writer` can draft with an AI service once the person adds the key on the Connectors page.
const CONNECTOR_KEYS: Record<string, string[]> = { writer: ['WRITER_AI_KEY'] }
const SHARED = ['lib/check.ts', 'lib/check.test.ts', 'lib/rows.ts', 'lib/rows.test.ts', 'ui/kit.tsx']
const COMMENT = 'The spaces this app shows.'

// Each template's own tests, registered here so they run with this file.
const templateTests = [...new Bun.Glob('spaces/*/.miso/**/*.test.ts').scanSync({ cwd: TEMPLATES, dot: true })].sort()
for (const file of templateTests) await import(join(TEMPLATES, file))

function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap(name => {
    const path = rel ? `${rel}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path]
  })
}

/** A new clone: one space, spaces.json with its comment. */
function clone(): Target {
  const root = mkdtempSync(join(tmpdir(), 'miso-template-'))
  mkdirSync(join(root, 'workspaces', 'miso', '.miso', 'views'), { recursive: true })
  writeFileSync(join(root, 'workspaces', 'miso', '.miso', 'views', 'home.tsx'), 'export default function Home() { return null }\n')
  writeFileSync(join(root, 'spaces.json'), `${JSON.stringify({ $comment: COMMENT, spaces: [{ folder: 'miso', id: 'miso', slug: 'miso' }] }, null, 2)}\n`)
  return findTarget(root)
}

const spacesOf = (target: Target) => JSON.parse(readFileSync(target.file, 'utf8')) as { $comment?: string; spaces: Record<string, unknown>[] }

describe('the templates', () => {
  test('there is one per team type, each with a title, a space name and its job', () => {
    const all = listTemplates()
    expect(all.map(t => t.type)).toEqual([...TYPES].sort())
    for (const t of all) {
      expect(t.title).not.toBe(t.type)
      expect(t.space.length).toBeGreaterThan(2)
      expect(t.job.length).toBeGreaterThan(20)
    }
  })

  test('every template has tests of its own, and they ran with this file', () => {
    for (const type of TYPES) expect(templateTests.filter(f => f.startsWith(`spaces/${type}/`)).length).toBeGreaterThanOrEqual(3)
  })

  test('they type-check, and the check sees every template', () => {
    const tsc = (...args: string[]) => Bun.spawnSync([process.execPath, 'x', 'tsc', '--noEmit', '-p', 'template', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    const listed = tsc('--listFilesOnly').stdout.toString()
    for (const type of TYPES) for (const part of ['lib', 'ui', 'views', 'widgets']) expect(listed).toContain(`/template/spaces/${type}/.miso/${part}/`)
    const run = tsc()
    expect(run.stdout.toString() + run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
  }, 120_000)

  test('the shared files are the same in every template', () => {
    for (const file of SHARED) {
      const texts = TYPES.map(type => readFileSync(join(TEMPLATES, 'spaces', type, '.miso', file), 'utf8'))
      expect({ file, same: texts.every(text => text === texts[0]) }).toEqual({ file, same: true })
    }
  })

  test('no two templates keep their rows in the same collection', () => {
    const names = TYPES.flatMap(type =>
      walk(join(TEMPLATES, 'spaces', type))
        .filter(f => f.endsWith('.server.ts'))
        .flatMap(f => scanSource(readFileSync(join(TEMPLATES, 'spaces', type, f), 'utf8')).filter(s => s.kind === 'collection').map(s => s.name))
    )
    expect(names.length).toBeGreaterThanOrEqual(TYPES.length)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe.each(TYPES)('the %s template, installed', type => {
  const target = clone()
  const added = addTemplate(type, target)
  const miso = join(target.spacesDir, type, '.miso')
  const sources = walk(miso).filter(f => /\.tsx?$/.test(f))
  const read = (file: string) => readFileSync(join(miso, file), 'utf8')

  test('is a copy of the space plus one entry in spaces.json', () => {
    // The address is the space's name; the folder and id stay the type.
    const slug = slugify(listTemplates().find(t => t.type === type)!.space)
    expect(added).toMatchObject({ folder: type, id: type, slug })
    expect(spacesOf(target)).toEqual({ $comment: COMMENT, spaces: [{ folder: 'miso', id: 'miso', slug: 'miso' }, { folder: type, id: type, slug }] })
    expect(readFileSync(target.file, 'utf8').endsWith('}\n')).toBe(true)
    expect(existsSync(join(target.spacesDir, type, 'template.json'))).toBe(false)
    expect(walk(miso).sort()).toEqual(walk(join(TEMPLATES, 'spaces', type, '.miso')).sort())
  })

  test('the shell reads it as a space with a name, a view and a widget', () => {
    const catalog = scanCatalog(target.root)
    const space = catalog.spaces.find(s => s.id === type)!
    expect(space.name).toBe(added.template.space)
    const applets = catalog.applets.filter(a => a.folder === type)
    expect(applets.filter(a => a.kind === 'view').length).toBeGreaterThanOrEqual(1)
    expect(applets.filter(a => a.kind === 'widget').length).toBeGreaterThanOrEqual(1)
    for (const a of applets) expect(a.title).not.toBe('')
  })

  test('a widget fills its tile and sets no height of its own', () => {
    expect(read('ui/kit.tsx')).toContain('<div className="flex h-full w-full flex-col')
    for (const file of sources.filter(f => f.startsWith('widgets/'))) {
      const source = read(file)
      expect({ file, tile: source.includes('<Tile') }).toEqual({ file, tile: true })
      expect({ file, fixed: /\b(?:min-|max-)?h-(?:\[|\d)/.exec(source)?.[0] ?? null }).toEqual({ file, fixed: null })
    }
  })

  test('the view explains what to do first and offers examples that can be removed again', () => {
    const views = sources.filter(f => f.startsWith('views/')).map(read).join('\n')
    expect(views).toContain('<Empty')
    expect(views).toContain('<ExamplesBar')
  })

  test('data access is in server files only, and every export there is an async function', () => {
    const servers = sources.filter(f => f.endsWith('.server.ts'))
    expect(servers.length).toBeGreaterThanOrEqual(1)
    for (const file of servers) {
      const source = read(file)
      const names = serverExports(join(miso, file))
      expect(names.length).toBeGreaterThanOrEqual(4)
      for (const name of names) expect({ file, name, async: new RegExp(`export async function ${name}\\(`).test(source) }).toEqual({ file, name, async: true })
      // Nobody signed in, nothing happens.
      expect({ file, guarded: source.split('requireCaller()').length - 1 }).toEqual({ file, guarded: names.length })
    }
    for (const file of sources.filter(f => !f.endsWith('.server.ts'))) {
      expect({ file, server: /from '@miso\/(store|caller)'/.test(read(file)) }).toEqual({ file, server: false })
    }
  })

  test('rows live in shared records under the template’s own name: no table, no database function, no connector key beyond the ones named above', () => {
    const uses = sources.filter(f => !f.includes('.test.')).flatMap(f => scanSource(read(f)))
    expect(uses.filter(u => u.kind !== 'collection' && !(u.kind === 'env' && (CONNECTOR_KEYS[type] ?? []).includes(u.name)))).toEqual([])
    const collections = uses.filter(u => u.kind === 'collection')
    expect(collections.length).toBeGreaterThanOrEqual(1)
    for (const use of collections) expect(use.name.startsWith(`${type}-`)).toBe(true)
  })

  test('it works on its own: imports stay inside the space or are packages the shell has', () => {
    const allowed = new Set(['react', '@tabler/icons-react', '@miso/store', '@miso/caller', 'bun:test'])
    expect(existsSync(join(miso, 'package.json'))).toBe(false)
    for (const file of sources) {
      for (const [, spec] of read(file).matchAll(/from '([^']+)'/g)) {
        if (!spec!.startsWith('.')) expect({ file, spec, allowed: allowed.has(spec!) }).toEqual({ file, spec, allowed: true })
        else expect({ file, spec, inside: !relative(miso, resolve(dirname(join(miso, file)), spec!)).startsWith('..') }).toEqual({ file, spec, inside: true })
      }
    }
  })
})

describe('miso template add', () => {
  test('works in an org repo, where the spaces are in .miso/spaces', () => {
    const root = mkdtempSync(join(tmpdir(), 'miso-template-org-'))
    mkdirSync(join(root, '.miso', 'spaces'), { recursive: true })
    writeFileSync(join(root, '.miso', 'miso.yaml'), configText({ name: 'acme', title: 'Acme', shell: 'tamari-studio/tamari', version: 'v0.1.0', port: 13400, supabase: '', runtime: 'vercel' }))
    expect(() => findTarget(root)).toThrow('miso install')
    writeFileSync(join(root, '.miso', 'spaces', 'spaces.json'), JSON.stringify({ spaces: [] }))
    mkdirSync(join(root, 'docs'))
    const lines: string[] = []
    main(['add', 'agency'], join(root, 'docs'), line => lines.push(line))
    expect(existsSync(join(root, '.miso', 'spaces', 'agency', '.miso', 'views'))).toBe(true)
    expect(JSON.parse(readFileSync(join(root, '.miso', 'spaces', 'spaces.json'), 'utf8'))).toEqual({ spaces: [{ folder: 'agency', id: 'agency', slug: 'clients' }] })
    expect(lines.join('\n')).toContain('Added the Clients space (Agency template) as .miso/spaces/agency, and listed it in .miso/spaces/spaces.json (id agency, address /clients).\nNext: commit .miso/spaces and push.')
  })

  test('outside an install it says where to run it', () => {
    expect(() => findTarget(mkdtempSync(join(tmpdir(), 'miso-nowhere-')))).toThrow('No miso install')
  })

  test('never overwrites a space folder, and changes nothing when it refuses', () => {
    const target = clone()
    addTemplate('agency', target)
    const before = readFileSync(target.file, 'utf8')
    writeFileSync(join(target.spacesDir, 'agency', '.miso', 'views', 'mine.tsx'), 'export default () => null\n')
    expect(() => addTemplate('agency', target)).toThrow('already a space folder "agency"')
    expect(readFileSync(target.file, 'utf8')).toBe(before)
    expect(existsSync(join(target.spacesDir, 'agency', '.miso', 'views', 'mine.tsx'))).toBe(true)
    // A folder that is listed but not on disk counts too.
    const listed = clone()
    writeFileSync(listed.file, JSON.stringify({ spaces: [{ folder: 'agency', id: 'a', slug: 'a' }] }))
    expect(() => addTemplate('agency', listed)).toThrow('already a space folder')
  })

  test('--as adds it under another folder name', () => {
    const target = clone()
    addTemplate('agency', target)
    expect(addTemplate('agency', target, { as: 'key-accounts' })).toMatchObject({ folder: 'key-accounts', id: 'key-accounts', slug: 'key-accounts' })
    expect(spacesOf(target).spaces.map(s => s.folder)).toEqual(['miso', 'agency', 'key-accounts'])
  })

  test('the id and the address are new: not one another space has, or had before', () => {
    const target = clone()
    writeFileSync(target.file, JSON.stringify({ spaces: [{ folder: 'crm', id: 'agency', slug: 'crm', previousSlugs: ['clients', 'clients-2'] }] }))
    expect(addTemplate('agency', target)).toMatchObject({ folder: 'agency', id: 'agency-2', slug: 'clients-3' })
    // --as names the folder, and the address follows it.
    expect(addTemplate('agency', target, { as: 'key-accounts' })).toMatchObject({ folder: 'key-accounts', slug: 'key-accounts' })
    expect(freeName('a', new Set())).toBe('a')
    expect(slugify('Monthly update')).toBe('monthly-update')
    expect(slugify('  Café & Co — Q1 ')).toBe('cafe-co-q1')
    expect(slugify('x'.repeat(39) + ' y')).toBe('x'.repeat(39))
    expect(slugify('!!!')).toBe('')
    expect(freeName('a', new Set(['a', 'a-2']))).toBe('a-3')
  })

  test('refuses names that are not a plain folder name, or a page of the app', () => {
    const target = clone()
    for (const type of ['../vault', 'agency/..', '.', '', 'Agency', 'nope']) expect(() => addTemplate(type, target)).toThrow('No starter template')
    for (const as of ['../x', 'a/b', '.miso', 'Clients', '']) expect(() => addTemplate('agency', target, { as })).toThrow('--as must be a folder name')
    expect(() => addTemplate('agency', target, { as: 'settings' })).toThrow('page of the app')
    expect(readdirSync(target.spacesDir)).toEqual(['miso'])
    expect(() => main(['add'], target.root, () => {})).toThrow('usage')
    expect(() => main(['add', 'agency', '--as'], target.root, () => {})).toThrow('--as needs a value')
  })

  test('list names every template', () => {
    const lines: string[] = []
    main(['list'], tmpdir(), line => lines.push(line))
    for (const type of TYPES) expect(lines.some(line => line.startsWith(type))).toBe(true)
  })
})

describe('vault starters', () => {
  const VAULT = join(TEMPLATES, 'vault')
  const schema = readFileSync(join(VAULT, '00-Inbox', 'frontmatter.md'), 'utf8')
  const types = /^type: \w+\s+# (.+)$/m.exec(schema)![1]!.split(',').map(t => t.trim())
  const para = readdirSync(VAULT).filter(name => /^0\d-/.test(name))

  test.each(TYPES)('%s has three to five notes, each in a PARA folder with the frontmatter the vault asks for', type => {
    const notes = starterNotes(type)
    expect(notes.length).toBeGreaterThanOrEqual(3)
    expect(notes.length).toBeLessThanOrEqual(5)
    expect(walk(join(TEMPLATES, 'vault-starters', type)).sort()).toEqual(notes)
    for (const note of notes) {
      expect({ note, para: para.includes(note.split('/')[0]!) && note.includes('/') }).toEqual({ note, para: true })
      // A starter never takes the place of a note the blank vault already has.
      expect({ note, taken: existsSync(join(VAULT, note)) }).toEqual({ note, taken: false })
      const block = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(TEMPLATES, 'vault-starters', type, note), 'utf8'))?.[1] ?? ''
      for (const key of ['title', 'type', 'created', 'updated']) expect({ note, key, has: new RegExp(`^${key}: \\S`, 'm').test(block) }).toEqual({ note, key, has: true })
      expect({ note, type: types.includes(/^type: (\S+)/m.exec(block)?.[1] ?? '') }).toEqual({ note, type: true })
      for (const key of ['created', 'updated']) expect(new RegExp(`^${key}: \\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$`, 'm').test(block)).toBe(true)
    }
    // Notes link back to their Map, and the Map links to every note (the vault's own rule).
    const map = notes.find(note => note.startsWith('07-Maps/'))!
    const mapText = readFileSync(join(TEMPLATES, 'vault-starters', type, map), 'utf8')
    for (const note of notes.filter(n => n !== map)) {
      expect({ note, linked: mapText.includes(`[[${note.replace(/\.md$/, '')}`) }).toEqual({ note, linked: true })
      expect({ note, back: readFileSync(join(TEMPLATES, 'vault-starters', type, note), 'utf8').includes(`[[${map.replace(/\.md$/, '')}`) }).toEqual({ note, back: true })
    }
  })

  test('--vault copies the notes into a vault and keeps a note that is already there', () => {
    const vault = mkdtempSync(join(tmpdir(), 'miso-vault-'))
    const notes = starterNotes('agency')
    mkdirSync(dirname(join(vault, notes[0]!)), { recursive: true })
    writeFileSync(join(vault, notes[0]!), 'mine\n')
    const added = addTemplate('agency', clone(), { vault })
    expect(added.notes).toEqual({ wrote: notes.slice(1), kept: [notes[0]!] })
    expect(readFileSync(join(vault, notes[0]!), 'utf8')).toBe('mine\n')
    for (const note of notes.slice(1)) expect(readFileSync(join(vault, note), 'utf8')).toBe(readFileSync(join(TEMPLATES, 'vault-starters', 'agency', note), 'utf8'))
  })

  test('a --vault that is not a folder stops before the space is copied', () => {
    const target = clone()
    expect(() => addTemplate('agency', target, { vault: join(target.root, 'no-such-vault') })).toThrow('is not a folder')
    expect(readdirSync(target.spacesDir)).toEqual(['miso'])
  })
})

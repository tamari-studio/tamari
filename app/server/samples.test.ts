import { expect, test } from 'bun:test'
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addSamples, parseSamples, sampleImage, sampleSpaces } from './samples'
import { commit, initRepo, spacesGit } from './spaces-volume'

const REAL = join(import.meta.dir, '..', '..', 'template')
const author = { name: 'Ada', email: 'ada@example.com' }
const built = (ok: boolean) => async (after: number) => ({ id: 1, startedAt: after, finishedAt: after, ok, ...(ok ? {} : { errors: 'broken' }) })

// A spaces volume with one space, and a copy of the real templates where agency has a png picture and events none.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'samples-'))
  initRepo(dir)
  writeFileSync(join(dir, 'spaces.json'), `${JSON.stringify({ spaces: [{ folder: 'miso', id: 'miso', slug: 'miso' }] }, null, 2)}\n`)
  commit(dir, 'start')
  const templates = mkdtempSync(join(tmpdir(), 'samples-templates-'))
  cpSync(REAL, templates, { recursive: true })
  const meta = join(templates, 'spaces', 'agency', 'template.json')
  writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, 'utf8')), image: 'preview.png' }))
  writeFileSync(join(templates, 'spaces', 'agency', 'preview.png'), 'png')
  // And events has none.
  const events = join(templates, 'spaces', 'events', 'template.json')
  const { image: _image, ...rest } = JSON.parse(readFileSync(events, 'utf8'))
  writeFileSync(events, JSON.stringify(rest))
  return { dir, templates, opts: { dir, templates, askForBuild: () => {} } }
}

test('lists every template, with whether it is added and has a picture', () => {
  const { opts } = setup()
  const agency = sampleSpaces(opts).find(s => s.type === 'agency')
  expect(agency).toEqual({ type: 'agency', title: 'Agency', space: 'Clients', job: expect.any(String), image: true, added: false })
  expect(sampleSpaces(opts).length).toBeGreaterThanOrEqual(5)
})

test('adds the picked templates in one commit, without template.json or the picture', async () => {
  const { dir, opts } = setup()
  const result = await addSamples(['agency', 'events'], author, { ...opts, waitForBuild: built(true) })
  expect(result.status).toBe('saved')
  expect(JSON.parse(readFileSync(join(dir, 'spaces.json'), 'utf8')).spaces.map((s: { folder: string }) => s.folder)).toEqual(['miso', 'agency', 'events'])
  expect(existsSync(join(dir, 'agency', '.miso', 'views', 'clients.tsx'))).toBe(true)
  expect(existsSync(join(dir, 'agency', 'preview.png'))).toBe(false)
  expect(existsSync(join(dir, 'agency', 'template.json'))).toBe(false)
  expect(spacesGit(dir, 'status', '--porcelain').trim()).toBe('')
  expect(spacesGit(dir, 'log', '-1', '--format=%s %an').trim()).toBe('Add sample spaces: Clients, Run of show Ada')
  expect(sampleSpaces(opts).filter(s => s.added).map(s => s.type)).toEqual(['agency', 'events'])
})

test('a build that fails puts everything back', async () => {
  const { dir, opts } = setup()
  const result = await addSamples(['agency'], author, { ...opts, waitForBuild: built(false) })
  expect(result.status).toBe('put back')
  expect(existsSync(join(dir, 'agency'))).toBe(false)
  expect(JSON.parse(readFileSync(join(dir, 'spaces.json'), 'utf8')).spaces).toHaveLength(1)
})

test('only templates not added yet can be picked', () => {
  const { opts } = setup()
  const offered = sampleSpaces(opts).map(s => (s.type === 'events' ? { ...s, added: true } : s))
  expect(parseSamples({ types: ['agency', 'agency'] }, offered)).toEqual(['agency'])
  for (const body of [null, {}, { types: [] }, { types: 'agency' }, { types: [1] }, { types: ['events'] }, { types: ['../x'] }, { types: ['nope'] }]) {
    expect(() => parseSamples(body, offered)).toThrow()
  }
})

test('a picture is served only for a template that names one', () => {
  const { templates } = setup()
  expect(sampleImage('agency', templates)).toEqual({ path: join(templates, 'spaces', 'agency', 'preview.png'), contentType: 'image/png' })
  expect(sampleImage('events', templates)).toBeNull()
  expect(sampleImage('nope', templates)).toBeNull()
})

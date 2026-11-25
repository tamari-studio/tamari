import { expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describeSkill, parseSkillMd } from './skills'
import { buildTree } from './tree'

const VAULT = join(import.meta.dir, '../../../../template/vault')

function walk(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap(name => {
    const path = rel ? `${rel}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? walk(dir, path) : [path]
  })
}

const files = walk(VAULT)
// The vault space lists notes the way vault.server.ts does: Markdown outside dot folders.
const notes = files.filter(p => p.endsWith('.md') && !p.split('/').some(s => s.startsWith('.')))

test('every PARA folder of the map exists and shows up in the vault overview', () => {
  const tree = buildTree(notes)
  const want = ['00-Inbox', '01-Daily', '02-Projects', '03-Areas', '04-Resources', '05-Knowledge', '06-Wiki', '07-Maps', '08-Archive', '09-agents']
  expect(tree.folders.map(f => f.name)).toEqual(want)
})

test('notes open with the frontmatter AGENTS.md requires', () => {
  const exempt = new Set(['AGENTS.md', 'CLAUDE.md', 'README.md', 'CRITICAL_FACTS.md'])
  for (const path of notes.filter(p => !exempt.has(p))) {
    const block = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(VAULT, path), 'utf8'))?.[1] ?? ''
    for (const key of ['title', 'type', 'created', 'updated']) expect({ path, has: new RegExp(`^${key}:`, 'm').test(block) }).toEqual({ path, has: true })
  }
})

test('the starter skills show on the Skills page, each with a command and a "when"', () => {
  const ids = files.flatMap(p => /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(p)?.[1] ?? [])
  expect(ids.sort()).toEqual(['new-note', 'session-context', 'wrap-up'])
  for (const id of ids) {
    const meta = { id, ...parseSkillMd(readFileSync(join(VAULT, `.claude/skills/${id}/SKILL.md`), 'utf8'), id) }
    expect(meta.name).toBe(id)
    const view = describeSkill(meta)
    expect(view.command).toBe(`/${id}`)
    expect(view.summary).not.toBe('')
    expect(view.when).not.toBeNull()
  }
})

test('every skill in the table of AGENTS.md exists', () => {
  const agents = readFileSync(join(VAULT, 'AGENTS.md'), 'utf8')
  for (const [, id] of agents.matchAll(/^\| `\/([\w-]+)` \|/gm)) expect(files).toContain(`.claude/skills/${id}/SKILL.md`)
})

import { expect, test } from 'bun:test'

import { describeSkill, parseSkillMd } from './skills'
import { buildTree, countNotes } from './tree'

test('parseSkillMd reads folded YAML, falls back line by line, and without frontmatter', () => {
  expect(parseSkillMd('---\nname: plan\ndescription: >\n  Pick the next task.\n  Use when starting.\n---\nbody', 'x')).toEqual({ name: 'plan', description: 'Pick the next task. Use when starting.' })
  expect(parseSkillMd('---\nname: a\ndescription: Does x: and y. Use at the end\n---\n', 'x')).toEqual({ name: 'a', description: 'Does x: and y. Use at the end' })
  expect(parseSkillMd('no frontmatter', 'folder')).toEqual({ name: 'folder', description: '' })
})

test('describeSkill splits what it does from when to use it', () => {
  const v = describeSkill({ id: 'plan', name: 'plan', description: 'Pick the next task. Use when the day starts.' })
  expect(v).toMatchObject({ command: '/plan', summary: 'Pick the next task.', when: 'when the day starts' })
  expect(describeSkill({ id: 'a', name: 'a', description: 'Only does a thing.' }).when).toBeNull()
})

test('buildTree nests folders and countNotes counts recursively', () => {
  const tree = buildTree(['README.md', '02-Projects/a.md', '02-Projects/x/b.md'])
  expect(tree.notes).toEqual(['README.md'])
  expect(tree.folders.map(f => f.name)).toEqual(['02-Projects'])
  expect(countNotes(tree)).toBe(3)
})

import { expect, test } from 'bun:test'

import { splitNote } from './frontmatter'

test('frontmatter becomes a property list and leaves the body', () => {
  const note = '---\ntype: project\ntags: [launch, q4]\ndue: 2026-12-01\nowner:\n---\n# Launch\n\nText.\n'
  expect(splitNote(note)).toEqual({
    properties: [
      { key: 'type', value: 'project' },
      { key: 'tags', value: 'launch, q4' },
      { key: 'due', value: '2026-12-01' },
      { key: 'owner', value: '' }
    ],
    body: '# Launch\n\nText.\n'
  })
})

test('a note without frontmatter, and one with broken YAML, still show', () => {
  expect(splitNote('# Just text\n---\nnot frontmatter\n')).toEqual({ properties: [], body: '# Just text\n---\nnot frontmatter\n' })
  const broken = splitNote('---\ntitle: Plan: the sequel\nstatus: [open\n---\nBody')
  expect(broken.body).toBe('Body')
  expect(broken.properties).toContainEqual({ key: 'title', value: 'Plan: the sequel' })
})

import { expect, test } from 'bun:test'

import { filterPaths, isNotePath, noteTitle, oneLine, requireNotePath } from './paths'

test('a note path is a relative .md path outside dot folders and node_modules', () => {
  for (const ok of ['index.md', '02-Projects/Launch plan.md', 'Areas/Økonomi/2026 budget (draft).md']) expect(isNotePath(ok)).toBe(true)
  const bad = [
    '',
    'notes.txt',
    '/etc/passwd.md',
    '../secrets.md',
    'a/../../b.md',
    'a/./b.md',
    '.claude/skills/plan/SKILL.md',
    '.github/workflows/x.md',
    'notes/.obsidian/x.md',
    'node_modules/pkg/README.md',
    'a//b.md',
    'a\\b.md',
    'a/b.md?ref=main',
    'a/b\n.md',
    'a/ b.md',
    '.md',
    'a/.md',
    `${'a'.repeat(200)}.md`,
    42,
    null,
    ['a.md']
  ]
  for (const path of bad) expect(isNotePath(path)).toBe(false)
  expect(() => requireNotePath('../x.md')).toThrow('dot')
})

test('titles, one-line text and the name filter', () => {
  expect(noteTitle('02-Projects/Launch plan.md')).toBe('Launch plan')
  expect(oneLine('  fix typo\n\nApproved by boss@example.com\u2028x ')).toBe('fix typo Approved by boss@example.com x')
  const paths = ['Projects/launch.md', 'Areas/launch checklist.md', 'index.md']
  expect(filterPaths(paths, 'LAUNCH')).toEqual(['Projects/launch.md', 'Areas/launch checklist.md'])
  expect(filterPaths(paths, 'areas launch')).toEqual(['Areas/launch checklist.md'])
  expect(filterPaths(paths, '  ')).toEqual(paths)
})

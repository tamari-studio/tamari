import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { NoteBody } from '../views/_markdown'
import { linkTarget } from './links'

const notes = new Set(['index.md', 'People/Onboarding.md', 'People/Expenses.md', 'Projects/Launch plan.md'])
const from = 'People/Onboarding.md'

test('a link is a web link, another note, or nothing', () => {
  expect(linkTarget('https://example.com/a?b=1', from, notes)).toEqual({ kind: 'web', href: 'https://example.com/a?b=1' })
  expect(linkTarget('mailto:hr@example.com', from, notes)).toEqual({ kind: 'web', href: 'mailto:hr@example.com' })
  expect(linkTarget('Expenses.md', from, notes)).toEqual({ kind: 'note', path: 'People/Expenses.md' })
  expect(linkTarget('./Expenses', from, notes)).toEqual({ kind: 'note', path: 'People/Expenses.md' })
  expect(linkTarget('../Projects/Launch%20plan.md#goals', from, notes)).toEqual({ kind: 'note', path: 'Projects/Launch plan.md' })
  expect(linkTarget('/index.md', from, notes)).toEqual({ kind: 'note', path: 'index.md' })
  for (const bad of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>1</script>', 'vbscript:x', 'file:///etc/passwd', '//evil.example/x', '#top', '../../../etc/passwd', '../.claude/skills/x.md', 'Missing.md', '%E0%A4%A', '', undefined]) {
    expect(linkTarget(bad, from, notes)).toEqual({ kind: 'none' })
  }
})

test('HTML, scripts and unsafe links in a note come out as text', () => {
  const note = [
    '# Welcome <script>alert("x")</script>',
    '',
    '<img src=x onerror="alert(1)"> <iframe src="https://evil.example"></iframe>',
    '',
    '[click me](javascript:alert(1)) and [data](data:text/html;base64,PHNjcmlwdD4=)',
    '',
    '![tracker](https://evil.example/pixel.png) ![local](attachments/photo.png)',
    '',
    '[expenses](Expenses.md), [site](https://example.com) and <https://example.org>',
    '',
    '<a href="javascript:alert(2)" onclick="alert(3)">raw link</a>',
    '',
    '- [x] done',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |'
  ].join('\n')
  const html = renderToStaticMarkup(<NoteBody text={note} path={from} notes={notes} onOpen={() => {}} />)

  // No element or attribute from the note itself: what it wrote is escaped text.
  expect(html).not.toMatch(/<script|<iframe|<img/i)
  expect(html).not.toMatch(/<[^>]*\son\w+=/i)
  expect(html).not.toMatch(/(href|src)="(?!https:\/\/example\.(com|org)|https:\/\/evil\.example\/pixel\.png)[^"]*"/)
  expect(html).not.toContain('href="javascript')
  expect(html).not.toContain('href="data:')
  expect(html).toContain('&lt;script&gt;')

  // The safe parts still work.
  expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer noopener"')
  expect(html).toContain('<button type="button"')
  expect(html).toContain('>Image: tracker</a>')
  expect(html).toContain('Image: local')
  expect(html).toContain('<table')
  expect(html).toContain('type="checkbox"')
})

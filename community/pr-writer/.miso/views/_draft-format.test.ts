import { describe, expect, test } from 'bun:test'

import { parseDraft, parseInline, toHtml, toPlainText } from './_draft-format'

// The shape of a draft the model writes.
const DRAFT = `# Europe can build. Can it convert?

**The Weekly Signal Nº06 sums up two days in Lisbon.**

*[NEEDS: dateline and publication date]*

Before Summit 2026, The Weekly Signal kept asking four questions.

## Signal 1: Sovereignty becomes real when someone buys

Independence is a budget question. *[NEEDS: titles for all three]*

- First point
- Second point with **bold**

1. One
2. Two

---

Read more at [example.org](https://example.org).`

describe('parseDraft', () => {
  test('reads headings, paragraphs and both kinds of list', () => {
    const blocks = parseDraft(DRAFT)
    expect(blocks.map(b => b.type)).toEqual([
      'heading',
      'paragraph',
      'paragraph',
      'paragraph',
      'heading',
      'paragraph',
      'list',
      'list',
      'paragraph'
    ])
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 })
    expect(blocks[4]).toMatchObject({ type: 'heading', level: 2 })
    expect(blocks[6]).toMatchObject({ type: 'list', ordered: false })
    expect(blocks[7]).toMatchObject({ type: 'list', ordered: true })
  })

  test('caps deep headings at level 3', () => {
    expect(parseDraft('#### Deep')[0]).toMatchObject({ type: 'heading', level: 3 })
  })

  test('joins a wrapped paragraph into one', () => {
    const blocks = parseDraft('First line\nsecond line')
    expect(blocks).toHaveLength(1)
    expect(toPlainText(blocks)).toBe('First line second line')
  })

  test('drops quote markers and rules', () => {
    expect(toPlainText(parseDraft('> "A quote," she said.\n\n***'))).toBe('"A quote," she said.')
  })
})

describe('parseInline', () => {
  test('bold, italic and nested marks', () => {
    expect(parseInline('a **b *c* d** e')).toEqual([
      { text: 'a ' },
      { text: 'b ', bold: true },
      { text: 'c', bold: true, italic: true },
      { text: ' d', bold: true },
      { text: ' e' }
    ])
  })

  test('leaves snake_case, lone stars and escaped markers alone', () => {
    expect(toPlainText(parseDraft('my_var_name and 5 * 3 and \\*literal\\*'))).toBe(
      'my_var_name and 5 * 3 and *literal*'
    )
  })

  test('keeps only http, https and mailto links', () => {
    expect(parseInline('[x](https://a.example)')).toEqual([{ text: 'x', href: 'https://a.example' }])
    expect(parseInline('[x](javascript:alert(1))')[0]).not.toHaveProperty('href')
  })
})

describe('toPlainText', () => {
  test('has no Markdown markers left', () => {
    const plain = toPlainText(parseDraft(DRAFT))
    expect(plain).not.toMatch(/[#*]|\*\*|\]\(/)
    expect(plain).toContain('Europe can build. Can it convert?\n\nThe Weekly Signal')
    expect(plain).toContain('[NEEDS: dateline and publication date]')
    expect(plain).toContain('• First point\n• Second point with bold')
    expect(plain).toContain('1. One\n2. Two')
    expect(plain).toContain('Read more at example.org (https://example.org).')
  })
})

describe('toHtml', () => {
  test('renders the structure', () => {
    const html = toHtml(parseDraft(DRAFT))
    expect(html).toContain('<h1>Europe can build. Can it convert?</h1>')
    expect(html).toContain(
      '<p><strong>The Weekly Signal Nº06 sums up two days in Lisbon.</strong></p>'
    )
    expect(html).toContain('<p><em>[NEEDS: dateline and publication date]</em></p>')
    expect(html).toContain(
      '<ul><li>First point</li><li>Second point with <strong>bold</strong></li></ul>'
    )
    expect(html).toContain('<a href="https://example.org">example.org</a>')
  })

  test('escapes HTML in the model output', () => {
    const html = toHtml(parseDraft('<script>alert(1)</script> & "q"\n\n[x](https://a.example/?q="><b>)'))
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;')
    expect(html).not.toContain('"><b>')
  })
})

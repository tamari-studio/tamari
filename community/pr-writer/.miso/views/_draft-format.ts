// Turns a draft's Markdown into something people can paste anywhere: blocks the
// view renders as formatted text, escaped HTML for rich paste (Docs, Word, Gmail,
// WordPress), and plain text with the markers taken out. Only what drafts use:
// headings, paragraphs, lists, bold, italic and links. Everything else stays text.
// Pure, so it never builds HTML from model output without escaping it.

export type Inline = { text: string; bold?: boolean; italic?: boolean; href?: string }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s*>\s?/

// Bold before italic so `**` is never read as two italics. Underscores only count
// at word edges, so snake_case and URLs stay as they are.
const INLINE =
  /(?<!\\)\*\*(.+?)(?<!\\)\*\*|(?<![\w\\])__(.+?)__(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)|(?<!\\)\*(?!\s)(.+?)(?<![\s\\])\*|(?<![\w\\])_(?!\s)(.+?)(?<![\s\\])_(?!\w)|`([^`]+)`/g

const ESCAPED = /\\([\\`*_{}[\]()#+\-.!>])/g

function safeHref(url: string): string | undefined {
  return /^(https?:|mailto:)/i.test(url) ? url : undefined
}

export function parseInline(source: string, marks: Omit<Inline, 'text'> = {}): Inline[] {
  const out: Inline[] = []
  const push = (text: string, extra: Omit<Inline, 'text'> = {}) => {
    if (text) out.push({ text: text.replace(ESCAPED, '$1'), ...marks, ...extra })
  }
  let last = 0
  for (const match of source.matchAll(INLINE)) {
    const [whole, bold1, bold2, linkText, linkUrl, italic1, italic2, code] = match
    push(source.slice(last, match.index))
    last = match.index + whole.length
    const bold = bold1 ?? bold2
    const italic = italic1 ?? italic2
    if (bold !== undefined) out.push(...parseInline(bold, { ...marks, bold: true }))
    else if (italic !== undefined) out.push(...parseInline(italic, { ...marks, italic: true }))
    else if (linkText !== undefined) {
      const href = safeHref(linkUrl ?? '')
      if (href) out.push(...parseInline(linkText, { ...marks, href }))
      else push(whole)
    } else if (code !== undefined) push(code)
  }
  push(source.slice(last))
  return out
}

export function parseDraft(markdown: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flush = () => {
    if (paragraph.length)
      blocks.push({ type: 'paragraph', inlines: parseInline(paragraph.join(' ')) })
    if (list)
      blocks.push({
        type: 'list',
        ordered: list.ordered,
        items: list.items.map(item => parseInline(item))
      })
    paragraph = []
    list = null
  }

  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(QUOTE, '')
    if (!line.trim() || RULE.test(line)) {
      flush()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3
      blocks.push({ type: 'heading', level, inlines: parseInline(heading[2]!) })
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item) {
      const ordered = /\d/.test(item[1]!)
      if (paragraph.length || (list && list.ordered !== ordered)) flush()
      list ??= { ordered, items: [] }
      list.items.push(item[2]!)
      continue
    }
    if (list) {
      // A wrapped line continues the list item above it.
      if (/^\s/.test(raw)) {
        list.items[list.items.length - 1] += ` ${line.trim()}`
        continue
      }
      flush()
    }
    paragraph.push(line.trim())
  }
  flush()
  return blocks
}

function inlineText(inlines: Inline[]): string {
  return inlines.map(i => (i.href && i.href !== i.text ? `${i.text} (${i.href})` : i.text)).join('')
}

/** Plain text for places that take no formatting: no Markdown markers left. */
export function toPlainText(blocks: Block[]): string {
  return blocks
    .map(block => {
      if (block.type === 'list') {
        return block.items
          .map((item, n) => `${block.ordered ? `${n + 1}.` : '•'} ${inlineText(item)}`)
          .join('\n')
      }
      return inlineText(block.inlines)
    })
    .join('\n\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inlineHtml(inlines: Inline[]): string {
  return inlines
    .map(i => {
      let html = escapeHtml(i.text)
      if (i.italic) html = `<em>${html}</em>`
      if (i.bold) html = `<strong>${html}</strong>`
      if (i.href) html = `<a href="${escapeHtml(i.href)}">${html}</a>`
      return html
    })
    .join('')
}

/** HTML for rich paste. Every piece of text and every link is escaped. */
export function toHtml(blocks: Block[]): string {
  return blocks
    .map(block => {
      if (block.type === 'heading')
        return `<h${block.level}>${inlineHtml(block.inlines)}</h${block.level}>`
      if (block.type === 'paragraph') return `<p>${inlineHtml(block.inlines)}</p>`
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag}>${block.items.map(item => `<li>${inlineHtml(item)}</li>`).join('')}</${tag}>`
    })
    .join('\n')
}

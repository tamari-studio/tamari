// A note's frontmatter (the YAML block between --- lines at the top) as a short list of
// properties, and the rest of the note as its body.
import { parse } from 'yaml'

export interface NoteParts {
  properties: { key: string; value: string }[]
  body: string
}

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

function show(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (Array.isArray(value)) return value.map(show).filter(Boolean).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Never throws: frontmatter that is not valid YAML is shown line by line instead. */
export function splitNote(text: string): NoteParts {
  const match = BLOCK.exec(text)
  if (!match) return { properties: [], body: text }
  const body = text.slice(match[0].length)
  try {
    const data: unknown = parse(match[1])
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { properties: Object.entries(data).map(([key, value]) => ({ key, value: show(value) })), body }
    }
  } catch {
    // Read below, line by line.
  }
  const properties = match[1]
    .split(/\r?\n/)
    .map(line => /^([^:#\s][^:]*):\s*(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => ({ key: m[1].trim(), value: m[2].trim() }))
  return { properties, body }
}

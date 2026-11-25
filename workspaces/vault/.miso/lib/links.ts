// Where a link inside a note may lead. A note is text somebody else wrote, so a link only ever
// becomes a web link (http, https, mailto), a jump to another note of the vault, or plain text.
import { isNotePath } from './paths'

export type LinkTarget = { kind: 'web'; href: string } | { kind: 'note'; path: string } | { kind: 'none' }

const WEB = /^(https?:\/\/|mailto:)/i
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

export function linkTarget(href: unknown, fromPath: string, notes: ReadonlySet<string>): LinkTarget {
  if (typeof href !== 'string' || href === '') return { kind: 'none' }
  const trimmed = href.trim()
  if (WEB.test(trimmed)) return { kind: 'web', href: trimmed }
  // javascript:, data:, file:, //host and anything else with a scheme: never a link.
  if (SCHEME.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('#')) return { kind: 'none' }

  let relative = trimmed.split(/[?#]/)[0]
  try {
    relative = decodeURIComponent(relative)
  } catch {
    return { kind: 'none' }
  }
  const parts = relative.startsWith('/') ? [] : fromPath.split('/').slice(0, -1)
  for (const part of relative.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return { kind: 'none' }
      parts.pop()
    } else parts.push(part)
  }
  const path = parts.join('/')
  for (const candidate of [path, `${path}.md`]) {
    if (isNotePath(candidate) && notes.has(candidate)) return { kind: 'note', path: candidate }
  }
  return { kind: 'none' }
}

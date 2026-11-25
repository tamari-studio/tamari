// Which paths count as a note, and the limits on what a member may send. Used by the server
// functions (the real check) and by the views (to explain a refusal before sending).

export const MAX_PATH_CHARS = 200
/** A note bigger than this is not shown or edited in miso. */
export const MAX_NOTE_BYTES = 200_000
export const MAX_REASON_CHARS = 200

// Each segment: letters, digits, spaces and common punctuation. No control characters, no
// backslash, and none of the characters GitHub or a shell would read as something else.
const SEGMENT = /^[^\\/:*?"<>|\u0000-\u001f\u007f]+$/

/** Why `value` is not a note path, or null when it is one. */
export function notePathProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return 'Give the note a path, such as Projects/launch.md.'
  if (value.length > MAX_PATH_CHARS) return `A note path can be at most ${MAX_PATH_CHARS} characters.`
  if (!value.endsWith('.md')) return 'A note path must end in .md.'
  if (value.startsWith('/')) return 'A note path cannot start with a slash.'
  const parts = value.split('/')
  for (const part of parts) {
    if (part === '' || part !== part.trim()) return 'A note path cannot have empty folder names or spaces around a name.'
    if (part.startsWith('.')) return 'A note path cannot use names that start with a dot.'
    if (part === 'node_modules') return 'A note path cannot be inside node_modules.'
    if (!SEGMENT.test(part)) return 'A note path can only use letters, digits, spaces and simple punctuation.'
  }
  if (parts[parts.length - 1] === '.md') return 'Give the note a name before .md.'
  return null
}

export function isNotePath(value: unknown): value is string {
  return notePathProblem(value) === null
}

/** The path, or an error a person can read. */
export function requireNotePath(value: unknown): string {
  const problem = notePathProblem(value)
  if (problem) throw new Error(problem)
  return value as string
}

export function noteTitle(path: string): string {
  return (path.split('/').pop() ?? path).replace(/\.md$/, '')
}

/** `path` for a URL, each segment encoded. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** One line of plain text: line breaks and control characters become spaces. */
export function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Note paths whose path holds every word of `query`, shortest path first. */
export function filterPaths(paths: readonly string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...paths]
  return paths.filter(p => words.every(w => p.toLowerCase().includes(w))).sort((a, b) => a.length - b.length || a.localeCompare(b))
}

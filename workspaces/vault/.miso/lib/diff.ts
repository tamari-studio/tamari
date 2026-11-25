// A line-by-line comparison of two versions of a note, for the Proposals view. Long runs of
// unchanged lines are folded into one "skip" row so the changes stay in sight.
import { diffLines } from 'diff'

export type DiffRow = { type: 'same' | 'add' | 'remove'; text: string } | { type: 'skip'; count: number }

export function diffRows(before: string, after: string, context = 3): DiffRow[] {
  const rows: DiffRow[] = []
  for (const part of diffLines(before, after)) {
    const lines = part.value.replace(/\n$/, '').split('\n')
    const type = part.added ? 'add' : part.removed ? 'remove' : 'same'
    for (const text of lines) rows.push({ type, text })
  }
  // Keep `context` unchanged lines around each change, fold the rest.
  const keep = rows.map(() => false)
  rows.forEach((row, i) => {
    if (row.type === 'same') return
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = true
  })
  const folded: DiffRow[] = []
  let skipped = 0
  rows.forEach((row, i) => {
    if (keep[i]) {
      if (skipped > 0) folded.push({ type: 'skip', count: skipped })
      skipped = 0
      folded.push(row)
    } else skipped++
  })
  if (skipped > 0) folded.push({ type: 'skip', count: skipped })
  return folded
}

export function countChanges(rows: readonly DiffRow[]): { added: number; removed: number } {
  return { added: rows.filter(r => r.type === 'add').length, removed: rows.filter(r => r.type === 'remove').length }
}

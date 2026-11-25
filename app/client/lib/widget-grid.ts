// Free placement for a space's widgets. Positions live in a fixed 14-column
// frame whose middle line is the centre of the screen; a 4-, 6- or 10-column
// view shows the middle 4, 6 or 10 of those columns, so switching width keeps
// the layout centred. Every widget is w×h cells, at least 2×2 (the default),
// and nothing ever moves except the widget you move: a drop or resize onto
// an occupied cell is refused rather than shuffling the others.
import type { WidgetPlacement } from '../../lib/types'

export const FRAME_COLS = 14
export const COLUMN_CHOICES = [4, 6, 10, 14] as const
export type Columns = (typeof COLUMN_CHOICES)[number]
export const MIN_SPAN = 2

// Placements saved before the grid went 14 wide carry no `grid` and count in
// cells twice the size; they're read at double scale so nothing jumps.
const LEGACY_SCALE = 2

export type Cell = { ref: string; x: number; y: number; w: number; h: number }
// Visible frame columns: from (inclusive) to `to` (exclusive).
export type Range = { from: number; to: number }

export function visibleRange(columns: Columns): Range {
  const from = (FRAME_COLS - columns) / 2
  return { from, to: from + columns }
}

const overlaps = (a: Cell, b: Cell) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

export const inRange = (c: Cell, range: Range) => c.x >= range.from && c.x + c.w <= range.to

// The part of a widget a view shows: its overlap with the visible columns, or
// null when it sits entirely outside them. A widget that only partly fits is
// shown trimmed to the view rather than hidden — a hidden widget would still
// hold the visible cells it covers, so empty-looking cells would refuse drops.
export function clip(c: Cell, range: Range): Cell | null {
  const x = Math.max(c.x, range.from)
  const end = Math.min(c.x + c.w, range.to)
  return end > x ? { ...c, x, w: end - x } : null
}

export function fits(cell: Cell, cells: Cell[]): boolean {
  return (
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.w >= MIN_SPAN &&
    cell.h >= MIN_SPAN &&
    cell.x + cell.w <= FRAME_COLS &&
    !cells.some(c => c.ref !== cell.ref && overlaps(cell, c))
  )
}

export function firstFree(cells: Cell[], ref: string, range: Range, w = MIN_SPAN, h = MIN_SPAN): Cell {
  w = Math.min(w, range.to - range.from)
  for (let y = 0; ; y++) {
    for (let x = range.from; x + w <= range.to; x++) {
      const cell = { ref, x, y, w, h }
      if (fits(cell, cells)) return cell
    }
  }
}

// `ref` in the first free visible spot: a widget off this width's columns keeps
// its size, a hidden one starts at the minimum.
export function bringIn(cells: Cell[], ref: string, range: Range): Cell[] {
  const others = cells.filter(c => c.ref !== ref)
  const current = cells.find(c => c.ref === ref)
  return [...others, firstFree(others, ref, range, current?.w, current?.h)]
}

const isInt = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min

// Saved positions win; a widget without one (or with one that's off the frame
// or collides with an earlier widget) takes the first free visible spot.
export function resolveLayout(placed: WidgetPlacement[], range: Range): Cell[] {
  const cells: Cell[] = []
  const later: string[] = []
  for (const p of placed) {
    const scale = p.grid === FRAME_COLS ? 1 : LEGACY_SCALE
    const span = (n: unknown) => (isInt(n, 1) ? Math.max(MIN_SPAN, n * scale) : MIN_SPAN)
    if (!isInt(p.x, 0) || !isInt(p.y, 0)) {
      later.push(p.ref)
      continue
    }
    const cell = { ref: p.ref, x: p.x * scale, y: p.y * scale, w: span(p.w), h: span(p.h) }
    if (fits(cell, cells)) cells.push(cell)
    else later.push(p.ref)
  }
  for (const ref of later) cells.push(firstFree(cells, ref, range))
  return cells
}

// The layout with one widget at a new spot or size, or null if it won't fit.
export function place(cells: Cell[], next: Cell, range: Range): Cell[] | null {
  if (!inRange(next, range) || !fits(next, cells)) return null
  return [...cells.filter(c => c.ref !== next.ref), next]
}

// Where a moved widget lands when dropped with its top-left at `next`: its
// own size if that's free, else the largest size (down to 2×2) that fits the
// free space there, so a widget dropped into a smaller gap shrinks to fill
// it. Null when not even 2×2 fits.
export function fitAt(cells: Cell[], next: Cell, range: Range): Cell | null {
  if (place(cells, next, range)) return next
  const sizes: { w: number; h: number }[] = []
  for (let w = next.w; w >= MIN_SPAN; w--) for (let h = next.h; h >= MIN_SPAN; h--) sizes.push({ w, h })
  sizes.sort((a, b) => b.w * b.h - a.w * a.h || b.w - a.w)
  for (const size of sizes) {
    const cell = { ...next, ...size }
    if (place(cells, cell, range)) return cell
  }
  return null
}

// What gets saved: reading order, so anything that ignores positions still
// sees a sensible sequence, tagged with the frame the numbers refer to.
export function toPlacements(cells: Cell[]): WidgetPlacement[] {
  return [...cells]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map(({ ref, x, y, w, h }) => ({ ref, x, y, w, h, grid: FRAME_COLS }))
}

export function rowsUsed(cells: Cell[]): number {
  return cells.reduce((max, c) => Math.max(max, c.y + c.h), 0)
}

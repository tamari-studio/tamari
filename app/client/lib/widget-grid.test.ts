import { describe, expect, test } from 'bun:test'
import { bringIn, clip, firstFree, fitAt, inRange, place, resolveLayout, rowsUsed, toPlacements, visibleRange, type Cell } from './widget-grid'

const six = visibleRange(6)
const fourteen = visibleRange(14)
const at = (cells: Cell[], ref: string) => {
  const c = cells.find(c => c.ref === ref)!
  return [c.x, c.y, c.w, c.h]
}
const G = { grid: 14 }

test('4, 6, 10 and 14 columns share the same centre line', () => {
  expect(visibleRange(4)).toEqual({ from: 5, to: 9 })
  expect(visibleRange(6)).toEqual({ from: 4, to: 10 })
  expect(visibleRange(10)).toEqual({ from: 2, to: 12 })
  expect(visibleRange(14)).toEqual({ from: 0, to: 14 })
})

describe('resolveLayout', () => {
  test('new widgets start 2×2 in the first free visible spot', () => {
    const cells = resolveLayout([{ ref: 'a' }, { ref: 'b' }, { ref: 'c' }, { ref: 'd' }], six)
    expect(at(cells, 'a')).toEqual([4, 0, 2, 2])
    expect(at(cells, 'c')).toEqual([8, 0, 2, 2])
    expect(at(cells, 'd')).toEqual([4, 2, 2, 2])
  })

  test('keeps saved spots and sizes, gaps included', () => {
    const cells = resolveLayout([{ ref: 'a', x: 5, y: 7, w: 2, h: 3, ...G }, { ref: 'b' }], fourteen)
    expect(at(cells, 'a')).toEqual([5, 7, 2, 3])
    expect(at(cells, 'b')).toEqual([0, 0, 2, 2])
    expect(rowsUsed(cells)).toBe(10)
  })

  test('reads layouts saved on the old 7-column grid at double scale', () => {
    const cells = resolveLayout(
      [
        { ref: 'a', x: 2, y: 0, w: 1, h: 1 },
        { ref: 'b', x: 3, y: 1, w: 2, h: 1 }
      ],
      fourteen
    )
    expect(at(cells, 'a')).toEqual([4, 0, 2, 2])
    expect(at(cells, 'b')).toEqual([6, 2, 4, 2])
  })

  test('raises anything smaller than 2×2 to the minimum', () => {
    expect(at(resolveLayout([{ ref: 'a', x: 4, y: 0, w: 1, h: 1, ...G }], six), 'a')).toEqual([4, 0, 2, 2])
  })

  test('re-slots a widget that collides with an earlier one or falls off the frame', () => {
    const cells = resolveLayout(
      [
        { ref: 'a', x: 4, y: 0, w: 4, h: 4, ...G },
        { ref: 'b', x: 6, y: 2, ...G },
        { ref: 'c', x: 13, y: 0, w: 3, h: 2, ...G }
      ],
      six
    )
    expect(at(cells, 'a')).toEqual([4, 0, 4, 4])
    expect(at(cells, 'b')).toEqual([8, 0, 2, 2])
    expect(at(cells, 'c')).toEqual([8, 2, 2, 2])
  })

  test('ignores junk', () => {
    expect(at(resolveLayout([{ ref: 'a', x: -1, y: 1.5, w: 0 }], six), 'a')).toEqual([4, 0, 2, 2])
  })
})

describe('place', () => {
  const base = resolveLayout(
    [
      { ref: 'a', x: 4, y: 0, ...G },
      { ref: 'b', x: 6, y: 0, ...G }
    ],
    six
  )

  test('drops anywhere free without moving anything else', () => {
    const next = place(base, { ref: 'c', x: 7, y: 5, w: 2, h: 2 }, six)!
    expect(at(next, 'a')).toEqual([4, 0, 2, 2])
    expect(at(next, 'b')).toEqual([6, 0, 2, 2])
    expect(at(next, 'c')).toEqual([7, 5, 2, 2])
  })

  test('refuses a spot that overlaps another widget', () => {
    expect(place(base, { ref: 'c', x: 5, y: 1, w: 2, h: 2 }, six)).toBeNull()
    expect(place(base, { ref: 'a', x: 4, y: 0, w: 3, h: 2 }, six)).toBeNull()
  })

  test('resizes in place, never below 2×2', () => {
    expect(at(place(base, { ref: 'b', x: 6, y: 0, w: 2, h: 3 }, six)!, 'b')).toEqual([6, 0, 2, 3])
    expect(at(place(base, { ref: 'b', x: 6, y: 0, w: 4, h: 5 }, six)!, 'b')).toEqual([6, 0, 4, 5])
    expect(place(base, { ref: 'b', x: 6, y: 0, w: 1, h: 2 }, six)).toBeNull()
  })

  test('refuses spots outside the visible columns', () => {
    expect(place(base, { ref: 'b', x: 9, y: 0, w: 2, h: 2 }, six)).toBeNull()
    expect(place(base, { ref: 'b', x: 2, y: 0, w: 2, h: 2 }, six)).toBeNull()
    expect(place(base, { ref: 'b', x: 2, y: 0, w: 2, h: 2 }, fourteen)).not.toBeNull()
  })
})

test('firstFree skips occupied cells and stays in range', () => {
  const cells = resolveLayout([{ ref: 'a', x: 4, y: 0, w: 6, h: 2, ...G }], six)
  expect(firstFree(cells, 'b', six)).toMatchObject({ x: 4, y: 2, w: 2, h: 2 })
})

test('a widget in the outer columns is off-grid at 6 columns', () => {
  expect(inRange({ ref: 'a', x: 0, y: 0, w: 2, h: 2 }, six)).toBe(false)
  expect(inRange({ ref: 'a', x: 6, y: 0, w: 2, h: 2 }, six)).toBe(true)
})

test('toPlacements saves spot, size and frame in reading order', () => {
  const cells = resolveLayout(
    [
      { ref: 'b', x: 4, y: 6, ...G },
      { ref: 'a', x: 8, y: 0, w: 2, h: 4, ...G }
    ],
    six
  )
  expect(toPlacements(cells)).toEqual([
    { ref: 'a', x: 8, y: 0, w: 2, h: 4, grid: 14 },
    { ref: 'b', x: 4, y: 6, w: 2, h: 2, grid: 14 }
  ])
})

describe('clip', () => {
  test('trims a widget that sticks out of the view to the visible columns', () => {
    expect(clip({ ref: 'a', x: 0, y: 0, w: 4, h: 2 }, visibleRange(10))).toEqual({ ref: 'a', x: 2, y: 0, w: 2, h: 2 })
    expect(clip({ ref: 'a', x: 10, y: 0, w: 4, h: 2 }, visibleRange(10))).toEqual({ ref: 'a', x: 10, y: 0, w: 2, h: 2 })
  })

  test('leaves a widget inside the view alone and drops one entirely outside', () => {
    expect(clip({ ref: 'a', x: 4, y: 0, w: 2, h: 2 }, six)).toEqual({ ref: 'a', x: 4, y: 0, w: 2, h: 2 })
    expect(clip({ ref: 'a', x: 0, y: 0, w: 2, h: 2 }, visibleRange(10))).toBeNull()
  })

  test('cells that look empty in a narrow view accept a drop', () => {
    // A widget straddling the edge of the 10-column view, as in a layout
    // arranged at 14 columns: the free cells next to it take a drop.
    const cells = resolveLayout([{ ref: 'a', x: 0, y: 0, w: 4, h: 2, grid: 14 }], fourteen)
    const ten = visibleRange(10)
    expect(place(cells, { ref: 'b', x: 4, y: 0, w: 2, h: 2 }, ten)).not.toBeNull()
    // The cells it visibly covers stay taken.
    expect(place(cells, { ref: 'b', x: 2, y: 0, w: 2, h: 2 }, ten)).toBeNull()
  })
})

describe('fitAt', () => {
  const six = visibleRange(6)
  const cells = resolveLayout(
    [
      { ref: 'big', x: 4, y: 4, w: 4, h: 4, grid: 14 },
      { ref: 'wall', x: 6, y: 0, w: 4, h: 2, grid: 14 }
    ],
    six
  )

  test('keeps the size when the spot is free', () => {
    expect(fitAt(cells, { ref: 'big', x: 4, y: 8, w: 4, h: 4 }, six)).toEqual({ ref: 'big', x: 4, y: 8, w: 4, h: 4 })
  })

  test('shrinks to the free gap it was dropped into', () => {
    // Only a 2-wide gap at x 4–5 next to the wall.
    expect(fitAt(cells, { ref: 'big', x: 4, y: 0, w: 4, h: 4 }, six)).toEqual({ ref: 'big', x: 4, y: 0, w: 2, h: 4 })
  })

  test('refuses when not even 2×2 fits', () => {
    expect(fitAt(cells, { ref: 'big', x: 7, y: 0, w: 4, h: 4 }, six)).toBeNull()
  })
})

test('bringIn keeps the size of a widget off this width, and starts a hidden one at 2×2', () => {
  const cells = resolveLayout([{ ref: 'wide', x: 0, y: 0, w: 4, h: 3, ...G }], fourteen)
  expect(bringIn(cells, 'wide', six)).toEqual([{ ref: 'wide', x: 4, y: 0, w: 4, h: 3 }])
  expect(bringIn(cells, 'new', six).find(c => c.ref === 'new')).toMatchObject({ w: 2, h: 2 })
})

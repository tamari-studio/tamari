import { expect, test } from 'bun:test'

import { installScrollbars } from './scrollbars'

function fakeElement() {
  const attrs = new Set<string>()
  return {
    hasAttribute: (name: string) => attrs.has(name),
    setAttribute: (name: string) => void attrs.add(name),
    removeAttribute: (name: string) => void attrs.delete(name)
  }
}

function fakeRoot() {
  let listener: ((event: { target: unknown }) => void) | undefined
  const root = {
    documentElement: fakeElement(),
    addEventListener: (_type: string, fn: typeof listener) => void (listener = fn)
  }
  return { root, scroll: (target: unknown) => listener!({ target }) }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

test('marks a scrolling element, then clears the mark once it stops', async () => {
  const { root, scroll } = fakeRoot()
  installScrollbars(root as unknown as Document, 20)
  const el = fakeElement()
  scroll(el)
  expect(el.hasAttribute('data-scrolling')).toBe(true)
  await wait(10)
  scroll(el)
  await wait(15)
  // The second scroll restarted the timer, so it's still shown.
  expect(el.hasAttribute('data-scrolling')).toBe(true)
  await wait(15)
  expect(el.hasAttribute('data-scrolling')).toBe(false)
})

test('a page scroll marks the root element', () => {
  const { root, scroll } = fakeRoot()
  installScrollbars(root as unknown as Document, 20)
  scroll(root)
  expect(root.documentElement.hasAttribute('data-scrolling')).toBe(true)
})

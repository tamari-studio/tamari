import { expect, test } from 'bun:test'

import { isStaleBuildError, reloadOnceForNewBuild } from './stale-build'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return { getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) }
}

test('recognises the errors a browser gives for a chunk a new deploy removed', () => {
  // Chrome, Safari, Firefox.
  expect(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/view-a-1.js'))).toBe(true)
  expect(isStaleBuildError(new TypeError('Importing a module script failed.'))).toBe(true)
  expect(isStaleBuildError(new TypeError('error loading dynamically imported module: https://x/assets/view-a-1.js'))).toBe(true)
})

test('other errors are not taken for a stale build', () => {
  expect(isStaleBuildError(new Error('This module has no default export to render.'))).toBe(false)
  expect(isStaleBuildError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false)
  expect(isStaleBuildError('nope')).toBe(false)
})

test('reloads the page the first time', () => {
  let reloads = 0
  expect(reloadOnceForNewBuild(1_000, fakeStorage(), () => reloads++)).toBe(true)
  expect(reloads).toBe(1)
})

test('does not reload again within a minute, so a chunk that is really missing cannot loop', () => {
  let reloads = 0
  const storage = fakeStorage()
  reloadOnceForNewBuild(1_000, storage, () => reloads++)
  expect(reloadOnceForNewBuild(30_000, storage, () => reloads++)).toBe(false)
  expect(reloads).toBe(1)
  expect(reloadOnceForNewBuild(62_000, storage, () => reloads++)).toBe(true)
  expect(reloads).toBe(2)
})

test('does not reload when the browser will not keep the guard', () => {
  let reloads = 0
  const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  expect(reloadOnceForNewBuild(1_000, broken, () => reloads++)).toBe(false)
  expect(reloads).toBe(0)
})

// Every deploy gives the view and widget files new hashed names and removes the old ones. A tab
// opened before the deploy still asks for the old names, so loading a view fails with a browser
// error about a module it could not fetch. A reload fetches the new build.

// Chrome and Edge, Safari, Firefox.
const STALE_BUILD = /dynamically imported module|importing a module script failed|failed to load module script/i

export function isStaleBuildError(error: unknown): boolean {
  return error instanceof Error && STALE_BUILD.test(error.message)
}

const GUARD_KEY = 'miso:stale-build-reload-at'
const GUARD_MS = 60_000

type GuardStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Reloads the page to pick up the new build, at most once a minute, so a chunk that is really
 * missing shows its error instead of reloading forever. True when it reloaded.
 */
export function reloadOnceForNewBuild(
  now: number = Date.now(),
  storage: GuardStorage = sessionStorage,
  reload: () => void = () => location.reload()
): boolean {
  try {
    const last = Number(storage.getItem(GUARD_KEY))
    if (last && now - last < GUARD_MS) return false
    storage.setItem(GUARD_KEY, String(now))
  } catch {
    // No way to remember that it already reloaded, so don't risk a loop.
    return false
  }
  reload()
  return true
}

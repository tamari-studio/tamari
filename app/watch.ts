// The rebuild loop of `bun run dev` (app/dev.ts) and of the Compose install's app (cli/selfhost.ts):
// a change under app/, packages/, workspaces/ or spaces.json rebuilds, and a build that passes
// restarts the server. Each caller brings its own build and restart.
import { existsSync, watch } from 'node:fs'
import { join } from 'node:path'

// Build output, deps and machine-local state. Paths are relative to the watched folder:
// app/.generated is the build's own output, and workspaces/.git the spaces' history.
export const IGNORED = /(^|\/)(node_modules|\.build|\.cache|\.git|\.scratchpad)(\/|$)|^\.generated(\/|$)|\.(db|db-wal|db-shm|log|jsonl)$/

type Loop = {
  build: () => Promise<boolean>
  restart: () => unknown
  log?: (line: string) => void
  delayMs?: number
}

/** The change handler. Changes during a build queue exactly one more build; a failed build doesn't restart. */
export function rebuildOnChange({ build, restart, log = console.log, delayMs = 200 }: Loop): (event: string, file: string | null) => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let building = false
  let again = false
  return (_event, file) => {
    if (!file || IGNORED.test(file)) return
    clearTimeout(timer)
    timer = setTimeout(async () => {
      if (building) {
        again = true
        return
      }
      building = true
      do {
        again = false
        log(`miso: ${file} changed, rebuilding…`)
        if (await build()) await restart()
      } while (again)
      building = false
    }, delayMs)
  }
}

export function watchSources(root: string, onChange: (event: string, file: string | null) => void): void {
  watch(join(root, 'app'), { recursive: true }, onChange)
  for (const dir of ['workspaces', 'packages', 'spaces.json']) {
    // A spaces volume that failed to fill has no spaces.json yet; workspaces/ still catches it later.
    if (existsSync(join(root, dir))) watch(join(root, dir), { recursive: true }, onChange)
  }
}

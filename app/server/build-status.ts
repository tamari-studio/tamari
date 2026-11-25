// The last build of the Compose install's app (cli/selfhost.ts writes it): whether it passed and,
// if not, the build's own error text. A caller that changed space files waits for the first build
// that started after its change, so it can return that build's errors (the MCP write tools).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { APP_ROOT } from '../lib/roots'

export type BuildStatus = {
  /** Counts up from 1 on each start of the app. */
  id: number
  /** Epoch milliseconds. A change made before this is in the build. */
  startedAt: number
  /** Unset while the build runs. */
  finishedAt?: number
  ok?: boolean
  errors?: string
}

export const BUILD_STATUS = join(APP_ROOT, '.build-status.json')

// cli/selfhost.ts makes this file and rebuilds when it changes. A change written into a folder that
// is itself new can come before the file watcher watches that folder, so a writer asks outright.
export const REBUILD_REQUEST = join(APP_ROOT, '.rebuild-request')

/** Asks the Compose install's app for a build. Does nothing elsewhere (no such file). */
export function requestBuild(path = REBUILD_REQUEST): void {
  if (existsSync(path)) writeFileSync(path, String(Date.now()))
}

/** What a failed build says is wrong: bun's "error:" line and the build's lines under it, without the
 * source excerpt before it or the stack trace after. The whole output when there is no such line. */
export function buildErrors(output: string): string {
  const lines = output.split('\n')
  const start = lines.findIndex(line => line.startsWith('error: '))
  if (start < 0) return output.trim()
  const end = lines.findIndex((line, i) => i > start && /^\s+at /.test(line))
  return lines.slice(start, end < 0 ? undefined : end).join('\n').trim()
}

export function writeBuildStatus(status: BuildStatus, path = BUILD_STATUS): void {
  // Write then rename, so a reader never sees half a file.
  writeFileSync(`${path}.tmp`, JSON.stringify(status))
  renameSync(`${path}.tmp`, path)
}

export function readBuildStatus(path = BUILD_STATUS): BuildStatus | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as BuildStatus
  } catch {
    return null
  }
}

/** The first finished build that started at or after `after` (epoch ms), or null after `timeoutMs`. */
export async function waitForBuild(after: number, { path = BUILD_STATUS, timeoutMs = 120_000, pollMs = 250 } = {}): Promise<BuildStatus | null> {
  const until = Date.now() + timeoutMs
  for (;;) {
    const status = readBuildStatus(path)
    if (status && status.startedAt >= after && status.finishedAt !== undefined) return status
    if (Date.now() >= until) return null
    await Bun.sleep(pollMs)
  }
}

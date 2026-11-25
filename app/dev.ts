// `bun run dev`: build, serve on http://localhost:13380, and rebuild + restart
// whenever the app or a space's code changes. `--no-build` serves the last
// build without watching (that's `bun run start`).
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import { rebuildOnChange, watchSources } from './watch'

const ROOT = join(import.meta.dir, '..')
const noBuild = process.argv.includes('--no-build')

async function build(): Promise<boolean> {
  const proc = Bun.spawn(['bun', join(ROOT, 'app', 'build.ts'), '--dev'], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
  return (await proc.exited) === 0
}

let server: Subprocess | null = null
function restart(): void {
  server?.kill()
  server = Bun.spawn(['bun', join(ROOT, 'app', 'serve.ts')], { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' })
}

if (noBuild) {
  restart()
} else {
  if (!(await build())) process.exit(1)
  restart()
  watchSources(ROOT, rebuildOnChange({ build, restart }))
}

process.on('SIGINT', () => {
  server?.kill()
  process.exit(0)
})

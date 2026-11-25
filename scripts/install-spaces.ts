// Installs every space's own dependencies (workspaces/<space>/.miso/package.json).
// The hosted build runs this on Vercel so a space that imports a package only it
// depends on builds there too.
//
//   bun scripts/install-spaces.ts
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readSpacesFile } from '../app/lib/catalog'
import { APP_ROOT } from '../app/lib/roots'

const ROOT = APP_ROOT
const { spaces } = readSpacesFile(ROOT)

const results = await Promise.all(
  spaces.map(async ({ folder }) => {
    const dir = join(ROOT, 'workspaces', folder, '.miso')
    if (!existsSync(join(dir, 'package.json'))) return `· ${folder}: no package.json`
    const frozen = existsSync(join(dir, 'bun.lock')) ? ['--frozen-lockfile'] : []
    let proc = Bun.spawn(['bun', 'install', ...frozen], { cwd: dir, stdout: 'ignore', stderr: 'pipe' })
    if ((await proc.exited) !== 0 && frozen.length) {
      // A lockfile that drifted from package.json shouldn't block a deploy.
      proc = Bun.spawn(['bun', 'install'], { cwd: dir, stdout: 'ignore', stderr: 'pipe' })
    }
    if ((await proc.exited) !== 0) {
      const error = (await new Response(proc.stderr).text()).trim().split('\n').pop()
      throw new Error(`${folder}: bun install failed — ${error}`)
    }
    return `✓ ${folder}`
  })
)
console.log(results.join('\n'))

// The app container of the Compose install (selfhost/docker-compose.yml). Both commands read the
// container's environment, which the compose file fills from selfhost/.env:
//
//   bun cli/selfhost.ts start          apply the shell's migrations, set up the service accounts, then
//                                      update the spaces volume, install the spaces' packages, build,
//                                      serve, and rebuild on changes
//   bun cli/selfhost.ts owner <email>  make the owner account and print a one-time sign-in link
import { existsSync, rmSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Subprocess } from 'bun'
import { buildErrors, REBUILD_REQUEST, writeBuildStatus } from '../app/server/build-status'
import { changeLock } from '../app/server/space-files'
import { syncSpacePackages } from '../app/server/space-packages'
import { addSeed, addSeedRecords, commit, ignoreInstalls, initRepo, markSeedRecordsPending, updateShipped } from '../app/server/spaces-volume'
import { requiredEnv, vaultClient } from '../app/server/supabase'
import { rebuildOnChange, watchSources } from '../app/watch'
import { serviceAccounts, setupClients } from '../scripts/supabase-setup'
import { applyPending, plan, postgresQuery, readMigrations } from './migrate'
import { checkOwnerEmail, makeOwner } from './provision'

const ROOT = join(import.meta.dir, '..')

type Steps = { migrate: () => Promise<string>; setup: () => Promise<void>; serve: () => Promise<void> }

/** In this order. The first step that throws stops the start, so the app never serves a database it hasn't migrated. */
export async function start(steps: Steps, log: (line: string) => void = console.log): Promise<void> {
  log(`tamari: ${await steps.migrate()}`)
  await steps.setup()
  await steps.serve()
}

/** The shell's migrations, through the same ledger and rules as `miso provision` and `miso migrate`. */
async function migrate(): Promise<string> {
  const pg = postgresQuery(requiredEnv('DATABASE_URL'))
  try {
    const p = await plan(pg.query, await readMigrations('shell', join(ROOT, 'supabase', 'migrations')))
    const ran = await applyPending(pg.query, p, line => console.log(`tamari:   ${line}`))
    if (ran) await pg.query(`notify pgrst, 'reload schema'`)
    return `${ran} migrations applied, ${p.applied.length} were already`
  } finally {
    await pg.close()
  }
}

const clients = () => setupClients(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SECRET_KEY'))

/** The service accounts, once PostgREST has loaded the migrated schema. Before that it answers 503,
 * and the setup would stop halfway (a later run repairs the account). */
async function setup(): Promise<void> {
  const c = clients()
  for (let attempt = 1; ; attempt++) {
    const { error } = await c.miso.from('members').select('user_id').limit(1)
    if (!error) break
    if (attempt === 60) throw new Error(`the data API didn't load the schema within 2 minutes: ${error.message}`)
    await Bun.sleep(2000)
  }
  await serviceAccounts(c, line => console.log(`tamari:   ${line}`))
}

async function owner(raw: string | undefined): Promise<void> {
  const email = checkOwnerEmail(raw ?? '')
  const cl = clients()
  const pg = postgresQuery(requiredEnv('DATABASE_URL'))
  try {
    console.log(`✓ ${await makeOwner(cl, pg.query, email)}`)
  } finally {
    await pg.close()
  }
  const { data, error } = await cl.admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(`making the sign-in link: ${error.message}`)
  // Straight to the app, which verifies the hash itself (main.tsx): Auth's own link would come back
  // in the implicit flow, which the app's PKCE client doesn't take.
  const link = `${requiredEnv('SUPABASE_PUBLIC_URL')}/?token_hash=${encodeURIComponent(data.properties.hashed_token)}&type=magiclink`
  console.log(`\nSign in as ${email} with this link. It works once, within an hour:\n\n  ${link}\n`)
}

/**
 * The spaces volume (app/server/spaces-volume.ts): a git repo, the shipped folders as this image has
 * them, then one commit. A failure here is logged, not thrown: the app still starts.
 */
function prepareSpaces(): void {
  const dir = join(ROOT, 'workspaces')
  try {
    const first = !existsSync(join(dir, '.git'))
    // A change lock left by a server that died mid-change: nothing can be changing while the
    // container starts. Its files may be half written; they show as uncommitted, and the next change
    // to the same file is refused with what to do.
    rmSync(changeLock(dir), { recursive: true, force: true })
    initRepo(dir)
    if (first) markSeedRecordsPending(dir)
    const paths = [...updateShipped(dir), ...(ignoreInstalls(dir) ? ['.gitignore'] : [])]
    const seeded = first ? addSeed(dir) : []
    if (seeded.length) console.log(`tamari: spaces: added the seed's ${seeded.join(', ')}`)
    const message = first ? 'Spaces as installed' : `Shell update ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
    if (commit(dir, message, first ? ['.'] : paths)) console.log(`tamari: spaces: committed "${message}"`)
  } catch (err) {
    console.error(`tamari: ⚠ COULD NOT UPDATE THE SPACES VOLUME: ${err instanceof Error ? err.message : err}`)
  }
}

let buildId = 0

/**
 * The build's environment: what it needs to write the page (the public address and key), not the
 * database's password or secret key. The build bundles company code and its packages; a way past the
 * guards (build/draft-guard.ts, build/package-guard.ts) then finds no key in its own environment.
 */
export function buildEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const keep = (name: string) => ['PATH', 'HOME', 'TMPDIR', 'TZ', 'LANG', 'NODE_ENV', 'SUPABASE_URL', 'SUPABASE_PUBLIC_URL', 'SUPABASE_PUBLISHABLE_KEY'].includes(name) || /^(BUN_|MISO_)/.test(name)
  return Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => keep(e[0]) && e[1] !== undefined && !/SECRET|PASSWORD|TOKEN/.test(e[0])))
}

/** A production build. Its result, with the build's own error text, goes to the status file (app/server/build-status.ts). */
async function build(): Promise<boolean> {
  const id = ++buildId
  const startedAt = Date.now()
  writeBuildStatus({ id, startedAt })
  // Each space's packages first (server/space-packages.ts): one that can't be installed fails this
  // build, so the change that brought it is put back like any other that doesn't build.
  const packages = await syncSpacePackages(join(ROOT, 'workspaces'), {
    appHas: name => existsSync(join(ROOT, 'node_modules', name, 'package.json')),
    log: line => console.log(line)
  })
  if (!packages.ok) {
    console.error(`tamari: ${packages.errors}`)
    writeBuildStatus({ id, startedAt, finishedAt: Date.now(), ok: false, errors: packages.errors.slice(0, 20_000) })
    return false
  }
  const proc = Bun.spawn(['bun', join(ROOT, 'app', 'build.ts')], { cwd: ROOT, env: buildEnv(), stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  process.stdout.write(out)
  process.stderr.write(err)
  const ok = (await proc.exited) === 0
  writeBuildStatus({ id, startedAt, finishedAt: Date.now(), ok, ...(ok ? {} : { errors: buildErrors(err || out).slice(0, 20_000) }) })
  return ok
}

let server: Subprocess<'ignore', 'pipe', 'inherit'> | null = null

/** Start the new server, wait until it listens, then stop the old one, which finishes its requests first (serve.ts --reuse-port). */
async function restart(): Promise<void> {
  const next = Bun.spawn(['bun', join(ROOT, 'app', 'serve.ts'), '--reuse-port'], { cwd: ROOT, stdin: 'ignore', stdout: 'pipe', stderr: 'inherit' })
  const reader = next.stdout.getReader()
  const decoder = new TextDecoder()
  let seen = ''
  while (!seen.includes('hosted app on')) {
    const { value, done } = await reader.read()
    if (done) {
      console.error('tamari: ⚠ the new server exited before it listened; the old one keeps serving')
      return
    }
    const text = decoder.decode(value)
    process.stdout.write(text)
    seen += text
  }
  void (async () => {
    for (let r = await reader.read(); !r.done; r = await reader.read()) process.stdout.write(decoder.decode(r.value))
  })()
  server?.kill('SIGTERM')
  server = next
}

/** The seed's shared records, from the first start of a new volume until they went in once (addSeedRecords). */
async function insertSeedRecords(): Promise<void> {
  try {
    const added = await addSeedRecords(join(ROOT, 'workspaces'), async rows => {
      // As the vault account (setup() made it), under the records policy, so history names it as the app.
      // One statement that skips existing keys: it adds all rows or none, and a retry never doubles one.
      const { error } = await (await vaultClient()).from('records').upsert(rows, { onConflict: 'collection,key', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
    })
    if (added) console.log(`tamari: added ${added} sample records`)
  } catch (err) {
    console.error(`tamari: ⚠ COULD NOT ADD THE SAMPLE RECORDS (the next start tries again): ${err instanceof Error ? err.message : err}`)
  }
}

async function serve(): Promise<void> {
  prepareSpaces()
  await insertSeedRecords()
  // A space that doesn't build never keeps the app from starting: dist/ still holds the last build
  // that passed, which after a new container is the image's own (the shell and its shipped spaces).
  if (!(await build())) console.error('tamari: ⚠ THE SPACES DO NOT BUILD. Serving the last build that passed; the errors are in .build-status.json.')
  await restart()
  const onChange = rebuildOnChange({ build, restart })
  watchSources(ROOT, onChange)
  // A writer's outright request (build-status.ts, requestBuild): files in a folder made a moment ago
  // can come before the watcher watches that folder.
  writeFileSync(REBUILD_REQUEST, '')
  watch(REBUILD_REQUEST, () => onChange('change', '.rebuild-request'))
  process.on('SIGTERM', () => {
    server?.kill('SIGTERM')
    process.exit(0)
  })
}

if (import.meta.main) {
  const [command, arg] = process.argv.slice(2)
  try {
    if (command === 'start') {
      await start({ migrate, setup, serve })
    } else if (command === 'owner') await owner(arg)
    else throw new Error('usage: bun cli/selfhost.ts start | owner <email>')
  } catch (err) {
    console.error(`tamari: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

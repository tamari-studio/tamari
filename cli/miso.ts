#!/usr/bin/env bun
// miso: install and update this shell inside an org repo. See docs/org-repos.md.
//
//   miso init --name <n> --port <p> [--title <t>] [--supabase <ref>] [--runtime local|vercel|docker]
//                                        write .miso/ in the current repo (vercel also writes the deploy workflow,
//                                        docker the Dockerfile and .dockerignore)
//   miso docker init                     write the Dockerfile and .dockerignore into an existing twin (never overwrites)
//   miso install [--to <tag>] [--yes]    install the pinned tag (or --to), migrate, start the LaunchAgent
//   miso update  [--to <tag>] [--yes]    move to the newest tag (or --to); rolls back if the app doesn't come up
//   miso migrate [--apply] [--yes]       list (or apply) pending shell and org migrations
//   miso status                          pin, installed version, newest tag, service, migrations
//   miso template list                   the starter templates: a first space per kind of team (template/README.md)
//   miso template add <type> [--as <folder>] [--vault <folder>]
//                                        copy one into the spaces folder and list it in spaces.json
//   miso vercel prepare [--build]        runtime: vercel. Make .miso/vercel (pinned shell + spaces) ready to deploy;
//                                        --build also installs and builds it, as CI does
//   miso provision --slug <s> --owner-email <e> [--target local|hosted] …
//                                        set up a new twin's database, accounts and hosting (cli/provision.ts)
//
// With `runtime: vercel` or `docker` install and update only move the pin (after the migration step):
// CI or the container host builds and deploys it, and nothing starts on this Mac.
//
// --yes answers the "apply to the hosted database?" question in advance.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { accessToken, applyPending, managementQuery, migrationFiles, plan } from './migrate'
import { CONFIG, GITIGNORE, addDesignRules, configText, loadOrg, parseConfig, writeVersion, type Org } from './org'
import { main as template } from './template'
import { cloneShell, dirs, healthy, installShim, installedVersion, label, prepare, remoteTags, restartService, seedSpaces, swapBack, swapIn } from './shell'
import { writeDockerFiles } from './docker'
import { prepareVercel, writeWorkflow, WORKFLOW } from './vercel'

const log = (line: string) => console.log(line)

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

async function confirm(question: string): Promise<boolean> {
  process.stdout.write(`${question} [y/N] `)
  for await (const line of console) return /^y(es)?$/i.test(line.trim())
  return false
}

/** Shows pending migrations and applies them after a yes (hosted databases always ask). */
async function migrate(org: Org, shellDir: string, apply: boolean, yes: boolean): Promise<void> {
  if (!org.config.supabase) {
    log('migrations: skipped, miso.yaml has no supabase project')
    return
  }
  const query = managementQuery(org.config.supabase, accessToken())
  const p = await plan(query, await migrationFiles(shellDir, org.root))
  log(`migrations: ${p.applied.length} applied, ${p.pending.length} pending${p.edited.length ? `, ${p.edited.length} EDITED` : ''}`)
  for (const f of p.pending) log(`  pending ${f.source}/${f.filename}`)
  for (const e of p.edited) log(`  edited  ${e.source}/${e.filename} (applied with a different checksum)`)
  for (const m of p.missing) log(`  in the ledger, not on disk: ${m}`)
  if (!apply || (!p.pending.length && !p.edited.length)) return
  if (!yes && !(await confirm(`Apply ${p.pending.length} migration(s) to the hosted project ${org.config.supabase}?`))) {
    throw new Error('Migrations not applied. Run again and answer yes, or pass --yes.')
  }
  log(`migrations: ${await applyPending(query, p, log)} applied`)
}

/** A Vercel twin runs nothing here. This clones the tag (for its migrations and the `miso` command), runs the migration step, and moves the pin. */
async function pinTag(org: Org, tag: string, yes: boolean): Promise<void> {
  const { root, config } = org
  const d = dirs(root)
  log(`cloning ${config.shell} ${tag}`)
  cloneShell(config.shell, tag, d.next)
  seedSpaces(d.next, d.spaces, log)
  await migrate(org, d.next, true, yes)
  swapIn(root)
  writeVersion(root, tag)
  if (addDesignRules(root)) log('added "Designing miso spaces" to AGENTS.md')
  log(
    `✓ ${config.title} is pinned to shell ${tag}. Commit .miso/miso.yaml and push: ` +
      (config.runtime === 'docker' ? 'the host builds the Dockerfile from it (docs/org-repos.md, "Running in a container (Dokploy)").' : 'CI builds and deploys it (docs/org-repos.md, "Running on Vercel").')
  )
}

async function installTag(org: Org, tag: string, yes: boolean): Promise<void> {
  const { root, config } = org
  const d = dirs(root)
  prepare(root, config.shell, tag, log)
  await migrate(org, d.next, true, yes)
  swapIn(root)
  log('building in place')
  const build = Bun.spawnSync(['bun', 'run', 'build'], { cwd: d.shell, stdout: 'pipe', stderr: 'pipe' })
  if (build.success) restartService(config, root)
  if (build.success && (await healthy(config.port))) {
    writeVersion(root, tag)
    if (addDesignRules(root)) log('added "Designing miso spaces" to AGENTS.md')
    log(`✓ ${config.title} runs shell ${tag} on http://localhost:${config.port} (${label(config)})`)
    return
  }
  if (!existsSync(d.prev)) throw new Error(`Shell ${tag} did not come up on port ${config.port}; see ~/Library/Logs/miso-${config.name}.log`)
  swapBack(root)
  restartService(config, root)
  throw new Error(`Shell ${tag} did not come up on port ${config.port}, so the previous shell is back. See ~/Library/Logs/miso-${config.name}.log`)
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv
  const yes = args.includes('--yes')
  switch (command) {
    case 'init': {
      if (existsSync(CONFIG)) throw new Error(`${CONFIG} already exists here.`)
      const name = flag(args, '--name')
      const runtime = flag(args, '--runtime') ?? 'local'
      if (runtime !== 'local' && runtime !== 'vercel' && runtime !== 'docker') throw new Error('--runtime must be local, vercel or docker')
      // A Vercel or docker twin doesn't listen on a port of this Mac, but the config keeps one for trying the shell here.
      const port = Number(flag(args, '--port') ?? (runtime !== 'local' ? 13400 : NaN))
      const config = parseConfig(
        configText({ name: name ?? '', title: flag(args, '--title') ?? name ?? '', shell: 'tamari-studio/tamari', version: 'none', port, supabase: flag(args, '--supabase') ?? '', runtime })
      )
      mkdirSync(join('.miso', 'migrations'), { recursive: true })
      writeFileSync(CONFIG, configText(config))
      writeFileSync(join('.miso', '.gitignore'), GITIGNORE)
      writeFileSync(join('.miso', 'migrations', '.gitkeep'), '')
      if (addDesignRules(process.cwd())) log('added "Designing miso spaces" to AGENTS.md')
      if (runtime === 'vercel') {
        log(`wrote ${CONFIG}. ${writeWorkflow(process.cwd()) ? `Wrote ${WORKFLOW}.` : `${WORKFLOW} was already there and is left as it is.`}`)
        log('Next: `miso update` to pin a release, then set up the Vercel project, its environment variables and the secrets the workflow lists (docs/org-repos.md, "Running on Vercel").')
      } else if (runtime === 'docker') {
        const { wrote, kept } = writeDockerFiles(process.cwd())
        log(`wrote ${CONFIG}. ${wrote.length ? `Wrote ${wrote.join(' and ')}.` : ''}${kept.length ? ` ${kept.join(' and ')} already there, left as it is.` : ''}`)
        log('Next: `miso update` to pin a release, then build the image or point a Dockerfile host such as Dokploy at this repo (docs/org-repos.md, "Running in a container (Dokploy)").')
      } else {
        log(`wrote ${CONFIG}. Next: \`miso install\` (keys for the app go in .env at the repo root).`)
      }
      return
    }
    case 'install':
    case 'update': {
      const org = loadOrg(process.cwd())
      const tags = remoteTags(org.config.shell)
      const pinned = org.config.version !== 'none' ? org.config.version : undefined
      const tag = flag(args, '--to') ?? (command === 'install' ? pinned : undefined) ?? tags.at(-1)
      if (!tag) throw new Error(`${org.config.shell} has no release tags yet.`)
      if (!tags.includes(tag)) throw new Error(`${tag} is not a release tag of ${org.config.shell} (have: ${tags.join(', ') || 'none'}).`)
      if (command === 'update' && tag === installedVersion(dirs(org.root).shell)) {
        log(`Already on ${tag}.`)
        return
      }
      if (org.config.runtime !== 'local') await pinTag(org, tag, yes)
      else await installTag(org, tag, yes)
      const shim = installShim()
      if (shim) log(`added the \`miso\` command at ${shim}`)
      return
    }
    case 'migrate': {
      const org = loadOrg(process.cwd())
      const shellDir = dirs(org.root).shell
      // A Vercel twin has no installed shell until `miso update`; the migrations come from the pinned tag.
      if (!existsSync(shellDir) && org.config.runtime !== 'local' && org.config.version !== 'none') cloneShell(org.config.shell, org.config.version, shellDir)
      await migrate(org, shellDir, args.includes('--apply'), yes)
      return
    }
    case 'status': {
      const org = loadOrg(process.cwd())
      const d = dirs(org.root)
      const latest = remoteTags(org.config.shell).at(-1) ?? 'none'
      log(`org      ${org.config.title} (${org.root})`)
      log(`pinned   ${org.config.version}`)
      log(`running  ${installedVersion(d.shell) ?? 'not installed'}`)
      log(`newest   ${latest}${latest !== org.config.version ? ' (run `miso update`)' : ''}`)
      if (org.config.runtime === 'vercel') {
        log('runtime  vercel: CI builds and deploys the pin (nothing runs on this Mac)')
      } else if (org.config.runtime === 'docker') {
        log('runtime  docker: a host builds the Dockerfile from the pin (nothing runs on this Mac)')
      } else {
        const svc = Bun.spawnSync(['launchctl', 'print', `gui/${process.getuid!()}/${label(org.config)}`], { stdout: 'ignore', stderr: 'ignore' })
        log(`service  ${label(org.config)} ${svc.success ? 'loaded' : 'not loaded'}, port ${org.config.port} ${(await healthy(org.config.port, 1)) ? 'up' : 'down'}`)
      }
      if (existsSync(d.shell)) await migrate(org, d.shell, false, false)
      return
    }
    case 'docker': {
      if (args[0] !== 'init') throw new Error('usage: miso docker init')
      const org = loadOrg(process.cwd())
      const { wrote, kept } = writeDockerFiles(org.root)
      log(`${wrote.length ? `Wrote ${wrote.join(' and ')} in ${org.root}.` : 'Nothing to write.'}${kept.length ? ` ${kept.join(' and ')} already there, left as it is.` : ''}`)
      log('The image builds the shell release pinned in .miso/miso.yaml with the spaces in .miso/spaces/ (docs/org-repos.md, "Running in a container (Dokploy)").')
      return
    }
    case 'template':
      return template(args, process.cwd(), log)
    case 'vercel': {
      if (args[0] !== 'prepare') throw new Error('usage: miso vercel prepare [--build]')
      const org = loadOrg(process.cwd())
      if (org.config.runtime !== 'vercel') throw new Error('miso.yaml has no `runtime: vercel`. Add it first, or run `miso init --runtime vercel` in a new twin.')
      prepareVercel(org, { build: args.includes('--build') }, log)
      return
    }
    case 'provision':
      // Loaded here, not at the top: it needs the Supabase client, and `miso init` also runs from a bare clone with no packages.
      return (await import('./provision')).main(args, log)
    default:
      log(
        'usage: miso init --name <n> --port <p> [--title <t>] [--supabase <ref>] [--runtime local|vercel|docker]\n' +
          '       miso install|update [--to <tag>] [--yes]\n' +
          '       miso migrate [--apply] [--yes]\n' +
          '       miso status\n' +
          '       miso template list | add <type> [--as <folder>] [--vault <folder>]\n' +
          '       miso vercel prepare [--build]\n' +
          '       miso docker init\n' +
          '       miso provision --slug <s> --owner-email <e> [--target local|hosted]   (docs/org-repos.md, "miso provision")'
      )
      if (command && command !== 'help' && command !== '--help') process.exit(1)
  }
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2))
  } catch (err) {
    console.error(`miso: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }
}

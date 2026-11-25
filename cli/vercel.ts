// The Vercel runtime (`runtime: vercel` in .miso/miso.yaml).
//
// A local twin runs the shell as a LaunchAgent on a Mac. A Vercel twin is built and deployed by CI
// from the repo alone: the pinned shell tag plus the org's spaces. `miso vercel prepare` makes the
// folder CI deploys:
//
//   .miso/vercel/   a clone of the pinned tag, with workspaces/ and spaces.json replaced by real
//                   copies of .miso/spaces/ (a link to a folder outside it would not upload)
//
// The shell's own vercel.json, api/server.ts and .vercelignore are what Vercel reads there, so
// nothing about the hosting is copied into the org repo. `--build` also installs and builds it, which
// is the gate CI runs before it deploys and the dry run to try on a Mac: it writes dist/ (the
// client) and api/_generated/ (the API and every space's server functions).
//
// Spaces come from .miso/spaces/ only. Pinning a commit of a separate spaces repo, in a
// spaces.lock, is the next step (docs/org-repos.md, "Running on Vercel").
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Org } from './org'
import { cloneShell, dirs, installedVersion } from './shell'

/** The workflow `miso init --runtime vercel` writes into the org repo. */
export const WORKFLOW = join('.github', 'workflows', 'miso-deploy.yml')
export const WORKFLOW_TEMPLATE = join(import.meta.dir, 'templates', 'vercel-deploy.yml')

/** What the build must have written: the client and the API with the spaces' server functions. */
export const BUILD_OUTPUTS = ['dist/index.html', 'api/_generated/server-entry.js']

// Machine-local installs and secrets stay behind. The shell's .vercelignore drops the same at upload.
const SKIP = new Set(['node_modules', '.git', '.shots', '.env', '.env.local', '.build', '.cache'])

/** Writes the deploy workflow unless the org already has one. Returns whether it wrote it. */
export function writeWorkflow(root: string): boolean {
  const target = join(root, WORKFLOW)
  if (existsSync(target)) return false
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true })
  copyFileSync(WORKFLOW_TEMPLATE, target)
  return true
}

/**
 * Replaces the shell's workspaces/ and spaces.json with copies of the org's spaces. Links are
 * followed, so a space that links to a shared folder carries it along. Returns the space folders.
 */
export function copySpaces(spacesDir: string, shellDir: string): string[] {
  const file = join(spacesDir, 'spaces.json')
  if (!existsSync(file)) throw new Error('.miso/spaces has no spaces.json: a Vercel twin needs its spaces in the repo (`miso update` seeds them from the shell, or copy a spaces folder in).')
  const target = join(shellDir, 'workspaces')
  rmSync(target, { recursive: true, force: true })
  rmSync(join(shellDir, 'spaces.json'), { force: true })
  mkdirSync(target, { recursive: true })
  const folders = readdirSync(spacesDir)
    .filter(name => !SKIP.has(name) && statSync(join(spacesDir, name)).isDirectory())
    .sort()
  for (const name of folders) {
    cpSync(join(spacesDir, name), join(target, name), { recursive: true, dereference: true, filter: src => !SKIP.has(basename(src)) })
  }
  copyFileSync(file, join(shellDir, 'spaces.json'))
  return folders
}

function runIn(cmd: string[], cwd: string): void {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'inherit', stderr: 'inherit' })
  if (!r.success) throw new Error(`${cmd.join(' ')} failed in ${cwd}`)
}

/**
 * Makes `.miso/vercel` ready to deploy and, with `build`, builds it. Reuses the folder when it is
 * already a clone of the pinned tag (CI clones it first, to get this CLI). Returns the folder.
 */
export function prepareVercel(org: Org, opts: { build: boolean }, log: (line: string) => void): string {
  const { root, config } = org
  if (config.version === 'none') throw new Error('Pin a shell release first: `miso update` sets `version:` in .miso/miso.yaml.')
  const d = dirs(root)
  if (installedVersion(d.vercel) === config.version) {
    log(`using the clone of ${config.version} in .miso/vercel`)
  } else {
    log(`cloning ${config.shell} ${config.version} into .miso/vercel`)
    cloneShell(config.shell, config.version, d.vercel)
  }
  if (!existsSync(join(d.vercel, 'vercel.json'))) throw new Error(`${config.version} of ${config.shell} has no vercel.json, so it can't run on Vercel.`)
  const folders = copySpaces(d.spaces, d.vercel)
  log(`spaces: ${folders.length ? folders.join(', ') : 'none'} copied into the shell`)
  if (opts.build) {
    log('installing packages')
    runIn(['bun', 'install', '--frozen-lockfile'], d.vercel)
    log('building')
    runIn(['bun', 'run', 'build'], d.vercel)
    const missing = BUILD_OUTPUTS.filter(file => !existsSync(join(d.vercel, file)))
    if (missing.length) throw new Error(`The build did not write ${missing.join(', ')}.`)
    log(`built: ${BUILD_OUTPUTS.join(', ')}`)
  }
  log(`ready to deploy: ${d.vercel}`)
  return d.vercel
}

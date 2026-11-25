// Installing a shell tag into an org's .miso/: clone it next to the running one,
// point it at the org's spaces and .env, build, then swap it in and keep the
// previous one for rollback.
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { OrgConfig } from './org'

export const dirs = (root: string) => ({
  misoDir: join(root, '.miso'),
  shell: join(root, '.miso', 'shell'),
  next: join(root, '.miso', 'shell.next'),
  prev: join(root, '.miso', 'shell.prev'),
  spaces: join(root, '.miso', 'spaces'),
  vercel: join(root, '.miso', 'vercel')
})

/** A GitHub `owner/name` or a local path (tests, a checkout) as a git URL. */
export function repoUrl(repo: string): string {
  return isAbsolute(repo) || repo.startsWith('.') ? repo : `https://github.com/${repo}.git`
}

function run(cmd: string[], cwd?: string): string {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  if (!r.success) throw new Error(`${cmd.join(' ')} failed:\n${r.stderr.toString().trim() || r.stdout.toString().trim()}`)
  return r.stdout.toString()
}

/**
 * `git -c` arguments that let git read a private GitHub repo over https with a token, for
 * https://github.com/ only. The shell repo (tamari-studio/tamari) is private: CI has no git
 * credentials of its own, so it sets MISO_SHELL_TOKEN (a read-only token, see docs/org-repos.md).
 * Nothing when there is no token, so a Mac with a credential helper works as before.
 */
export function gitAuthArgs(token: string | undefined = process.env.MISO_SHELL_TOKEN): string[] {
  if (!token) return []
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return ['-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basic}`]
}

/** Runs git with the token (if any) but never prints it: a failure names the command without it. */
function git(args: string[], repo?: string): string {
  const r = Bun.spawnSync(['git', ...gitAuthArgs(), ...args], { stdout: 'pipe', stderr: 'pipe' })
  if (r.success) return r.stdout.toString()
  const detail = r.stderr.toString().trim() || r.stdout.toString().trim()
  const hint =
    repo && !process.env.MISO_SHELL_TOKEN && /could not read Username|Authentication failed|not found|terminal prompts disabled/i.test(detail)
      ? '\nIf the shell repo is private, set MISO_SHELL_TOKEN to a token with read access to it (docs/org-repos.md, "Running on Vercel").'
      : ''
  throw new Error(`git ${args.join(' ')} failed:\n${detail}${hint}`)
}

/** Clones `tag` of the shell repo, one commit deep, into `dest` (which is replaced). */
export function cloneShell(repo: string, tag: string, dest: string): void {
  rmSync(dest, { recursive: true, force: true })
  git(['clone', '--quiet', '--depth', '1', '--branch', tag, repoUrl(repo), dest], repo)
}

/** vMAJOR.MINOR.PATCH tags, newest last. Others (pre-releases, backups) are ignored. */
export function sortTags(refs: string[]): string[] {
  const parse = (t: string) => t.slice(1).split('.').map(Number)
  return refs
    .filter(t => /^v\d+\.\d+\.\d+$/.test(t))
    .sort((a, b) => {
      const [x, y] = [parse(a), parse(b)]
      return x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!
    })
}

export function remoteTags(repo: string): string[] {
  const out = git(['ls-remote', '--tags', '--refs', repoUrl(repo)], repo)
  return sortTags(out.split('\n').map(line => line.split('refs/tags/')[1] ?? '').filter(Boolean))
}

export function installedVersion(shell: string): string | null {
  if (!existsSync(shell)) return null
  const r = Bun.spawnSync(['git', 'describe', '--tags', '--exact-match'], { cwd: shell, stdout: 'pipe', stderr: 'pipe' })
  return r.success ? r.stdout.toString().trim() : 'unknown'
}

/** Starts .miso/spaces from the shell's own spaces when the org has none yet. */
export function seedSpaces(shellDir: string, spacesDir: string, log: (l: string) => void): void {
  if (existsSync(join(spacesDir, 'spaces.json'))) return
  log('no .miso/spaces yet: starting from the shell’s own spaces')
  mkdirSync(spacesDir, { recursive: true })
  cpSync(join(shellDir, 'workspaces'), spacesDir, { recursive: true })
  cpSync(join(shellDir, 'spaces.json'), join(spacesDir, 'spaces.json'))
}

/**
 * Clones `tag` into .miso/shell.next, links the org's spaces and .env into it,
 * seeds .miso/spaces from the shell when the org has none yet, then installs and
 * builds. Throws on any failure, leaving the running shell alone.
 */
export function prepare(root: string, repo: string, tag: string, log: (l: string) => void): void {
  const d = dirs(root)
  log(`cloning ${repo} ${tag}`)
  cloneShell(repo, tag, d.next)
  seedSpaces(d.next, d.spaces, log)
  rmSync(join(d.next, 'workspaces'), { recursive: true, force: true })
  rmSync(join(d.next, 'spaces.json'), { force: true })
  // Relative links, so the shell keeps working after shell.next is renamed to shell.
  symlinkSync(join('..', 'spaces'), join(d.next, 'workspaces'))
  symlinkSync(join('..', 'spaces', 'spaces.json'), join(d.next, 'spaces.json'))
  if (existsSync(join(root, '.env'))) symlinkSync(join('..', '..', '.env'), join(d.next, '.env'))
  log('installing packages')
  run(['bun', 'install', '--frozen-lockfile'], d.next)
  log('building')
  run(['bun', 'run', 'build'], d.next)
}

/** shell → shell.prev, shell.next → shell. */
export function swapIn(root: string): void {
  const d = dirs(root)
  rmSync(d.prev, { recursive: true, force: true })
  if (existsSync(d.shell)) renameSync(d.shell, d.prev)
  renameSync(d.next, d.shell)
}

/** shell → shell.next (discarded later), shell.prev → shell. */
export function swapBack(root: string): void {
  const d = dirs(root)
  if (!existsSync(d.prev)) throw new Error('No previous shell to go back to.')
  rmSync(d.next, { recursive: true, force: true })
  renameSync(d.shell, d.next)
  renameSync(d.prev, d.shell)
}

export const label = (c: OrgConfig) => `com.miso.${c.name}`

export function plist(c: OrgConfig, root: string, bun: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const log = join(homedir(), 'Library', 'Logs', `miso-${c.name}.log`)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label(c)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(bun)}</string>
    <string>app/dev.ts</string>
    <string>--no-build</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${esc(join(root, '.miso', 'shell'))}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${esc(log)}</string>
  <key>StandardErrorPath</key>
  <string>${esc(log)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>${c.port}</string>
    <key>PATH</key>
    <string>${esc(join(bun, '..'))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
`
}

/** Writes the LaunchAgent and (re)starts it. */
export function restartService(c: OrgConfig, root: string): void {
  const file = join(homedir(), 'Library', 'LaunchAgents', `${label(c)}.plist`)
  writeFileSync(file, plist(c, root, process.execPath))
  const domain = `gui/${process.getuid!()}`
  Bun.spawnSync(['launchctl', 'bootout', `${domain}/${label(c)}`], { stdout: 'ignore', stderr: 'ignore' })
  run(['launchctl', 'bootstrap', domain, file])
}

/**
 * True once the app answers 200 on /api/health within `seconds`: its keys work and the database
 * has the shell's schema. A shell older than that route counts as up when it serves `/`, as before.
 */
export async function healthy(port: number, seconds = 45, fetcher: typeof fetch = fetch): Promise<boolean> {
  const get = (path: string) => fetcher(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2000) })
  for (let i = 0; i < seconds; i++) {
    try {
      const res = await get('/api/health')
      if (res.status === 200) return true
      // An older shell has no such route: its sign-in check answers 401 (or 404 without one).
      if ((res.status === 401 || res.status === 404) && (await get('/')).status === 200) return true
    } catch {}
    if (i < seconds - 1) await Bun.sleep(1000)
  }
  return false
}

export const SHIM = `#!/bin/sh
# miso: runs the shell installed in the nearest org repo (.miso/miso.yaml here or above).
d=$PWD
while [ "$d" != / ]; do
  [ -f "$d/.miso/miso.yaml" ] && exec bun "$d/.miso/shell/cli/miso.ts" "$@"
  d=$(dirname "$d")
done
echo "miso: no .miso/miso.yaml in $PWD or above" >&2
exit 1
`

/** Puts the `miso` command in ~/.local/bin unless something else already has that name there. */
export function installShim(): string | null {
  const bin = join(homedir(), '.local', 'bin')
  const file = join(bin, 'miso')
  if (existsSync(file)) return null
  mkdirSync(bin, { recursive: true })
  writeFileSync(file, SHIM, { mode: 0o755 })
  return file
}

// An org repo runs this shell from `.miso/`:
//
//   .miso/miso.yaml      org config and the shell version pin (tracked)
//   .miso/spaces/        the org's spaces: spaces.json and one folder per space (tracked)
//   .miso/migrations/    the org's own database migrations (tracked)
//   .miso/shell/         the installed shell, a clone of a Tamari release tag (gitignored)
//   .miso/vercel/        the folder CI deploys to Vercel: that tag plus the org's spaces as real
//                        files (gitignored; `miso vercel prepare`, runtime: vercel only)
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type Runtime = 'local' | 'vercel' | 'docker'

export type OrgConfig = {
  name: string
  title: string
  shell: string
  version: string
  port: number
  supabase: string
  // `local`: a LaunchAgent on this Mac. `vercel`: CI builds the pinned shell with the org's spaces
  // and deploys it. `docker`: a host builds the Dockerfile in the repo (Dokploy, `docker build`).
  // For vercel and docker nothing runs on this Mac and install/update only move the pin. A twin has
  // one runtime; the line is left out of miso.yaml for `local`.
  runtime: Runtime
}

export type Org = { root: string; config: OrgConfig }

export const CONFIG = join('.miso', 'miso.yaml')

export const GITIGNORE = ['shell/', 'shell.next/', 'shell.prev/', 'vercel/', 'node_modules/', '.build/', '.cache/', ''].join('\n')

/** The nearest folder at or above `from` that holds `.miso/miso.yaml`, or null. */
export function findOrgRoot(from: string): string | null {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, CONFIG))) return dir
    if (dirname(dir) === dir) return null
  }
}

export function parseConfig(text: string): OrgConfig {
  const raw = (Bun.YAML.parse(text) ?? {}) as Record<string, unknown>
  const str = (key: string, fallback?: string): string => {
    const value = raw[key] ?? fallback
    if (typeof value !== 'string' || !value.trim()) throw new Error(`miso.yaml: \`${key}\` must be a non-empty string`)
    return value.trim()
  }
  const name = str('name')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error('miso.yaml: `name` must be lowercase letters, digits and dashes')
  const port = raw.port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('miso.yaml: `port` must be a number from 1024 to 65535')
  }
  const supabase = typeof raw.supabase === 'string' ? raw.supabase.trim() : ''
  if (supabase && !/^[a-z]{20}$/.test(supabase)) throw new Error('miso.yaml: `supabase` must be a project ref (20 lowercase letters) or empty')
  const runtime = raw.runtime ?? 'local'
  if (runtime !== 'local' && runtime !== 'vercel' && runtime !== 'docker') throw new Error('miso.yaml: `runtime` must be `local`, `vercel` or `docker`')
  return { name, title: str('title', name), shell: str('shell', 'tamari-studio/tamari'), version: str('version'), port, supabase, runtime }
}

export function loadOrg(from: string): Org {
  const root = findOrgRoot(from)
  if (!root) throw new Error(`No ${CONFIG} in ${from} or above. Run \`miso init\` in the org repo first.`)
  return { root, config: parseConfig(readFileSync(join(root, CONFIG), 'utf8')) }
}

/** The config text with its `version:` line set to `version`, comments and order kept. */
export function withVersion(text: string, version: string): string {
  if (!/^version:.*$/m.test(text)) throw new Error('miso.yaml has no `version:` line')
  return text.replace(/^version:.*$/m, `version: ${version}`)
}

export function writeVersion(root: string, version: string): void {
  const file = join(root, CONFIG)
  writeFileSync(file, withVersion(readFileSync(file, 'utf8'), version))
}

export function configText(c: OrgConfig): string {
  return [
    `name: ${c.name}            # LaunchAgent com.miso.<name>`,
    `title: ${c.title}`,
    `shell: ${c.shell}`,
    `version: ${c.version}      # the shell tag; \`miso update\` moves it`,
    `port: ${c.port}`,
    `supabase: ${c.supabase}    # hosted project ref; keys go in <org>/.env (env repo)`,
    ...(c.runtime === 'vercel' ? ['runtime: vercel       # CI deploys the pinned shell to Vercel (docs/org-repos.md)'] : []),
    ...(c.runtime === 'docker' ? ['runtime: docker       # a host builds the Dockerfile in this repo (docs/org-repos.md)'] : []),
    ''
  ].join('\n')
}

// The section `miso init`, `install` and `update` add to the org repo's AGENTS.md, so an agent that
// builds a space there gets the shell's design rules. It points at the installed shell's copy, which
// follows the pin, instead of copying rules that would go stale.
export const DESIGN_HEADING = '## Designing miso spaces'

export const DESIGN_SECTION = `${DESIGN_HEADING}

The spaces in \`.miso/spaces/\` run in the miso shell. Before you write or change a view, widget or
\`.miso/ui/\` file there, read \`.miso/shell/docs/space-design.md\` (the design rules of the pinned
shell; run \`miso install\` if \`.miso/shell/\` is missing, or read that file in
tamari-studio/tamari at the tag in \`.miso/miso.yaml\`). The rules that always apply:

- Tailwind with the app's theme tokens (\`bg-background\`, \`text-muted-foreground\`, \`bg-primary\`).
  No custom CSS and no \`dark:\` overrides in your own code.
- Start from the kit, \`.miso/ui/kit.tsx\` in a space (\`Page\`, \`Button\`, \`Field\`, \`Empty\`, \`Problem\`,
  \`Tile\`). \`miso template add\` brings it; copy it from \`.miso/shell/template/spaces/agency/\` otherwise.
- Icons from \`@tabler/icons-react\` only.
- A widget fills its tile (\`h-full w-full\`, no outer card styling), people resize it, and it never
  scrolls: show less when the box is small.
- Design every state: loading, empty (with the next step) and error (with a way to recover).
`

/**
 * Adds the design section once to the repo's AGENTS.md, or to CLAUDE.md when only that exists. With
 * neither, it makes AGENTS.md and links CLAUDE.md to it, so Claude and Codex both read it. True when
 * it wrote.
 */
export function addDesignRules(root: string): boolean {
  const agents = join(root, 'AGENTS.md')
  const claude = join(root, 'CLAUDE.md')
  const file = existsSync(agents) || !existsSync(claude) ? agents : claude
  const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (text.includes(DESIGN_HEADING)) return false
  writeFileSync(file, text ? `${text.replace(/\n*$/, '')}\n\n${DESIGN_SECTION}` : `# Agents\n\n${DESIGN_SECTION}`)
  if (!text && !existsSync(claude)) symlinkSync('AGENTS.md', claude)
  return true
}

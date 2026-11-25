// Starter templates: a first space for a kind of team (template/spaces/<type>/) and a few vault
// notes to go with it (template/vault-starters/<type>/). See template/README.md.
//
//   miso template list [--community]
//   miso template add <type> [--as <folder>] [--vault <folder>]
//   miso template add <name> --community [--as <folder>]
//
// `--community` reads community/ (spaces other people can try: working ones and blueprints) instead
// of template/spaces/. See community/README.md.
//
// `add` copies the space next to the other spaces and lists it in spaces.json. It works in both
// layouts: a clone of this repo (workspaces/ and spaces.json at the root) and an org repo
// (.miso/spaces/ with its own spaces.json). It never overwrites: an existing folder stops it, and
// a vault note that is already there is kept. Nothing here touches a database; a template keeps
// its rows in shared records.
//
// The functions take their folders as arguments, so another command (a provisioning step, say)
// can seed a new twin with `addTemplate` without going through the command line.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { findOrgRoot, loadOrg } from './org'

export const TEMPLATES = join(import.meta.dir, '..', 'template')
export const COMMUNITY = join(import.meta.dir, '..', 'community')

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/
// The shell's own pages: a space with one of these addresses could not be opened.
const SHELL_PAGES = new Set(['api', 'assets', 'connectors', 'members', 'proposals', 'settings', 'shared-data', 'space-access', 'usage', 'widgets'])
// template.json describes the template to this command; it is not part of the space.
const NOT_COPIED = new Set(['template.json', 'node_modules', '.DS_Store'])
const IMAGE = /^[a-z0-9][a-z0-9._-]*\.(png|webp)$/

// `image`: a picture of the space for the sample-space picker, a file next to template.json (never copied).
export type Template = { type: string; title: string; space: string; job: string; notes: string[]; image?: string }

/** Whether a template file (`rel`, from the template's folder) goes into the space: not template.json, its image or installs. */
const copied = (template: Template, rel: string): boolean => !rel.split('/').some(part => NOT_COPIED.has(part)) && rel !== template.image

type SpaceEntry = { folder: string; id: string; slug: string; previousSlugs?: string[]; minTier?: string }
type SpacesFile = { spaces: SpaceEntry[]; [key: string]: unknown }

/** Where the spaces of this install live. */
export type Target = { kind: 'clone' | 'org'; root: string; spacesDir: string; file: string }

function files(dir: string, rel = ''): string[] {
  if (!existsSync(join(dir, rel))) return []
  return readdirSync(join(dir, rel))
    .sort()
    .flatMap(name => {
      const path = rel ? `${rel}/${name}` : name
      return statSync(join(dir, path)).isDirectory() ? files(dir, path) : [path]
    })
}

/** The Markdown notes of a vault starter, as paths inside the vault. */
export function starterNotes(type: string, templates = TEMPLATES): string[] {
  return files(join(templates, 'vault-starters', type)).filter(path => path.endsWith('.md')).sort()
}

/** The folder that holds the spaces: `<templates>/spaces/`, or the community folder itself. */
const spacesIn = (templates: string, community: boolean) => (community ? templates : join(templates, 'spaces'))

export function listTemplates(templates = TEMPLATES, community = false): Template[] {
  const dir = spacesIn(templates, community)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(type => NAME.test(type) && existsSync(join(dir, type, '.miso')) && existsSync(join(dir, type, 'template.json')))
    .sort()
    .map(type => {
      const meta = JSON.parse(readFileSync(join(dir, type, 'template.json'), 'utf8')) as Partial<Template>
      // Only a plain file name that is there: the picker serves it, so it never points elsewhere.
      const image = typeof meta.image === 'string' && IMAGE.test(meta.image) && existsSync(join(dir, type, meta.image)) ? meta.image : undefined
      return { type, title: meta.title ?? type, space: meta.space ?? type, job: meta.job ?? '', notes: starterNotes(type, templates), ...(image ? { image } : {}) }
    })
}

/** The files addTemplate() writes for `template` into a space folder, relative to that folder. */
export function copiedFiles(template: Template, templates = TEMPLATES): string[] {
  return files(join(templates, 'spaces', template.type)).filter(rel => copied(template, rel))
}

/**
 * The spaces folder for `from`: the org repo's `.miso/spaces/` when `from` is inside an org repo,
 * else the `workspaces/` of the clone `from` is in.
 */
export function findTarget(from: string): Target {
  const org = findOrgRoot(from)
  if (org) {
    const spacesDir = join(org, '.miso', 'spaces')
    const file = join(spacesDir, 'spaces.json')
    if (!existsSync(file)) throw new Error('.miso/spaces has no spaces.json yet. Run `miso install` (or `miso update`) first: it starts the spaces folder.')
    return { kind: 'org', root: org, spacesDir, file }
  }
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'spaces.json')) && existsSync(join(dir, 'workspaces'))) return { kind: 'clone', root: dir, spacesDir: join(dir, 'workspaces'), file: join(dir, 'spaces.json') }
    if (dirname(dir) === dir) break
  }
  throw new Error(`No miso install in ${from} or above: run this in an org repo (.miso/miso.yaml) or in a clone of the shell (spaces.json and workspaces/).`)
}

/** A space name as an address: lowercase ASCII letters, digits and dashes, 40 at most ("Monthly update" → monthly-update). */
export function slugify(name: string): string {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, 40).replace(/-+$/, '')
}

/** `base`, or `base-2`, `base-3`… when it is taken. */
export function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

export type Added = { template: Template; folder: string; id: string; slug: string; notes: { wrote: string[]; kept: string[] } }

/**
 * Copies the template's space into `target` and lists it last in spaces.json. With `vault`, also
 * copies the starter notes into that vault folder. Everything is checked before anything is written.
 */
export function addTemplate(type: string, target: Target, options: { as?: string; vault?: string; templates?: string; community?: boolean } = {}): Added {
  const community = options.community ?? false
  const templates = options.templates ?? (community ? COMMUNITY : TEMPLATES)
  const all = listTemplates(templates, community)
  const template = NAME.test(type) ? all.find(t => t.type === type) : undefined
  if (!template) throw new Error(`No ${community ? 'community space' : 'starter template'} "${type}". There ${all.length === 1 ? 'is' : 'are'}: ${all.map(t => t.type).join(', ') || 'none'}.`)

  const folder = options.as ?? type
  if (!NAME.test(folder)) throw new Error('--as must be a folder name: lowercase letters, digits and dashes, 40 at most.')
  if (SHELL_PAGES.has(folder)) throw new Error(`"${folder}" is the address of a page of the app. Pick another name with --as <folder>.`)
  const dest = join(target.spacesDir, folder)
  const json = JSON.parse(readFileSync(target.file, 'utf8')) as SpacesFile
  if (!Array.isArray(json.spaces)) throw new Error(`${target.file} has no "spaces" list.`)
  if (existsSync(dest) || json.spaces.some(s => s.folder === folder)) {
    throw new Error(`There is already a space folder "${folder}". Nothing was changed. To add the template next to it, pick another name: miso template add ${type} --as <folder>.`)
  }
  const vault = options.vault === undefined ? undefined : resolve(options.vault)
  if (vault !== undefined && !(existsSync(vault) && statSync(vault).isDirectory())) throw new Error(`--vault: ${options.vault} is not a folder.`)
  if (vault !== undefined && template.notes.length === 0) throw new Error(`The ${type} template has no vault notes.`)

  // An id never changes once tabs point at it, and a slug another space used before still leads there.
  // The address comes from the space's name ("Monthly update", not the type startup), or from --as.
  const id = freeName(folder, new Set(json.spaces.map(s => s.id)))
  const slug = freeName((options.as ? '' : slugify(template.space)) || folder, new Set([...json.spaces.flatMap(s => [s.slug, ...(s.previousSlugs ?? [])]), ...SHELL_PAGES]))

  const from = join(spacesIn(templates, community), type)
  cpSync(from, dest, { recursive: true, errorOnExist: true, force: false, filter: src => src === from || copied(template, relative(from, src)) })
  json.spaces.push({ folder, id, slug })
  writeFileSync(target.file, `${JSON.stringify(json, null, 2)}\n`)

  const notes = { wrote: [] as string[], kept: [] as string[] }
  if (vault !== undefined) {
    const from = join(templates, 'vault-starters', type)
    for (const note of template.notes) {
      if (existsSync(join(vault, note))) notes.kept.push(note)
      else {
        mkdirSync(dirname(join(vault, note)), { recursive: true })
        cpSync(join(from, note), join(vault, note))
        notes.wrote.push(note)
      }
    }
  }
  return { template, folder, id, slug, notes }
}

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

const USAGE = 'usage: miso template list [--community]\n       miso template add <type> [--as <folder>] [--vault <folder>]\n       miso template add <name> --community [--as <folder>]'

/** `miso template …`, run from `cwd`. */
export function main(args: string[], cwd: string, log: (line: string) => void): void {
  const [action, type] = args
  const community = args.includes('--community')
  if (action === 'list') {
    const all = listTemplates(community ? COMMUNITY : TEMPLATES, community)
    const width = Math.max(...all.map(t => t.type.length))
    for (const t of all) log(`${t.type.padEnd(width)}  ${t.title}: the ${t.space} space. ${t.job}${t.notes.length ? ` Plus ${t.notes.length} vault notes.` : ''}`)
    log(community ? '\nAdd one with: miso template add <name> --community   (community/README.md has the details)' : '\nAdd one with: miso template add <type>   (template/README.md has the details)')
    return
  }
  if (action !== 'add' || !type || type.startsWith('--')) throw new Error(USAGE)
  const target = findTarget(cwd)
  if (community && args.includes('--vault')) throw new Error('--vault does not go with --community: community spaces have no vault notes.')
  const added = addTemplate(type, target, { as: option(args, '--as'), vault: option(args, '--vault'), community })
  log(`Added the ${added.template.space} space (${added.template.title} ${community ? 'community space' : 'template'}) as ${relative(target.root, join(target.spacesDir, added.folder))}, and listed it in ${relative(target.root, target.file)} (id ${added.id}, address /${added.slug}).`)
  if (added.notes.wrote.length) log(`Vault notes written: ${added.notes.wrote.join(', ')}.`)
  if (added.notes.kept.length) log(`Vault notes already there, left as they are: ${added.notes.kept.join(', ')}.`)
  const dest = join(target.spacesDir, added.folder)
  if (community && existsSync(join(dest, 'SPACE.md'))) log(`It is a blueprint: ask your coding agent to build it from ${relative(target.root, join(dest, 'SPACE.md'))}.`)
  if (target.kind === 'clone') log(community ? 'Next: under `bun run dev` the app rebuilds by itself. Reload the page: the space is last in the sidebar.' : 'Next: under `bun run dev` the app rebuilds by itself. Reload the page: the space is last in the sidebar. Open it and pick "Try it with examples".')
  else if (loadOrg(target.root).config.runtime === 'local') log('Next: commit .miso/spaces, then run `miso install` to rebuild and restart the app. The space is last in the sidebar.')
  else log('Next: commit .miso/spaces and push. The deploy builds it, and the space is last in the sidebar.')
}

// Sample spaces: the starter templates (template/spaces/, cli/template.ts) an owner or admin adds to
// the company from the app, in the welcome step or in Settings. Only on an install whose spaces are
// a git volume (the Compose install, space-files.ts): the same addTemplate() as `miso template add`,
// inside one runChange, so the spaces build once and land in one commit, or are put back.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { addTemplate, copiedFiles, listTemplates, type Template } from '../../cli/template'
import type { SampleSpace } from '../lib/types'
import { APP_ROOT } from '../lib/roots'
import { waitForBuild as defaultWait } from './build-status'
import { InputError } from './connectors'
import { readSpacesFile, runChange, SPACES_DIR, type Author, type ChangeResult } from './space-files'

export const TEMPLATES_DIR = join(APP_ROOT, 'template')

export type SamplesOptions = { dir?: string; templates?: string; waitForBuild?: typeof defaultWait; askForBuild?: () => void }

/** Every template, and whether this install has it already (a space folder of its name is there). */
export function sampleSpaces({ dir = SPACES_DIR, templates = TEMPLATES_DIR }: SamplesOptions = {}): SampleSpace[] {
  const have = new Set(readSpacesFile(dir).map(s => s.folder))
  return listTemplates(templates).map(t => ({ type: t.type, title: t.title, space: t.space, job: t.job, image: Boolean(t.image), added: have.has(t.type) || existsSync(join(dir, t.type)) }))
}

/** The picked templates, checked: known, not added yet, each once. */
export function parseSamples(body: unknown, offered: readonly SampleSpace[]): Template['type'][] {
  const { types } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  if (!Array.isArray(types) || types.length === 0 || types.some(t => typeof t !== 'string')) throw new InputError('Pick at least one sample space.')
  const picked = [...new Set(types as string[])]
  const open = new Set(offered.filter(s => !s.added).map(s => s.type))
  if (picked.some(t => !open.has(t))) throw new InputError("One of those sample spaces isn't on the list any more. Reload and pick again.")
  return picked
}

/**
 * Adds the templates as the company's spaces: one build and one commit by `author`.
 * shortcut: ids and slugs are checked against spaces.json only, not against rows of spaces deleted
 * earlier (create_space checks those); fine for templates, whose names no company space had, until
 * a company deletes a sample space and adds it again.
 */
export function addSamples(types: string[], author: Author, { dir = SPACES_DIR, templates = TEMPLATES_DIR, waitForBuild = defaultWait, askForBuild }: SamplesOptions = {}): Promise<ChangeResult> {
  const all = listTemplates(templates)
  const picked = types.map(type => all.find(t => t.type === type)!)
  const target = { kind: 'org' as const, root: dir, spacesDir: dir, file: join(dir, 'spaces.json') }
  return runChange({
    dir,
    summary: `Add sample spaces: ${picked.map(t => t.space).join(', ')}`,
    author,
    touched: () => ['spaces.json', ...picked.flatMap(t => copiedFiles(t, templates).map(rel => `${t.type}/${rel}`))],
    apply: () => {
      for (const t of picked) addTemplate(t.type, target, { templates })
    },
    waitForBuild,
    ...(askForBuild ? { askForBuild } : {})
  })
}

/** A template's picture: its path and type, or null when it has none. */
export function sampleImage(type: string, templates = TEMPLATES_DIR): { path: string; contentType: string } | null {
  const t = listTemplates(templates).find(t => t.type === type)
  if (!t?.image) return null
  return { path: join(templates, 'spaces', t.type, t.image), contentType: t.image.endsWith('.webp') ? 'image/webp' : 'image/png' }
}

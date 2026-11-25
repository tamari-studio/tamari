// The Skills view's logic: a vault's `.claude/skills/<id>/SKILL.md` frontmatter, read as plain words. Ported from soii.
import { parse } from 'yaml'

export interface SkillMeta {
  id: string
  name: string
  description: string
}

export interface SkillView {
  id: string
  command: string
  summary: string
  when: string | null
}

/** name and description out of a SKILL.md's frontmatter. Never throws: a skill with odd frontmatter is still a skill. */
export function parseSkillMd(text: string, folder: string): { name: string; description: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1]
  if (block === undefined) return { name: folder, description: '' }
  let name: unknown
  let description: unknown
  try {
    const data = parse(block)
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      name = (data as Record<string, unknown>).name
      description = (data as Record<string, unknown>).description
    }
  } catch {
    // An unquoted ": " in a description is not valid YAML but is common; read it line by line below.
  }
  const line = (key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(block)?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2')
  const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
  return { name: clean(name) || line('name') || folder, description: clean(description) || clean(line('description')) }
}

const TRIGGER = /\bUse (when|whenever|at|this when|it when|after)\b/i
const SENTENCE = /^(.+?(?<!e\.g)(?<!i\.e)[.!?])(?:\s|$)/s

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).replace(/\s+\S*$/, '')}…`
}

/** One line of what the skill does, and when to reach for it (the "Use when…" part of its description). */
export function describeSkill(skill: SkillMeta): SkillView {
  const description = skill.description.trim()
  const at = description.search(TRIGGER)
  const head = (at >= 0 ? description.slice(0, at) : description).trim()
  const when = at >= 0 ? description.slice(at).replace(/^Use\s+/i, '').replace(/[.!?]$/, '') : null
  return {
    id: skill.id,
    command: `/${skill.name}`,
    summary: shorten((SENTENCE.exec(head)?.[1] ?? head).replace(/`/g, ''), 160),
    when: when && shorten(when.replace(/`/g, ''), 140)
  }
}

// What the hosted app can show: every space listed in spaces.json and every
// view and widget in its `.miso/` folder. Read from the repo at build time;
// the result ships inside the server bundle, so nothing reads the repo at request
// time. The browser gets the part a person sees from GET /api/catalog, after sign-in.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { isTier } from '../vendor/dto-core/tier'
import type { Catalog, CatalogApplet, CatalogSpace, WidgetSize } from './types'

type SpacesFile = {
  spaces: { folder: string; id: string; slug: string; previousSlugs?: string[]; minTier?: string; draft?: boolean; createdBy?: string; draftOf?: string; baseCommit?: string }[]
}

type WorkspaceJson = {
  name?: string
  icon?: string
  theme?: Record<string, string>
  tabs?: { open?: string[]; active?: string }
  widgetGrid?: { i: string; x: number; y: number }[]
}

// Files that are applets: `name.tsx` directly in views/ or widgets/. `_`-prefixed
// files are helpers shared between applets, and tests are never applets.
const APPLET_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tsx$/

export function readSpacesFile(root: string): SpacesFile {
  return JSON.parse(readFileSync(join(root, 'spaces.json'), 'utf8')) as SpacesFile
}

export function misoDir(root: string, folder: string): string {
  return join(root, 'workspaces', folder, '.miso')
}

export function readWorkspaceJson(root: string, folder: string): WorkspaceJson {
  const path = join(misoDir(root, folder), '.workspace.json')
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as WorkspaceJson
  } catch {
    return {}
  }
}

// `export const config = { … } as const` / `satisfies WidgetConfig`. Read from the syntax tree as
// a literal and never run: a member's draft is built too (build/draft-guard.ts), and running its
// config would run its code inside the build. Anything that isn't a plain literal (a call, a
// variable, a spread) makes the whole config fall back to defaults.
class NotLiteral extends Error {}

function literal(node: ts.Expression): unknown {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) {
    return literal(node.expression)
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (node.kind === ts.SyntaxKind.NullKeyword) return null
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(e => (ts.isSpreadElement(e) || ts.isOmittedExpression(e) ? fail() : literal(e)))
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {}
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) fail()
      const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name) ? p.name.text : fail()
      // A key that would reach the prototype is not a config.
      if (name === '__proto__') fail()
      out[name] = literal(p.initializer)
    }
    return out
  }
  return fail()
}

function fail(): never {
  throw new NotLiteral()
}

export function extractConfig(source: string): Record<string, unknown> {
  const sf = ts.createSourceFile('applet.tsx', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement) || !statement.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== 'config' || !decl.initializer) continue
      try {
        const value = literal(decl.initializer)
        return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
      } catch (err) {
        if (err instanceof NotLiteral) return {}
        throw err
      }
    }
  }
  return {}
}

function clampSpan(value: unknown, fallback: WidgetSize): WidgetSize {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : fallback
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(v => typeof v === 'string') ? value : undefined
}

function titleFromName(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function listApplets(root: string, folder: string, kind: 'view' | 'widget'): CatalogApplet[] {
  const dir = join(misoDir(root, folder), kind === 'view' ? 'views' : 'widgets')
  if (!existsSync(dir)) return []
  const applets: CatalogApplet[] = []
  for (const file of readdirSync(dir).sort()) {
    if (!APPLET_FILE.test(file) || file.includes('.test.')) continue
    const name = file.replace(/\.tsx$/, '')
    const source = readFileSync(join(dir, file), 'utf8')
    if (!/export\s+default\b/.test(source)) continue
    const config = extractConfig(source)
    const applet: CatalogApplet = {
      ref: `${folder}/${name}`,
      folder,
      name,
      kind,
      file: `workspaces/${folder}/.miso/${kind === 'view' ? 'views' : 'widgets'}/${file}`,
      title: typeof config.title === 'string' ? config.title : titleFromName(name),
      requiredEnv: stringList(config.requiredEnv) ?? []
    }
    if (typeof config.icon === 'string') applet.icon = config.icon
    // Like a space's minTier in spaces.json: a typo would quietly show it to everyone.
    if (config.minTier !== undefined) {
      if (typeof config.minTier !== 'string' || !isTier(config.minTier)) {
        throw new Error(`${applet.file}: config.minTier "${String(config.minTier)}" isn't a tier.`)
      }
      applet.minTier = config.minTier
    }
    if (kind === 'widget') {
      applet.rowSpan = clampSpan(config.rowSpan, 1)
      applet.colSpan = clampSpan(config.colSpan, 1)
    }
    applets.push(applet)
  }
  return applets
}

export function scanCatalog(root: string): Catalog {
  const { spaces: listed } = readSpacesFile(root)
  const spaces: CatalogSpace[] = listed.map((space, position) => {
    const ws = readWorkspaceJson(root, space.folder)
    // A typo here would quietly show the space to everyone, so it fails the build.
    if (space.minTier !== undefined && !isTier(space.minTier)) {
      throw new Error(`spaces.json: ${space.folder} has minTier "${space.minTier}", which isn't a tier.`)
    }
    return {
      id: space.id,
      slug: space.slug,
      folder: space.folder,
      previousSlugs: space.previousSlugs ?? [],
      position,
      name: ws.name ?? titleFromName(space.folder),
      theme: ws.theme ?? {},
      ...(ws.icon ? { icon: ws.icon } : {}),
      ...(space.minTier ? { minTier: space.minTier } : {}),
      ...(space.draft === true
        ? { draft: true as const, ...(space.createdBy ? { createdBy: space.createdBy } : {}), ...(space.draftOf ? { draftOf: space.draftOf } : {}), ...(space.baseCommit ? { baseCommit: space.baseCommit } : {}) }
        : {})
    }
  })
  const applets = listed.flatMap(space => [
    ...listApplets(root, space.folder, 'view'),
    ...listApplets(root, space.folder, 'widget')
  ])
  return { spaces, applets }
}

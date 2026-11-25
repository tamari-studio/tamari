// Builds the hosted app from this repo:
//
//   dist/                 static site (Vercel serves it from its CDN)
//     index.html
//     assets/…            the shell, one module per view/widget, shared chunks, CSS
//     manifest.json       applet ref → module URL
//   api/_generated/       the API and every space's server functions, bundled
//                         for the Bun runtime (api/server.ts imports it)
//
//   bun app/build.ts [--dev]   (--dev: unminified, sourcemaps)
//
// Both are built next to the last build (dist.next/, api/_generated.next/) and
// swapped in only when everything succeeded, so a failed build leaves a running
// serve.ts with the last good one.
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import tailwind from 'bun-plugin-tailwind'
import { scanCatalog } from './lib/catalog'
import { mediaFiles } from './lib/media'
import type { BuildManifest, Catalog, ClientConfig } from './lib/types'
import { appletRuntimePlugin, ROOT, rootResolverPlugin } from './build/plugins'
import { scanDataMap } from './build/data-map'
import { markSameModules, serverFiles, sourceDirs } from './build/space-files'
import { draftGuardPlugin } from './build/draft-guard'
import { bundleInputProblems, packageGuardPlugin } from './build/package-guard'
import { FAVICON, WORDMARK } from './lib/brand'
import { publicSupabaseUrl } from './server/supabase'

const dev = process.argv.includes('--dev')
const DIST = join(ROOT, 'dist.next')
const ASSETS = join(DIST, 'assets')
const GENERATED = join(ROOT, 'app', '.generated')
const API_GENERATED = join(ROOT, 'api', '_generated.next')
const CLIENT = join(ROOT, 'app', 'client')

const started = performance.now()

function commitSha(): string | null {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)
  const r = Bun.spawnSync(['git', 'rev-parse', '--short', 'HEAD'], { cwd: ROOT })
  return r.success ? r.stdout.toString().trim() : null
}

function fresh(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

// `dist.next` → `dist`, keeping the old one aside until the new one is in place.
function publish(next: string): void {
  const final = next.replace(/\.next$/, '')
  const old = `${final}.old`
  rmSync(old, { recursive: true, force: true })
  if (existsSync(final)) {
    try {
      renameSync(final, old)
    } catch (err) {
      // Docker's overlay filesystem can't rename a folder that came with the image (the Compose
      // install's first build at start): remove it instead.
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err
      rmSync(final, { recursive: true, force: true })
    }
  }
  renameSync(next, final)
  rmSync(old, { recursive: true, force: true })
}

// A package the app has installed: what a draft may import by name (build/draft-guard.ts).
const installed = (name: string) => existsSync(join(ROOT, 'node_modules', name, 'package.json'))

// The Compose install's spaces volume (a git repo of its own): there the app installs each space's
// packages itself (server/space-packages.ts), and the build checks what their code loads. Elsewhere
// (dev, Vercel) a space's packages come from scripts/install-spaces.ts as before, unchecked.
const SPACES_VOLUME = existsSync(join(ROOT, 'workspaces', '.git'))

function entryName(ref: string, kind: 'view' | 'widget'): string {
  return `${kind}--${ref.replace('/', '--')}`
}

function writeGenerated(catalog: Catalog): { entries: string[]; stylesPath: string } {
  fresh(GENERATED)
  mkdirSync(join(GENERATED, 'entries'), { recursive: true })
  const entries = [join(CLIENT, 'main.tsx')]
  for (const applet of catalog.applets) {
    const file = join(GENERATED, 'entries', `${entryName(applet.ref, applet.kind)}.tsx`)
    writeFileSync(file, `export { default } from ${JSON.stringify(join(ROOT, applet.file))}\n`)
    entries.push(file)
  }

  // Tailwind input: the host theme plus an explicit @source per space folder —
  // Tailwind skips dot-directories like `.miso/` unless they're named.
  const vocabulary = [
    join(ROOT, 'node_modules', 'tw-animate-css', 'dist', 'tw-animate.css'),
    join(CLIENT, 'shadcn.css')
  ].map(path => readFileSync(path, 'utf8'))
  const sources = [CLIENT, ...catalog.spaces.flatMap(s => sourceDirs(ROOT, s.folder))]
  const stylesPath = join(GENERATED, 'styles.css')
  writeFileSync(
    stylesPath,
    [
      `@import 'tailwindcss';`,
      readFileSync(join(CLIENT, 'theme.css'), 'utf8'),
      ...vocabulary,
      `@custom-variant dark (&:is(.dark *));`,
      `@custom-variant dark-or-vivid (&:is(.dark *, [data-vivid], [data-vivid] *));`,
      ...sources.map(dir => `@source ${JSON.stringify(dir)};`),
      readFileSync(join(CLIENT, 'base.css'), 'utf8')
    ].join('\n')
  )
  return { entries, stylesPath }
}

function formatLogs(logs: { message: string; position?: { file: string; line: number } | null }[]): string {
  return logs.map(l => `  ${l.position ? `${relative(ROOT, l.position.file)}:${l.position.line} ` : ''}${l.message}`).join('\n')
}

async function buildClient(catalog: Catalog, entries: string[], stylesPath: string) {
  fresh(DIST)
  const result = await Bun.build({
    entrypoints: [...entries, stylesPath],
    outdir: ASSETS,
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: !dev,
    sourcemap: dev ? 'linked' : 'none',
    publicPath: '/assets/',
    naming: { entry: '[name]-[hash].[ext]', chunk: 'chunk-[hash].[ext]', asset: '[name]-[hash].[ext]' },
    define: {
      'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
      'process.env.MISO_DEPLOY_ENV': JSON.stringify(process.env.VERCEL_ENV ?? 'local')
    },
    plugins: [
      draftGuardPlugin(ROOT, catalog, installed),
      ...(SPACES_VOLUME ? [packageGuardPlugin(join(ROOT, 'workspaces'))] : []),
      appletRuntimePlugin(),
      rootResolverPlugin({ target: 'browser' }),
      tailwind
    ],
    // In the spaces volume: what the bundle read, checked below (build/package-guard.ts).
    ...(SPACES_VOLUME ? { metafile: true } : {}),
    throw: false
  })
  if (!result.success) throw new Error(`Client build failed:\n${formatLogs(result.logs)}`)
  if (SPACES_VOLUME) {
    const metafile = (result as unknown as { metafile?: Parameters<typeof bundleInputProblems>[0] }).metafile
    const problems = metafile ? bundleInputProblems(metafile, { root: realpathSync(ROOT), cwd: process.cwd() }) : ["the bundler gave no list of the files it read, so the space's packages can't be checked."]
    if (problems.length) throw new Error(`Client build failed:\n${problems.slice(0, 20).map(p => `  ${p}`).join('\n')}`)
  }

  const entryOutputs = result.outputs.filter(o => o.kind === 'entry-point')
  // Exact `<name>-<hash>.<ext>`: a prefix match would let `partners` pick up
  // `partners-overview-<hash>.js`.
  const find = (name: string, ext: string) => {
    const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[a-z0-9]+\\${ext}$`)
    return entryOutputs.find(o => pattern.test(basename(o.path)))
  }
  const main = find('main', '.js')
  if (!main) throw new Error('Client build produced no main bundle')
  const modules: Record<string, string> = {}
  for (const applet of catalog.applets) {
    const out = find(entryName(applet.ref, applet.kind), '.js')
    if (out) modules[`${applet.kind}:${applet.ref}`] = `/assets/${basename(out.path)}`
  }
  const cssOutputs = result.outputs.filter(o => o.path.endsWith('.css'))
  // A view's or widget's own stylesheet loads with it (Applet.tsx), not from index.html, where it
  // would hold up the first paint of every page.
  const moduleCss: Record<string, string> = {}
  for (const applet of catalog.applets) {
    const pattern = new RegExp(`^${entryName(applet.ref, applet.kind).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-[a-z0-9]+\\.css$`)
    const out = cssOutputs.find(o => pattern.test(basename(o.path)))
    if (out) moduleCss[`${applet.kind}:${applet.ref}`] = `/assets/${basename(out.path)}`
  }
  const css = cssOutputs.map(o => `/assets/${basename(o.path)}`)
  const stylesCss = css.find(href => basename(href).startsWith('styles-'))
  const ordered = [...(stylesCss ? [stylesCss] : []), ...css.filter(href => href !== stylesCss)]
  const lazy = new Set(Object.values(moduleCss))
  return {
    main: `/assets/${basename(main.path)}`,
    modules,
    moduleCss,
    css: ordered,
    headCss: ordered.filter(href => !lazy.has(href))
  }
}

// What /api/config answers, when this build has the environment for it (Vercel builds do; the CI
// gate doesn't). In index.html the browser starts without that round trip. Vercel applies an env
// change only to a new deployment, so this can't be staler than the server's own answer.
function inlineConfig(commit: string | null, builtAt: string): ClientConfig | null {
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null
  return { supabaseUrl: publicSupabaseUrl(), supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY, commit, builtAt }
}

function writeIndexHtml(mainSrc: string, css: string[], config: ClientConfig | null) {
  const template = readFileSync(join(CLIENT, 'index.html'), 'utf8')
  const head = [
    `<link rel="icon" href="${FAVICON}" />`,
    ...(config
      ? [`<script id="miso-config" type="application/json">${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`]
      : []),
    ...css.map(href => `<link rel="stylesheet" href="${href}" />`),
    `<script type="module" src="${mainSrc}"></script>`
  ].join('\n    ')
  writeFileSync(join(DIST, 'index.html'), template.replace('<!-- miso:head -->', head).replace(/<title>[^<]*<\/title>/, `<title>${WORDMARK}</title>`))
}

// Each space's servable media, copied to api/_generated/files/workspaces/<folder>/, which
// vercel.json's includeFiles ships with the function: on Vercel, /api/files has no spaces checkout.
function copyMedia(catalog: Catalog): number {
  let count = 0
  for (const { folder } of catalog.spaces) {
    const from = join(ROOT, 'workspaces', folder)
    for (const rel of mediaFiles(from)) {
      const to = join(API_GENERATED, 'files', 'workspaces', folder, rel)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(join(from, rel), to)
      count++
    }
  }
  return count
}

async function buildServer(catalog: Catalog, commit: string | null, builtAt: string) {
  fresh(API_GENERATED)
  copyMedia(catalog)
  // A draft's own server modules are never bundled: they don't run (server/drafts.ts), and an
  // unchanged one runs from its live space's folder.
  const files = catalog.spaces.filter(s => !s.draft).flatMap(s => serverFiles(ROOT, s.folder))
  const entry = join(GENERATED, 'server-entry.ts')
  const catalogPath = join(GENERATED, 'catalog.json')
  writeFileSync(catalogPath, JSON.stringify(catalog))
  const dataMapPath = join(GENERATED, 'data-map.json')
  writeFileSync(dataMapPath, JSON.stringify(scanDataMap(ROOT, catalog)))
  writeFileSync(
    entry,
    [
      `import { createApp } from ${JSON.stringify(join(ROOT, 'app', 'server', 'app.ts'))}`,
      `import catalog from ${JSON.stringify(catalogPath)}`,
      `import dataMap from ${JSON.stringify(dataMapPath)}`,
      ``,
      `// Each space server module is its own chunk, loaded on its first call, so`,
      `// one module that can't load here (a local-only dependency) breaks only itself.`,
      `const modules = {`,
      ...files.map(f => `  ${JSON.stringify(f.key)}: () => import(${JSON.stringify(f.path)}),`),
      `}`,
      ``,
      `export function createMisoApp(root?: string) {`,
      `  return createApp({ catalog, dataMap, modules, commit: ${JSON.stringify(commit)}, builtAt: ${JSON.stringify(builtAt)}, root })`,
      `}`
    ].join('\n')
  )

  // Packages a space's server code imports that no install here provides stay
  // external: that one module fails when called, the rest of the API works.
  const unresolved = new Set<string>()
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: API_GENERATED,
    target: 'bun',
    format: 'esm',
    splitting: true,
    // Smaller to load on a cold start; names stay, so stack traces in the logs still read.
    minify: dev ? false : { whitespace: true, syntax: true, identifiers: false },
    sourcemap: 'none',
    naming: { entry: 'server-entry.[ext]', chunk: 'chunk-[hash].[ext]', asset: '[name]-[hash].[ext]' },
    // No draft guard here: a draft's own server files are left out above, so no draft code is in
    // this bundle.
    plugins: [rootResolverPlugin({ target: 'bun', onUnresolved: spec => unresolved.add(spec) })],
    throw: false
  })
  if (!result.success) throw new Error(`Server build failed:\n${formatLogs(result.logs)}`)
  writeFileSync(
    join(API_GENERATED, 'server-entry.d.ts'),
    `import type { Hono } from 'hono'\nexport declare function createMisoApp(root?: string): Hono\n`
  )
  return { files: files.length, unresolved: [...unresolved] }
}

const commit = commitSha()
const builtAt = new Date().toISOString()
const catalog = scanCatalog(ROOT)
markSameModules(ROOT, catalog)
const { entries, stylesPath } = writeGenerated(catalog)
const client = await buildClient(catalog, entries, stylesPath)
writeIndexHtml(client.main, client.headCss, inlineConfig(commit, builtAt))
const manifest: BuildManifest = {
  builtAt,
  commit,
  modules: client.modules,
  moduleCss: client.moduleCss,
  css: client.css
}
writeFileSync(join(DIST, 'manifest.json'), JSON.stringify(manifest))
const server = await buildServer(catalog, commit, builtAt)
publish(DIST)
publish(API_GENERATED)

const views = catalog.applets.filter(a => a.kind === 'view').length
const widgets = catalog.applets.length - views
console.log(
  `miso: built ${catalog.spaces.length} spaces, ${views} views, ${widgets} widgets, ` +
    `${server.files} server modules in ${Math.round(performance.now() - started)}ms`
)
if (server.unresolved.length) {
  console.log(`miso: left external (only works where installed): ${server.unresolved.join(', ')}`)
}

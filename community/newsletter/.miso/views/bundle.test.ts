// The server code bundled the way the hosted build bundles it (target bun, split chunks, a
// package that can't be resolved left as a bare require) must not leave any bare require or
// import of an npm package. On Vercel there is no node_modules beside the bundle, so Bun tries to
// auto-install such a package at runtime, fails on the read-only filesystem (EROFS) and the
// whole function dies (FUNCTION_INVOCATION_FAILED), try/catch or not. linkedom's optional
// `require("canvas")` did exactly that; stubs/canvas now resolves it at build time.
import { expect, test } from 'bun:test'
import { builtinModules } from 'node:module'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const BUILTINS = new Set(builtinModules.flatMap(m => [m, `node:${m}`]))
/** Resolved by the runtime or the hosted app itself, never by an install. */
function hostProvided(spec: string): boolean {
  return BUILTINS.has(spec) || spec.startsWith('node:') || spec.startsWith('bun:') || spec === 'bun' || spec.startsWith('@miso/')
}

test('the bundled server code has no bare package require or import', async () => {
  const out = mkdtempSync(join(tmpdir(), 'newsletter-bundle-'))
  const unresolved = new Set<string>()
  try {
    const result = await Bun.build({
      entrypoints: [join(import.meta.dir, 'news.server.ts')],
      outdir: out,
      target: 'bun',
      format: 'esm',
      splitting: true,
      plugins: [
        {
          // Like the hosted build's resolver plugin: what doesn't resolve stays external (a bare require).
          name: 'leave-unresolved-external',
          setup(build) {
            build.onResolve({ filter: /^[^./]/ }, args => {
              if (hostProvided(args.path)) return { path: args.path, external: true }
              try {
                Bun.resolveSync(args.path, dirname(args.importer))
                return undefined
              } catch {
                unresolved.add(args.path)
                return { path: args.path, external: true }
              }
            })
          }
        }
      ]
    })
    expect(result.success).toBe(true)
    expect([...unresolved]).toEqual([])

    const bare: string[] = []
    for (const file of readdirSync(out).filter(f => f.endsWith('.js'))) {
      const code = readFileSync(join(out, file), 'utf8')
      const specifiers = [
        ...code.matchAll(/(?:__require|\brequire)\(\s*["']([^"']+)["']\s*\)/g),
        ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
        ...code.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']/gm),
        ...code.matchAll(/^\s*import\s*["']([^"']+)["']/gm)
      ].map(m => m[1]!)
      for (const s of specifiers) if (!s.startsWith('.') && !s.startsWith('/') && !hostProvided(s)) bare.push(`${file}: ${s}`)
    }
    expect(bare).toEqual([])
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})

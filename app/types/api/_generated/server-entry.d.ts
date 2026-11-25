// What `bun run build` generates at api/_generated/server-entry.js, typed for a
// checkout that hasn't built yet (tsconfig.json's rootDirs). Keep in step with
// buildServer in app/build.ts.
import type { Hono } from 'hono'
export declare function createMisoApp(root?: string): Hono

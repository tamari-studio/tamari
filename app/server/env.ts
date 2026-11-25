// Per-request env for space server code. A space's `*.server.ts` reads
// `process.env.X` directly, so the RPC handler runs each call inside
// `withEnv(...)`, and `process.env` is replaced once by a proxy that answers
// from the current call's env first. Only reads inside a function work: a
// module loads once (rpc.ts), so a read at its top level keeps the env of the
// first call, whichever space and caller that was.
//
// A key set to `undefined` in the scope masks the process value: that's how a
// connector turned off for a space stays invisible there even though the same
// Vercel instance serves every space.
//
// Inside a call, a key the scope doesn't mention reads through to the real env
// only if it is in PASS_THROUGH: everything else the deployment holds (mail,
// cron and OAuth secrets) stays out of space code. Never add MISO_CALLER_*:
// a deployment value there would make every caller that person.
import { AsyncLocalStorage } from 'node:async_hooks'

type EnvScope = Record<string, string | undefined>

const PASS_THROUGH = new Set([
  'NODE_ENV',
  'TZ',
  'VERCEL_ENV',
  'MISO_DEPLOY_ENV',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'MISO_SPACES_EMAIL'
])

const scope = new AsyncLocalStorage<EnvScope>()

// Inside a scope, whether a key the scope doesn't mention may come from the real env.
function hidden(current: EnvScope | undefined, key: string | symbol): boolean {
  return current !== undefined && typeof key === 'string' && !PASS_THROUGH.has(key)
}
// The proxy currently in place. Checked by identity rather than a flag, so if
// something replaces `process.env` wholesale (a test restoring a saved copy),
// the next call wraps the new object instead of silently sharing one env.
let proxy: NodeJS.ProcessEnv | null = null

function install(): void {
  if (proxy !== null && process.env === proxy) return
  const base = process.env
  proxy = process.env = new Proxy(base, {
    get(target, key) {
      const current = scope.getStore()
      if (current && typeof key === 'string' && Object.hasOwn(current, key)) return current[key]
      if (hidden(current, key)) return undefined
      return Reflect.get(target, key)
    },
    // A write inside a call stays in that call, so one space's server code
    // can't leave a value behind for the next request.
    set(target, key, value) {
      const current = scope.getStore()
      if (current && typeof key === 'string') {
        current[key] = value === undefined ? undefined : String(value)
        return true
      }
      return Reflect.set(target, key, value)
    },
    deleteProperty(target, key) {
      const current = scope.getStore()
      if (current && typeof key === 'string') {
        current[key] = undefined
        return true
      }
      return Reflect.deleteProperty(target, key)
    },
    has(target, key) {
      const current = scope.getStore()
      if (current && typeof key === 'string' && Object.hasOwn(current, key)) {
        return current[key] !== undefined
      }
      if (hidden(current, key)) return false
      return Reflect.has(target, key)
    },
    ownKeys(target) {
      const current = scope.getStore()
      const keys = new Set(Reflect.ownKeys(target).filter(key => !hidden(current, key)))
      if (current) {
        for (const [key, value] of Object.entries(current)) {
          if (value === undefined) keys.delete(key)
          else keys.add(key)
        }
      }
      return [...keys]
    },
    getOwnPropertyDescriptor(target, key) {
      const current = scope.getStore()
      if (current && typeof key === 'string' && Object.hasOwn(current, key)) {
        const value = current[key]
        return value === undefined
          ? undefined
          : { value, writable: true, enumerable: true, configurable: true }
      }
      if (hidden(current, key)) return undefined
      return Reflect.getOwnPropertyDescriptor(target, key)
    }
  })
}

export function withEnv<T>(env: EnvScope, run: () => Promise<T>): Promise<T> {
  install()
  return scope.run({ ...env }, run)
}

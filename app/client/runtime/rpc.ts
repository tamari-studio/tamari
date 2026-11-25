// What a view's `import { x } from './x.server'` becomes in the browser: a stub
// that posts devalue-encoded arguments to the hosted API, as the signed-in
// person, in the context of the space displaying the applet (session.ts).
import { parse, stringify } from 'devalue'
import { accessToken, displayingSpace } from './session'

// How long to wait before the one retry of a refused borrow. Tests set it to 0.
export const borrowRetry = { delayMs: 1000 }

export function rpc(folder: string, moduleKey: string, name: string) {
  return async (...args: unknown[]): Promise<unknown> => {
    const token = await accessToken()
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
    if (token) headers.Authorization = `Bearer ${token}`
    const space = displayingSpace(folder)
    if (space) headers['x-miso-space'] = space
    const path = [folder, ...moduleKey.split('/'), name].map(encodeURIComponent).join('/')
    const body = stringify(args)
    const post = () => fetch(`/api/rpc/${path}`, { method: 'POST', headers, body })
    let res = await post()
    // A view from another folder may borrow this space only once its tab is
    // saved; a tab opened a moment ago may still be on its way (borrow.ts).
    if (res.status === 404 && res.headers.get('x-miso-borrow') === 'refused') {
      await new Promise(resolve => setTimeout(resolve, borrowRetry.delayMs))
      res = await post()
    }
    const text = await res.text()
    if (!res.ok) {
      let message = text
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text
      } catch {
        // Plain-text error from the RPC handler.
      }
      throw new Error(message || `${moduleKey}.${name} failed (${res.status})`)
    }
    return parse(text)
  }
}

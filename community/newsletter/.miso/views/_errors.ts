// Server errors as one plain line for the page. Kept apart from _ui.tsx so it can be tested
// without React. Tested in _errors.test.ts.

/** Vercel's own error codes, such as FUNCTION_INVOCATION_FAILED or FUNCTION_INVOCATION_TIMEOUT. */
const PLATFORM_CODE = /\b((?:FUNCTION|EDGE_FUNCTION|MIDDLEWARE|DEPLOYMENT|NO_RESPONSE|INTERNAL)_[A-Z_]{3,})\b/
/** Vercel's request id (region::id), which finds the call in the function logs. */
const REQUEST_ID = /\b([a-z]{3}\d::[a-z0-9]+(?:-[a-z0-9]+)+)\b/i

/**
 * A server error as one line. A platform error page shows its code and request id, so the
 * failure can be looked up in the logs; a clean message from the space's own code shows as is;
 * anything else (HTML, a stack, a gateway page) becomes the plain fallback with its status.
 */
export function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message.trim() : ''
  const code = PLATFORM_CODE.exec(message)?.[1]
  if (code) {
    const id = REQUEST_ID.exec(message)?.[1]
    const what = /TIMEOUT/.test(code) ? 'The server ran out of time' : 'The server stopped before it could answer'
    return `${what} (${code}${id ? `, ${id}` : ''}). Try again; if it repeats, send this line to the builder`
  }
  if (!message || message.length > 240 || message.includes('\n') || /<|timed out|504|502/i.test(message)) {
    const status = /\b(50\d)\b/.exec(message)?.[1]
    return `The server took too long to answer or could not be reached${status ? ` (HTTP ${status})` : ''}`
  }
  return message.replace(/\.$/, '')
}

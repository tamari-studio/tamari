import { expect, test } from 'bun:test'
import { friendlyError } from './_errors'

test('a platform error page shows its code and request id', () => {
  const page = 'A server error has occurred\n\nFUNCTION_INVOCATION_FAILED\n\nfra1::abc12-1763000000000-0f3e9a1b2c3d'
  expect(friendlyError(new Error(page))).toBe(
    'The server stopped before it could answer (FUNCTION_INVOCATION_FAILED, fra1::abc12-1763000000000-0f3e9a1b2c3d). Try again; if it repeats, send this line to the builder'
  )
  expect(friendlyError(new Error('An error occurred with your deployment\n\nFUNCTION_INVOCATION_TIMEOUT\n\nfra1::x1y2z-99'))).toStartWith(
    'The server ran out of time (FUNCTION_INVOCATION_TIMEOUT, fra1::x1y2z-99)'
  )
})

test('clean messages pass through; raw pages fall back to one line', () => {
  expect(friendlyError(new Error('The page answered HTTP 403.'))).toBe('The page answered HTTP 403')
  expect(friendlyError(new Error('<html>502 Bad gateway</html>'))).toBe('The server took too long to answer or could not be reached (HTTP 502)')
  expect(friendlyError(new Error('news.addLink failed (500)'))).toBe('news.addLink failed (500)')
  expect(friendlyError(new Error(''))).toBe('The server took too long to answer or could not be reached')
  expect(friendlyError('nope')).toBe('The server took too long to answer or could not be reached')
})

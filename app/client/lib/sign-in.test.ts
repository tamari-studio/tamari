import { expect, test } from 'bun:test'

import { codeError, googleEnabled, linkNotice, sendError, signInCode, withoutLinkParams } from './sign-in'

test('an expired link says so, from the query or the hash', () => {
  const expired = 'That sign-in link has expired or was already used. Send yourself a new one.'
  expect(linkNotice('?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid', '')).toBe(expired)
  expect(linkNotice('', '#error=access_denied&error_code=otp_expired')).toBe(expired)
})

test("another failed link gets a sentence of ours, never the link's own text", () => {
  const notice = linkNotice('?error=server_error&error_description=Click+evil.example', '')
  expect(notice).toBe("That sign-in link didn't work. Send yourself a new one.")
})

test('a normal address has no notice', () => {
  expect(linkNotice('', '')).toBeUndefined()
  expect(linkNotice('?tab=x', '#section')).toBeUndefined()
})

test('the link leftovers are removed and the rest of the address kept', () => {
  const url = withoutLinkParams(new URL('https://m.test/ops?error=access_denied&error_code=otp_expired&code=abc&tab=x'), false)
  expect(url.toString()).toBe('https://m.test/ops?tab=x')
  expect(withoutLinkParams(new URL('https://m.test/#error=access_denied'), false).hash).toBe('')
  expect(withoutLinkParams(new URL('https://m.test/#section'), false).hash).toBe('#section')
})

test("a signed-in person's code parameter belongs to the view and stays", () => {
  expect(withoutLinkParams(new URL('https://m.test/ops/board?code=SKU-1'), true).toString()).toBe('https://m.test/ops/board?code=SKU-1')
})

test('a rate limit asks the person to wait', () => {
  expect(sendError({ status: 429, message: 'email rate limit exceeded' })).toBe('Wait a minute before asking for another code.')
  expect(sendError({ status: 400, message: 'Invalid email' })).toBe('Invalid email')
})

test('the Google button hides only when the project says Google is off', async () => {
  const answer = (status: number, body: unknown) => (async () => Response.json(body, { status })) as unknown as typeof fetch
  expect(await googleEnabled('https://x.supabase.co', 'k', answer(200, { external: { google: true, email: true } }))).toBe(true)
  expect(await googleEnabled('https://x.supabase.co', 'k', answer(200, { external: { google: false } }))).toBe(false)
  expect(await googleEnabled('https://x.supabase.co', 'k', answer(200, { external: { email: true } }))).toBe(true)
  expect(await googleEnabled('https://x.supabase.co', 'k', answer(500, { error: 'boom' }))).toBe(true)
  const offline = (async () => { throw new TypeError('network') }) as unknown as typeof fetch
  expect(await googleEnabled('https://x.supabase.co', 'k', offline)).toBe(true)
  let sent: [string, RequestInit | undefined] | undefined
  const spy = (async (url: string, init?: RequestInit) => ((sent = [url, init]), Response.json({}))) as unknown as typeof fetch
  await googleEnabled('https://x.supabase.co', 'pub', spy)
  expect(sent).toEqual(['https://x.supabase.co/auth/v1/settings', { headers: { apikey: 'pub' } }])
})

test('a code is 6 to 10 digits, with spaces or a dash allowed', () => {
  expect(signInCode('123456')).toBe('123456')
  expect(signInCode(' 123 456 ')).toBe('123456')
  expect(signInCode('1234-5678')).toBe('12345678')
  expect(signInCode('12345')).toBeNull()
  expect(signInCode('12345678901')).toBeNull()
  expect(signInCode('12a456')).toBeNull()
})

test('a wrong or used code gets our sentence', () => {
  const wrong = "That code didn't work. Check it, or send yourself a new one."
  expect(codeError({ status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' })).toBe(wrong)
  expect(codeError({ status: 429, message: 'rate' })).toBe('Too many tries. Wait a minute, then try again.')
  expect(codeError({ status: 500, message: 'boom' })).toBe('boom')
})

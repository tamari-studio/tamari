// What a sign-in link said when it came back without a session. Supabase puts `error` and
// `error_code` in the query (PKCE) or the hash (implicit flow); a PKCE link opened in another
// browser comes back with a `code` the browser can't exchange. Our own sentences only: anyone can
// put text in a link's error_description.

export function linkNotice(search: string, hash: string): string | undefined {
  const params = new URLSearchParams(search)
  for (const [key, value] of new URLSearchParams(hash.replace(/^#/, ''))) params.append(key, value)
  if (!params.has('error') && !params.has('error_code')) return undefined
  if (params.get('error_code') === 'otp_expired') return LINK_USED
  return "That sign-in link didn't work. Send yourself a new one."
}

export const LINK_USED = 'That sign-in link has expired or was already used. Send yourself a new one.'

export const CODE_NOT_EXCHANGED =
  "That sign-in link didn't work in this browser. Open it in the browser where you asked for it, or send yourself a new one here."

// The link's leftovers, so a reload doesn't show the notice again. `code` only when nobody is
// signed in: then it was a sign-in code that failed (a successful exchange removes it itself), while
// for a signed-in person it may be a view's own query parameter.
export function withoutLinkParams(url: URL, signedIn: boolean): URL {
  const next = new URL(url)
  for (const key of ['error', 'error_code', 'error_description', ...(signedIn ? [] : ['code'])]) next.searchParams.delete(key)
  if (/(^|[#&])error(_code)?=/.test(next.hash)) next.hash = ''
  return next
}

// Supabase answers 429 when the same address asks for codes too quickly.
export function sendError(error: { status?: number; message: string }): string {
  if (error.status === 429) return 'Wait a minute before asking for another code.'
  return error.message
}

// The emailed one-time code as typed or pasted ("123 456", "123-456"), digits only. Projects set the
// length (Supabase allows 6 to 10; new ones get 6), so anything in that range is tried.
export function signInCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '')
  return /^\d{6,10}$/.test(digits) ? digits : null
}

// verifyOtp's wrong or used-up code, in our words; anything else as Supabase says it.
export function codeError(error: { status?: number; code?: string; message: string }): string {
  if (error.status === 429) return 'Too many tries. Wait a minute, then try again.'
  if (error.code === 'otp_expired' || error.status === 403) return "That code didn't work. Check it, or send yourself a new one."
  return error.message
}

// Whether the Supabase project has Google sign-in on. A fresh install doesn't, and its button would
// land on Supabase's raw "provider is not enabled" error. GET /auth/v1/settings is public (the
// publishable key) and lists the providers under `external`. Only an explicit false hides the button: if
// the request fails, it stays, as it always was, so a hiccup never takes Google sign-in away.
export async function googleEnabled(supabaseUrl: string, key: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: key } })
    if (!res.ok) return true
    const body = (await res.json()) as { external?: { google?: unknown } } | null
    return body?.external?.google !== false
  } catch {
    return true
  }
}

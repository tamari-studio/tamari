// The one call to the AI service, and the wording of everything that can go wrong with it.
// Only writer.server.ts imports this file, so the key never reaches the browser.
//
// - It uses `fetch`, not a package, so the space needs nothing installed.
// - The key is read inside the function, not at the top of the file: the file loads once, so a
//   top-level read would keep the key of the first call.
// - A person sees plain sentences. Never the service's own message, and never the key.
// - Hosted functions stop at 60 s, so there is no streaming and no retry: a bounded `max_tokens`
//   and a 45 s timeout keep a slow answer from turning into a bare gateway error. The person
//   presses the button again.

import { WAIT_SECONDS } from './prompt'

const ENDPOINT = 'https://api.anthropic.com/v1/messages'

export const MODEL = 'claude-sonnet-5-5'

/** The model thinks before it writes, and thinking counts toward this cap. An article is roughly 1,500 tokens. */
export const MAX_TOKENS = 8000

export const TIMEOUT_MS = WAIT_SECONDS * 1000

export type Reply = { ok: true; text: string } | { ok: false; error: string }

/** What a test hands in instead of the real network. */
export type Deps = {
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  timeoutMs?: number
}

const CUT_OFF = '[NEEDS: the draft was cut off here. Shorten the notes or split them into two drafts.]'

const fail = (error: string): Reply => ({ ok: false, error })

const TOO_SLOW = `The draft took longer than ${WAIT_SECONDS} seconds. Try again, or shorten the notes.`

/** True when the key is set. The page asks, so it can say so before anyone presses the button. */
export function aiConfigured(): boolean {
  return Boolean(process.env.WRITER_AI_KEY?.trim())
}

/** What a person can do about a failed call, in plain words. `message` is only read here, never passed on. */
function refusedWith(status: number, message: string): string {
  if (status === 401 || status === 403) return 'The AI service rejected the key. Check WRITER_AI_KEY on the Connectors page.'
  if (status === 429) return 'The AI service is busy right now. Wait a minute and try again.'
  // An account out of credit looks like a bug in the app, so say what it is.
  if (/credit balance|billing|payment/i.test(message)) return 'The account behind the AI service is out of credit. Add credit to it, then try again.'
  if (/usage limit|spend(ing)? limit/i.test(message)) return 'The AI service has used its spending limit. Raise the limit with the provider, or wait until it resets.'
  if (status === 529 || status >= 500) return 'The AI service is overloaded right now. Try again in a minute.'
  if (status === 413 || /too long|too many tokens|context (window|length)/i.test(message)) return 'Those notes are too long for the AI service. Cut them down and try again.'
  return `The AI service could not take this request (error ${status}). Try again; if it keeps failing, tell an admin.`
}

/** Writes one article from rough notes. Expected failures come back as `{ ok: false, error }`. */
export async function writeArticle(request: { system: string; notes: string }, deps: Deps = {}): Promise<Reply> {
  const apiKey = process.env.WRITER_AI_KEY?.trim()
  if (!apiKey) return fail('The AI service is not set up yet. Add WRITER_AI_KEY on the Connectors page, then try again.')

  const send = deps.fetch ?? fetch
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, deps.timeoutMs ?? TIMEOUT_MS)

  try {
    const response = await send(ENDPOINT, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // The guide can be long and is the same for every piece in its voice.
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        // The thinking budget is the model's to set; low effort keeps a draft inside the time cap.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: request.notes }]
      }),
      signal: controller.signal
    })
    // The body is read before the timer is cleared, so a slow body counts toward the 45 s too.
    const body = (await response.json().catch(() => null)) as { content?: unknown; stop_reason?: unknown; error?: { type?: unknown; message?: unknown } } | null

    if (timedOut) return fail(TOO_SLOW)

    if (!response.ok) {
      // The service's reason goes to the server log as a type only: no message, no headers.
      console.error('[writer] the AI call failed:', response.status, typeof body?.error?.type === 'string' ? body.error.type : '')
      return fail(refusedWith(response.status, typeof body?.error?.message === 'string' ? body.error.message : ''))
    }
    if (body?.stop_reason === 'refusal') return fail('The AI service declined this request. Reword the notes and try again.')

    const blocks = Array.isArray(body?.content) ? (body.content as { type?: unknown; text?: unknown }[]) : []
    const article = blocks
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text as string)
      .join('')
      .trim()
    if (!article) return fail('The AI service sent back an empty draft. Try again.')
    return { ok: true, text: body?.stop_reason === 'max_tokens' ? `${article}\n\n${CUT_OFF}` : article }
  } catch {
    // Whatever it was, its message may hold parts of the request, so none of it is passed on.
    if (timedOut) return fail(TOO_SLOW)
    console.error('[writer] the AI call could not be made')
    return fail("Couldn't reach the AI service. Try again in a moment.")
  } finally {
    clearTimeout(timer)
  }
}

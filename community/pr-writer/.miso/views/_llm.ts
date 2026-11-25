// The one Anthropic call PR writer makes, and the wording of everything that can
// go wrong with it. Imported only by pr-writer.server.ts.
//
// Hosted functions stop at 60 s and send back one body, so there is no streaming:
// a bounded max_tokens and a client timeout under the cap keep a slow answer from
// becoming a bare gateway error. No retries for the same reason; the member
// presses the button again.
import Anthropic from '@anthropic-ai/sdk'

import { DraftError } from './_pr-writer'

/** The workspace variable holding the key. ANTHROPIC_ and CLAUDE_ names are refused by the hosted app. */
export const KEY_ENV = 'PR_WRITER_ANTHROPIC_KEY'

export const DRAFT_MODEL = 'claude-sonnet-5-5'

/**
 * Sonnet 5.5 always thinks, and thinking counts toward this cap. An article is roughly
 * 1,500 tokens, so this leaves room for both; TIMEOUT_MS, not this, bounds the time.
 */
export const MAX_TOKENS = 8000

/** Under the hosted 60 s cap, with room for the database work around the call. */
export const TIMEOUT_MS = 45_000

const CUT_OFF =
  '[NEEDS: the draft was cut off here. Shorten the input or split it into two drafts.]'

/** What a member can do about a failed call, in plain words. Never the raw provider message. */
export function llmErrorText(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return 'The draft took too long to write. Try again, or shorten the input.'
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Couldn't reach the writing service. Try again in a moment."
  }
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  ) {
    return `The writing service rejected its key. Ask an admin to check ${KEY_ENV}.`
  }
  if (err instanceof Anthropic.RateLimitError) {
    return 'The writing service is busy right now. Wait a minute and try again.'
  }
  if (err instanceof Anthropic.APIError) {
    const message = err.message ?? ''
    // An account out of credit looks like a bug in the app, so say what it is.
    if (/credit balance|billing|payment/i.test(message)) {
      return 'The account behind the writing service is out of credit. Ask an admin to top it up.'
    }
    // A monthly cap on the key's Console workspace. Anthropic answers 400 with
    // "You have reached your specified workspace API usage limits", which looks like a bug.
    if (/usage limit|spend(ing)? limit/i.test(message)) {
      return "The writing service has used this month's spending limit. Ask an admin to raise the limit in the Anthropic Console, or wait for next month."
    }
    if (err.status === 529 || (err.status !== undefined && err.status >= 500)) {
      return 'The writing service is overloaded right now. Try again in a minute.'
    }
    if (err.status === 413)
      return 'That input is too long for the writing service. Cut it down and try again.'
    // The request id lets an admin find the provider's own reason in the Console logs.
    const ref = err.requestID ? `, request ${err.requestID}` : ''
    return `The writing service could not take this request (error ${err.status ?? 'unknown'}${ref}). Try again; if it keeps failing, tell an admin.`
  }
  return 'The draft could not be written. Try again; if it keeps failing, tell an admin.'
}

/** Writes one draft with Claude. Throws DraftError, always with text fit to show. */
export async function completeDraft(request: { system: string; input: string }): Promise<string> {
  const apiKey = process.env[KEY_ENV]?.trim()
  if (!apiKey) {
    throw new DraftError(
      `The writing service isn't set up yet: ${KEY_ENV} is missing. Ask an admin to add it on the Connectors page, then try again.`
    )
  }

  // Built per call, never at module load: the key arrives with each call's env.
  const client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 })
  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: DRAFT_MODEL,
      max_tokens: MAX_TOKENS,
      // The style guide is ~21 KB and the same for every draft in its voice.
      system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
      // Thinking budget is the model's to set; low effort keeps a draft inside the time cap.
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: request.input }]
    })
  } catch (err) {
    // The member sees plain words; the provider's reason goes to the function log.
    console.error('PR writer: Anthropic call failed', err instanceof Error ? err.message : err)
    throw new DraftError(llmErrorText(err))
  }

  if (response.stop_reason === 'refusal') {
    throw new DraftError(
      'The writing service declined this request. Reword the input and try again.'
    )
  }
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
  return response.stop_reason === 'max_tokens' && text ? `${text}\n\n${CUT_OFF}` : text
}

// The two Anthropic calls the Newsletter space makes: rating a batch of articles (Haiku, JSON
// answer) and writing one post (Sonnet, in the channel's tone). The space has its own key,
// NEWSLETTER_ANTHROPIC_KEY, that no other space uses.
//
// Hosted functions stop at 60 s and send back one body, so no streaming: bounded max_tokens and
// a client timeout under the cap. No retries; the next run step tries again.
import Anthropic from '@anthropic-ai/sdk'

/** The workspace variable holding the key. ANTHROPIC_ and CLAUDE_ names are refused by the hosted app. */
export const KEY_ENV = 'NEWSLETTER_ANTHROPIC_KEY'

export const SCORE_MODEL = 'claude-haiku-5-5'
export const WRITE_MODEL = 'claude-sonnet-5-5'

/** Under the hosted 60 s cap, with room for the store reads and writes around the call. */
export const TIMEOUT_MS = 40_000

/** Any failed AI step. The message is plain words fit to show in the space. */
export class LlmError extends Error {}

/** The key isn't set: every AI step stops with this until an admin adds it. */
export class KeyMissingError extends LlmError {}

export const KEY_MISSING = `The AI steps aren't set up yet: ${KEY_ENV} is missing. Ask an admin to add it as a workspace variable at /connectors, then press Run now again.`

export function hasKey(): boolean {
  return Boolean(process.env[KEY_ENV]?.trim())
}

function client(): Anthropic {
  const apiKey = process.env[KEY_ENV]?.trim()
  if (!apiKey) throw new KeyMissingError(KEY_MISSING)
  // Built per call, never at module load: the key arrives with each call's env.
  return new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 0 })
}

/** What a member can do about a failed call, in plain words. Never the raw provider message. */
export function llmErrorText(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionTimeoutError) return 'The AI took too long to answer. The next run tries again.'
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI service. The next run tries again."
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return `The AI service rejected its key. Ask an admin to check ${KEY_ENV}.`
  }
  if (err instanceof Anthropic.RateLimitError) return 'The AI service is busy right now. Wait a minute and run again.'
  if (err instanceof Anthropic.APIError) {
    const message = err.message ?? ''
    if (/credit balance|billing|payment/i.test(message)) {
      return 'The account behind the AI service is out of credit. Ask an admin to top it up.'
    }
    if (/usage limit|spend(ing)? limit/i.test(message)) {
      return "The AI service has used this month's spending limit. Ask an admin to raise it in the Anthropic Console."
    }
    if (err.status === 529 || (err.status !== undefined && err.status >= 500)) {
      return 'The AI service is overloaded right now. Try again in a minute.'
    }
    const ref = err.requestID ? `, request ${err.requestID}` : ''
    return `The AI service could not take this request (error ${err.status ?? 'unknown'}${ref}).`
  }
  return 'The AI step failed. Try again; if it keeps failing, tell an admin.'
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')
    .trim()
}

async function call(label: string, params: Anthropic.MessageCreateParamsNonStreaming): Promise<string> {
  const anthropic = client()
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create(params)
  } catch (err) {
    // The member sees plain words; the provider's reason goes to the function log.
    console.error(`Newsletter: ${label} call failed`, err instanceof Error ? err.message : err)
    throw new LlmError(llmErrorText(err))
  }
  if (response.stop_reason === 'refusal') throw new LlmError('The AI declined this request.')
  if (response.stop_reason === 'max_tokens') throw new LlmError('The AI answer was cut off.')
  const text = textOf(response)
  if (!text) throw new LlmError('The AI sent back an empty answer.')
  return text
}

/** Web research may take longer than the other calls; still under the hosted 60 s cap. */
export const RESEARCH_TIMEOUT_MS = 48_000

/**
 * Researches an article with web search (at most four searches). Returns the AI's text and every
 * URL the searches returned, so only those can be cited.
 */
export async function researchWithSearch(request: { system: string; prompt: string }): Promise<{ text: string; searchedUrls: string[] }> {
  const anthropic = client()
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create(
      {
        model: WRITE_MODEL,
        max_tokens: 8000,
        system: request.system,
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }],
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: request.prompt }]
      },
      { timeout: RESEARCH_TIMEOUT_MS }
    )
  } catch (err) {
    console.error('Newsletter: research call failed', err instanceof Error ? err.message : err)
    throw new LlmError(llmErrorText(err))
  }
  if (response.stop_reason === 'refusal') throw new LlmError('The AI declined to research this article.')
  if (response.stop_reason === 'pause_turn') throw new LlmError('The research took too many steps. Try again.')
  if (response.stop_reason === 'max_tokens') throw new LlmError('The research answer was cut off. Try again.')
  const searchedUrls: string[] = []
  for (const block of response.content) {
    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) if (result.type === 'web_search_result') searchedUrls.push(result.url)
    }
  }
  const text = textOf(response)
  if (!text) throw new LlmError('The AI sent back an empty research answer.')
  return { text, searchedUrls }
}

/** Rates a batch of articles. Returns the raw JSON text that follows `schema`. */
export function rateArticles(request: { system: string; prompt: string; schema: Record<string, unknown> }): Promise<string> {
  return call('rating', {
    model: SCORE_MODEL,
    max_tokens: 8000,
    system: request.system,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } },
    messages: [{ role: 'user', content: request.prompt }]
  })
}

/** Writes one post. The tone guide is the cached system prompt, the same for every post. */
export function writePost(request: { system: string; input: string }): Promise<string> {
  return call('writing', {
    model: WRITE_MODEL,
    max_tokens: 4000,
    system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'low' },
    messages: [{ role: 'user', content: request.input }]
  })
}

/** A 400–800 word blog post takes longer to write than a LinkedIn post; still under the hosted 60 s cap. */
export const BLOG_TIMEOUT_MS = 50_000

/** Writes one blog post (the Blog tab). Returns JSON text following `schema`: a title and a body. */
export async function writeBlog(request: { system: string; input: string; schema: Record<string, unknown> }): Promise<string> {
  const anthropic = client()
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create(
      {
        model: WRITE_MODEL,
        max_tokens: 6000,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } },
        messages: [{ role: 'user', content: request.input }]
      },
      { timeout: BLOG_TIMEOUT_MS }
    )
  } catch (err) {
    console.error('Newsletter: blog call failed', err instanceof Error ? err.message : err)
    throw new LlmError(llmErrorText(err))
  }
  if (response.stop_reason === 'refusal') throw new LlmError('The AI declined to write this blog post.')
  if (response.stop_reason === 'max_tokens') throw new LlmError('The blog post was cut off. Try again.')
  const text = textOf(response)
  if (!text) throw new LlmError('The AI sent back an empty answer.')
  return text
}

/** Proposes criteria descriptions and weights (the Scoring tab's Suggest). Returns JSON text following `schema`. */
export function suggestCriteria(request: { system: string; prompt: string; schema: Record<string, unknown> }): Promise<string> {
  return call('suggesting', {
    model: WRITE_MODEL,
    max_tokens: 6000,
    system: request.system,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: request.schema } },
    messages: [{ role: 'user', content: request.prompt }]
  })
}

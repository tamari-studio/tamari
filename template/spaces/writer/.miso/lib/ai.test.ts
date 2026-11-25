import { afterEach, beforeEach, expect, test } from 'bun:test'

import { MAX_TOKENS, MODEL, TIMEOUT_MS, aiConfigured, writeArticle, type Deps } from './ai'

const KEY = 'test-writer-key-0123456789-secret'
const REQUEST = { system: 'You are a writing assistant, writing in Ada\'s voice.', notes: 'rough notes, a bullet or two' }

// A fake network: it keeps every call, and answers with what the test says. No real request leaves.
type Call = { url: string; init: RequestInit }
function network(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch: NonNullable<Deps['fetch']> = async (url, init) => {
    calls.push({ url, init })
    return answer({ url, init })
  }
  return { fetch, calls }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const answer = (body: Record<string, unknown>) => json(200, { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', ...body })
const failure = (status: number, message: string, type = 'error') => json(status, { type: 'error', error: { type, message } })
const run = (fake: ReturnType<typeof network>, deps: Deps = {}) => writeArticle(REQUEST, { fetch: fake.fetch, ...deps })

const saved = { ...process.env }
const log = console.error
beforeEach(() => {
  process.env.WRITER_AI_KEY = KEY
  console.error = () => {}
})
afterEach(() => {
  console.error = log
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
  Object.assign(process.env, saved)
})

/** Every failure must be a sentence for a person: no key, no provider message. */
function clean(result: { ok: boolean; error?: string }, ...never: string[]) {
  expect(result.ok).toBe(false)
  const text = JSON.stringify(result)
  for (const secret of [KEY, ...never]) expect(text).not.toContain(secret)
  expect(result.error!.length).toBeGreaterThan(20)
  return result.error!
}

test('a good answer comes back as text, from the right request', async () => {
  const fake = network(() => answer({ content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: '# A headline\n\n' }, { type: 'text', text: 'Body copy.\n' }] }))
  expect(await run(fake)).toEqual({ ok: true, text: '# A headline\n\nBody copy.' })

  expect(fake.calls).toHaveLength(1)
  const { url, init } = fake.calls[0]!
  expect(url).toBe('https://api.anthropic.com/v1/messages')
  expect(init.method).toBe('POST')
  expect(init.headers).toEqual({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' })
  expect(init.signal).toBeInstanceOf(AbortSignal)
  const body = JSON.parse(init.body as string)
  expect(body.model).toBe(MODEL)
  expect(MODEL).toBe('claude-sonnet-5-5')
  expect(body.max_tokens).toBe(MAX_TOKENS)
  expect(MAX_TOKENS).toBeGreaterThan(1000)
  expect(MAX_TOKENS).toBeLessThanOrEqual(16_000)
  expect(body.system).toEqual([{ type: 'text', text: REQUEST.system, cache_control: { type: 'ephemeral' } }])
  expect(body.messages).toEqual([{ role: 'user', content: REQUEST.notes }])
  // The key is in the header and nowhere else in the request.
  expect(init.body as string).not.toContain(KEY)
})

test('the time it waits is 45 seconds', () => {
  expect(TIMEOUT_MS).toBe(45_000)
})

test('without the key it says where to add it, and sends nothing', async () => {
  for (const value of [undefined, '', '   ']) {
    if (value === undefined) delete process.env.WRITER_AI_KEY
    else process.env.WRITER_AI_KEY = value
    const fake = network(() => answer({}))
    const error = clean(await run(fake))
    expect(error).toContain('WRITER_AI_KEY')
    expect(error).toContain('Connectors page')
    expect(fake.calls).toHaveLength(0)
    expect(aiConfigured()).toBe(false)
  }
  process.env.WRITER_AI_KEY = KEY
  expect(aiConfigured()).toBe(true)
})

test('the key is read when the call is made, not when the file loads', async () => {
  const first = network(() => answer({}))
  await run(first)
  process.env.WRITER_AI_KEY = 'sk-ant-second-key'
  const second = network(() => answer({}))
  await run(second)
  expect((first.calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe(KEY)
  expect((second.calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-second-key')
})

test('a rejected key says to check the key', async () => {
  for (const status of [401, 403]) {
    const error = clean(await run(network(() => failure(status, `invalid x-api-key ${KEY}`, 'authentication_error'))), 'invalid x-api-key')
    expect(error).toContain('rejected the key')
    expect(error).toContain('WRITER_AI_KEY')
  }
})

test('a rate limit says to wait', async () => {
  expect(clean(await run(network(() => failure(429, 'Number of request tokens has exceeded your per-minute rate limit', 'rate_limit_error'))), 'per-minute')).toContain('busy')
})

test('an overloaded service, or one that fails, says to try again', async () => {
  for (const status of [529, 500, 502, 503]) expect(clean(await run(network(() => failure(status, 'Overloaded', 'overloaded_error'))), 'Overloaded')).toContain('overloaded')
})

test('an account out of credit is called that, and the provider words are not passed on', async () => {
  const raw = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
  const error = clean(await run(network(() => failure(400, raw, 'invalid_request_error'))), raw, 'Plans & Billing')
  expect(error).toContain('out of credit')
  expect(clean(await run(network(() => failure(400, 'You have reached your specified workspace API usage limits.', 'invalid_request_error'))), 'workspace')).toContain('spending limit')
})

test('notes that are too long say so', async () => {
  expect(clean(await run(network(() => failure(413, 'request_too_large', 'request_too_large'))), 'request_too_large')).toContain('too long')
  expect(clean(await run(network(() => failure(400, 'prompt is too long: 250000 tokens > 200000 maximum', 'invalid_request_error'))), '250000')).toContain('too long')
})

test('any other refusal gives its number, not its message', async () => {
  const error = clean(await run(network(() => failure(400, 'messages.0.content: some internal detail', 'invalid_request_error'))), 'internal detail')
  expect(error).toContain('error 400')
  expect(clean(await run(network(() => json(404, 'not even json')))).includes('error 404')).toBe(true)
})

test('an answer with no text is an empty draft, and a body that is not an answer too', async () => {
  for (const body of [{ content: [] }, { content: [{ type: 'text', text: '  \n ' }] }, { content: [{ type: 'thinking', thinking: 'only thoughts' }] }, { content: 'nope' }]) {
    expect(clean(await run(network(() => answer(body)))).toLowerCase()).toContain('empty draft')
  }
  expect(clean(await run(network(() => new Response('<html>gateway</html>', { status: 200 })))).toLowerCase()).toContain('empty draft')
})

test('a refusal by the model is called one', async () => {
  const error = clean(await run(network(() => answer({ content: [{ type: 'text', text: 'I cannot help with that.' }], stop_reason: 'refusal' }))), 'I cannot help')
  expect(error).toContain('declined')
})

test('an answer that ran out of room keeps its text and marks where it stops', async () => {
  const result = await run(network(() => answer({ content: [{ type: 'text', text: 'Half an article' }], stop_reason: 'max_tokens' })))
  expect(result).toEqual({ ok: true, text: 'Half an article\n\n[NEEDS: the draft was cut off here. Shorten the notes or split them into two drafts.]' })
})

test('a slow answer is given up on after the wait, and the request is cancelled', async () => {
  let cancelled = false
  const fake = network(
    ({ init }) =>
      new Promise<Response>((_, reject) => {
        init.signal!.addEventListener('abort', () => {
          cancelled = true
          reject(new DOMException(`the operation was aborted ${KEY}`, 'AbortError'))
        })
      })
  )
  const error = clean(await run(fake, { timeoutMs: 15 }), 'aborted')
  expect(cancelled).toBe(true)
  expect(error).toContain('took longer than 45 seconds')
})

test('a body that never finishes counts toward the wait too', async () => {
  const stuck = network(({ init }) => {
    const body = new Promise<unknown>((_, reject) => init.signal!.addEventListener('abort', () => reject(new Error('stream aborted'))))
    return { ok: true, status: 200, json: () => body } as unknown as Response
  })
  expect(clean(await run(stuck, { timeoutMs: 15 }))).toContain('took longer than 45 seconds')
})

test('a network failure never passes its own message on', async () => {
  const down = network(() => {
    throw new Error(`connect ECONNREFUSED with x-api-key ${KEY}`)
  })
  const error = clean(await run(down), 'ECONNREFUSED')
  expect(error).toContain("Couldn't reach the AI service")
})

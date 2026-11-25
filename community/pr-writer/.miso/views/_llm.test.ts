// The wording of failed calls, and the missing-key path. No network: errors are
// built with the SDK's own factory, and the key check runs before any request.
import { afterEach, describe, expect, test } from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'

import { completeDraft, KEY_ENV, llmErrorText } from './_llm'
import { DraftError } from './_pr-writer'

const apiError = (status: number, message: string, headers = new Headers()) =>
  Anthropic.APIError.generate(
    status,
    { type: 'error', error: { type: 'x', message } },
    message,
    headers
  )

describe('llmErrorText', () => {
  test('a rejected key points at the variable', () => {
    for (const status of [401, 403]) {
      expect(llmErrorText(apiError(status, 'invalid x-api-key'))).toBe(
        `The writing service rejected its key. Ask an admin to check ${KEY_ENV}.`
      )
    }
  })

  test('rate limit and overload say wait and retry', () => {
    expect(llmErrorText(apiError(429, 'rate limited'))).toContain('busy')
    expect(llmErrorText(apiError(529, 'Overloaded'))).toContain('overloaded')
    expect(llmErrorText(apiError(500, 'oops'))).toContain('overloaded')
  })

  test('an account out of credit is named as that, not as a bug', () => {
    expect(
      llmErrorText(apiError(400, 'Your credit balance is too low to access the Anthropic API.'))
    ).toContain('out of credit')
  })

  test('a used-up monthly spending limit is named as that, not as a bug', () => {
    const text = llmErrorText(
      apiError(
        400,
        'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.'
      )
    )
    expect(text).toContain('spending limit')
    expect(text).not.toContain('error 400')
  })

  test('an unrecognised refusal carries the request id for the Console logs', () => {
    const headers = new Headers({ 'request-id': 'req_011abc' })
    const text = llmErrorText(apiError(400, 'messages.0: something new', headers))
    expect(text).toContain('error 400, request req_011abc')
    expect(text).not.toContain('something new')
  })

  test('a timeout and a dropped connection are told apart', () => {
    expect(llmErrorText(new Anthropic.APIConnectionTimeoutError())).toContain('took too long')
    expect(llmErrorText(new Anthropic.APIConnectionError({ message: 'socket hang up' }))).toContain(
      "Couldn't reach"
    )
  })

  test('nothing else leaks the provider message', () => {
    const text = llmErrorText(apiError(400, 'messages.0.content: secret internal detail'))
    expect(text).not.toContain('secret internal detail')
    expect(text).toContain('error 400')
    expect(llmErrorText(new Error('boom'))).not.toContain('boom')
  })
})

describe('completeDraft without a key', () => {
  const saved = process.env[KEY_ENV]
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY_ENV]
    else process.env[KEY_ENV] = saved
  })

  test('throws a DraftError that names the variable, and only when called', async () => {
    delete process.env[KEY_ENV]
    const err = await completeDraft({ system: 's', input: 'i' }).catch(e => e)
    expect(err).toBeInstanceOf(DraftError)
    expect(err.message).toContain(KEY_ENV)
  })

  test('a blank key counts as missing', async () => {
    process.env[KEY_ENV] = '   '
    const err = await completeDraft({ system: 's', input: 'i' }).catch(e => e)
    expect(err).toBeInstanceOf(DraftError)
  })
})

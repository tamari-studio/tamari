import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildErrors, readBuildStatus, waitForBuild, writeBuildStatus } from './build-status'

const dir = mkdtempSync(join(tmpdir(), 'build-status-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const path = join(dir, 'status.json')

test('no file yet reads as null, and a written status reads back', () => {
  expect(readBuildStatus(join(dir, 'none.json'))).toBeNull()
  writeBuildStatus({ id: 1, startedAt: 10, finishedAt: 20, ok: true }, path)
  expect(readBuildStatus(path)).toEqual({ id: 1, startedAt: 10, finishedAt: 20, ok: true })
})

test('waitForBuild skips a build that started before the change and one still running', async () => {
  writeBuildStatus({ id: 1, startedAt: 100, finishedAt: 200, ok: true }, path)
  const waiting = waitForBuild(150, { path, timeoutMs: 2000, pollMs: 10 })
  await Bun.sleep(30)
  writeBuildStatus({ id: 2, startedAt: 300 }, path)
  await Bun.sleep(30)
  writeBuildStatus({ id: 2, startedAt: 300, finishedAt: 400, ok: false, errors: 'views/home.tsx:3 Unexpected }' }, path)
  expect(await waiting).toEqual({ id: 2, startedAt: 300, finishedAt: 400, ok: false, errors: 'views/home.tsx:3 Unexpected }' })
})

test('buildErrors keeps the error and its lines, not the source excerpt or the stack', () => {
  const output = [
    "126 |   if (!result.success) throw new Error(`Client build failed:\\n${formatLogs(result.logs)}`)",
    '                                       ^',
    'error: Client build failed:',
    '  workspaces/acme/.miso/views/hello.tsx:5 Syntax Error',
    '      at buildClient (/app/app/build.ts:126:34)',
    '',
    'Bun v1.3.14 (Linux arm64)'
  ].join('\n')
  expect(buildErrors(output)).toBe('error: Client build failed:\n  workspaces/acme/.miso/views/hello.tsx:5 Syntax Error')
  expect(buildErrors('  something else broke  ')).toBe('something else broke')
})

test('waitForBuild gives up with null', async () => {
  writeBuildStatus({ id: 1, startedAt: 100, finishedAt: 200, ok: true }, path)
  expect(await waitForBuild(500, { path, timeoutMs: 50, pollMs: 10 })).toBeNull()
})

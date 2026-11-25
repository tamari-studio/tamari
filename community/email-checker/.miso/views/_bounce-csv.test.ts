// Reading uploads and writing the results file.
import { describe, expect, test } from 'bun:test'

import { decodeCsv, findEmailColumn, parseCsv, readContacts, resultsCsv, TEMPLATE_CSV } from './_bounce-csv'
import { MAX_ROWS, type EmailVerdict } from './_bounce-shared'

describe('parseCsv', () => {
  test('reads quotes, doubled quotes, line breaks inside quotes, CRLF, a BOM and blank lines', () => {
    const sheet = parseCsv('﻿Name,Email\r\n"Doe, Jane",jane@x.example\r\n\r\n"Say ""hi""\nthere",bo@y.example')
    expect(sheet.headers).toEqual(['Name', 'Email'])
    expect(sheet.rows).toEqual([
      ['Doe, Jane', 'jane@x.example'],
      ['Say "hi"\nthere', 'bo@y.example']
    ])
    expect(sheet.separator).toBe(',')
  })

  test('uses semicolons when the header has more of them (Excel in a Danish locale)', () => {
    const sheet = parseCsv('Navn;E-mail\nJens, Hansen;jens@x.example\n')
    expect(sheet.separator).toBe(';')
    expect(sheet.rows).toEqual([['Jens, Hansen', 'jens@x.example']])
  })
})

describe('decodeCsv', () => {
  test('reads UTF-8, and falls back to Windows-1252 for an Excel save in a Danish locale', () => {
    expect(decodeCsv(new TextEncoder().encode('Navn;Email\nSøren Ærø;s@x.example'))).toContain('Søren Ærø')
    const cp1252 = new Uint8Array([0x53, 0xf8, 0x72, 0x65, 0x6e, 0x20, 0xc6, 0x72, 0xf8]) // "Søren Ærø"
    expect(decodeCsv(cp1252)).toBe('Søren Ærø')
  })
})

describe('parseCsv rows', () => {
  test('keeps a row of only separators, so every contact comes back; drops empty lines; keeps headers as written', () => {
    const sheet = parseCsv(' Name ,Email\n,,\n\nBo,bo@y.example\n')
    expect(sheet.headers).toEqual([' Name ', 'Email'])
    expect(sheet.rows).toEqual([['', '', ''], ['Bo', 'bo@y.example']])
  })
})

describe('findEmailColumn', () => {
  test('prefers an exact name, then any header with email in it', () => {
    expect(findEmailColumn(['Name', 'Email Verified Flag', 'E-Mail'])).toBe(2)
    expect(findEmailColumn(['Name', 'Contact Email'])).toBe(1)
    expect(findEmailColumn(['Name', 'Work_Email'])).toBe(1)
    expect(findEmailColumn(['Name', 'Phone'])).toBe(-1)
  })
})

describe('readContacts', () => {
  test('accepts the template', () => {
    const r = readContacts(TEMPLATE_CSV)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.emailColumn).toBe(3)
  })

  test('explains each file it cannot check', () => {
    const errors = [
      readContacts(''),
      readContacts('Name,Phone\nJane,123\n'),
      readContacts('Email\n'),
      readContacts('Email,Verdict\na@b.example,x\n'),
      readContacts(`Email\n${'a@b.example\n'.repeat(MAX_ROWS + 1)}`)
    ].map(r => (r.ok ? 'ok' : r.error))
    expect(errors[0]).toContain('empty')
    expect(errors[1]).toContain('No email column')
    expect(errors[2]).toContain('no contacts')
    expect(errors[3]).toContain('"Verdict"')
    expect(errors[4]).toContain('split it')
  })
})

describe('resultsCsv', () => {
  test('keeps every original column and row, then appends the result columns', () => {
    const r = readContacts('Name;Email;Note\n"Doe; Jane";jane@x.example;\nBo;bo@y.example;short\n')
    if (!r.ok) throw new Error(r.error)
    const verdicts: EmailVerdict[] = [
      { email_normalized: 'jane@x.example', verdict: 'ok', reason_code: '', mx_host: 'mx.x.example' },
      { email_normalized: 'bo@y.example', verdict: 'skip', reason_code: 'domain_not_found', mx_host: '' }
    ]
    expect(resultsCsv(r.sheet, verdicts, '2026-10-11T21:00:00Z')).toBe(
      '\uFEFFName;Email;Note;email_normalized;verdict;reason_code;mx_host;checked_at\r\n' +
        '"Doe; Jane";jane@x.example;;jane@x.example;ok;;mx.x.example;2026-10-11T21:00:00Z\r\n' +
        'Bo;bo@y.example;short;bo@y.example;skip;domain_not_found;;2026-10-11T21:00:00Z\r\n'
    )
  })
})

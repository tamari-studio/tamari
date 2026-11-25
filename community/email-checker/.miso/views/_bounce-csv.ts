// Reading the contacts file and writing the results file, in the browser. Pure,
// tested in _bounce-csv.test.ts.
import { MAX_ROWS, RESULT_FIELDS, type EmailVerdict } from './_bounce-shared'

export type Sheet = { headers: string[]; rows: string[][]; separator: ',' | ';' }

export type ReadResult =
  | { ok: true; sheet: Sheet; emailColumn: number }
  | { ok: false; error: string }

/** The template people download: four columns. */
export const TEMPLATE_CSV = 'Full Name,Organization,Job Title,Email\nJane Doe,Example Ltd,Head of Partnerships,jane@example.org\n'

/**
 * The file's text. UTF-8 when it is valid UTF-8; otherwise Windows-1252, which
 * is what Excel's plain "CSV" save writes in a Danish locale (æ, ø, å).
 */
export function decodeCsv(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

/** The separator of the first row: comma unless it has more semicolons (Excel in a Danish locale). */
function separatorOf(text: string): ',' | ';' {
  let commas = 0
  let semicolons = 0
  let quoted = false
  for (const c of text) {
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) break
    else if (!quoted && c === ',') commas++
    else if (!quoted && c === ';') semicolons++
  }
  return semicolons > commas ? ';' : ','
}

/**
 * RFC 4180: quoted fields may hold separators and line breaks, "" is one quote.
 * Empty lines are dropped; a row of only separators is kept (its address is
 * empty), so every contact row comes back in the results.
 */
export function parseCsv(input: string): Sheet {
  const text = input.replace(/^﻿/, '')
  const separator = separatorOf(text)
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === separator) {
      record.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else field += c
  }
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  const kept = records.filter(r => r.length > 1 || r[0]!.trim() !== '')
  const [headers = [], ...rows] = kept
  return { headers, rows, separator }
}

const canonical = (name: string) => name.trim().toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

const EMAIL_COLUMNS = ['email', 'emailaddress', 'email1', 'workemail', 'businessemail', 'primaryemail', 'mail']

/** The index of the email column: an exact known name first, then any header containing "email" or ending in "mail". */
export function findEmailColumn(headers: string[]): number {
  const keys = headers.map(canonical)
  for (const candidate of EMAIL_COLUMNS) {
    const i = keys.indexOf(candidate)
    if (i >= 0) return i
  }
  return keys.findIndex(k => k.includes('email') || k.endsWith('mail'))
}

/** Reads an uploaded file into a sheet, or says plainly why it can't be checked. */
export function readContacts(text: string): ReadResult {
  const sheet = parseCsv(text)
  if (sheet.headers.length === 0) {
    return { ok: false, error: 'The file is empty. Download the template to see the layout.' }
  }
  const emailColumn = findEmailColumn(sheet.headers)
  if (emailColumn < 0) {
    return {
      ok: false,
      error: 'No email column found. Name a column "Email" (or "Email address"), or download the template to see the layout.'
    }
  }
  const ours = new Set(RESULT_FIELDS.map(canonical))
  const taken = sheet.headers.filter(h => ours.has(canonical(h)))
  if (taken.length > 0) {
    return {
      ok: false,
      error: `The file already has a ${taken.map(t => `"${t}"`).join(', ')} column, which the results would overwrite. Remove or rename it and upload again.`
    }
  }
  if (sheet.rows.length === 0) return { ok: false, error: 'The file has a header row but no contacts.' }
  if (sheet.rows.length > MAX_ROWS) {
    return {
      ok: false,
      error: `The file has ${sheet.rows.length.toLocaleString('en')} rows. Check at most ${MAX_ROWS.toLocaleString('en')} at a time: split it and upload each part.`
    }
  }
  return { ok: true, sheet, emailColumn }
}

const quote = (value: string, separator: string) =>
  /["\r\n]/.test(value) || value.includes(separator) || /^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

/**
 * The results file: every original column, then RESULT_FIELDS. Same separator as
 * the upload, UTF-8 with a byte-order mark so Excel opens æ, ø, å correctly.
 */
export function resultsCsv(sheet: Sheet, verdicts: EmailVerdict[], checkedAt: string): string {
  const lines = [[...sheet.headers, ...RESULT_FIELDS]]
  sheet.rows.forEach((row, i) => {
    const v = verdicts[i]!
    const cells = sheet.headers.map((_, c) => row[c] ?? '')
    lines.push([...cells, v.email_normalized, v.verdict, v.reason_code, v.mx_host, checkedAt])
  })
  return '\uFEFF' + lines.map(cells => cells.map(c => quote(c, sheet.separator)).join(sheet.separator)).join('\r\n') + '\r\n'
}

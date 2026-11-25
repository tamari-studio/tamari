// Checks for values that come from the browser. Every server function of this space runs its
// arguments through these before anything is saved, and saved rows go through them again when
// they are read, because another space can write to the same collection.
//
// A message thrown here is shown to the person, so it says what to fix in plain words.
// This file is the same in every starter template (cli/template.test.ts checks that).

export function fields(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('That could not be read. Reload the page and try again.')
  return input as Record<string, unknown>
}

/** A trimmed single line of text, '' when left out. */
export function text(value: unknown, label: string, options: { required?: boolean; max?: number } = {}): string {
  const max = options.max ?? 120
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const clean = value.replace(/\s+/g, ' ').trim()
  if (options.required && !clean) throw new Error(`${label} is needed.`)
  if (clean.length > max) throw new Error(`${label} is too long (${max} characters at most).`)
  return clean
}

/** Text that keeps its line breaks, for notes. */
export function longText(value: unknown, label: string, max = 2000): string {
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string') throw new Error(`${label} must be text.`)
  const clean = value.replace(/\r\n?/g, '\n').trim()
  if (clean.length > max) throw new Error(`${label} is too long (${max} characters at most).`)
  return clean
}

export function choice<T extends string>(value: unknown, label: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) throw new Error(`${label} must be one of: ${options.join(', ')}.`)
  return value as T
}

function realDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** A day as YYYY-MM-DD, '' when left out. */
export function day(value: unknown, label: string, options: { required?: boolean } = {}): string {
  if (value === undefined || value === null) value = ''
  if (typeof value !== 'string') throw new Error(`${label} must be a date.`)
  if (!value) {
    if (options.required) throw new Error(`${label} is needed.`)
    return ''
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !realDate(value)) throw new Error(`${label} must be a date.`)
  return value
}

/** A month as YYYY-MM. */
export function month(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error(`${label} must be a month, such as 2026-03.`)
  return value
}

/** A time of day as HH:MM (24 hours). */
export function time(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error(`${label} must be a time, such as 09:30.`)
  return value
}

/** A number from `min` to `max`, or null when left out. Text from a form field is read as a number. */
export function amount(value: unknown, label: string, options: { min?: number; max?: number; whole?: boolean; required?: boolean } = {}): number | null {
  const min = options.min ?? 0
  const max = options.max ?? 1_000_000_000_000
  if (value === undefined || value === null || value === '') {
    if (options.required) throw new Error(`${label} is needed.`)
    return null
  }
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+([.,]\d+)?$/.test(value.trim()) ? Number(value.trim().replace(',', '.')) : NaN
  if (!Number.isFinite(number)) throw new Error(`${label} must be a number.`)
  if (options.whole && !Number.isInteger(number)) throw new Error(`${label} must be a whole number.`)
  if (number < min || number > max) throw new Error(`${label} must be from ${min} to ${max}.`)
  return number
}

export function yesNo(value: unknown): boolean {
  return value === true
}

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/

/** The key of a saved row. It comes back from the browser on every change, so it is checked like any other value. */
export function rowKey(value: unknown): string {
  if (typeof value !== 'string' || !KEY.test(value)) throw new Error('That row could not be found. Reload the page and try again.')
  return value
}

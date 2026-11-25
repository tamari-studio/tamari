// The drafts: what a piece holds (the notes it grew from, the text, where it stands), the check
// every row goes through, and the small sums the page and the widget show. No data access here
// (that is writer.server.ts).
import { choice, fields, longText, text } from './check'
import { MAX_GUIDE_NAME } from './guides'

export const STATUSES = ['draft', 'final'] as const
export type Status = (typeof STATUSES)[number]

export const STATUS_LABEL: Record<Status, string> = { draft: 'Draft', final: 'Final' }

export const MAX_DRAFTS = 500
export const MAX_TITLE = 120
export const MAX_NOTES = 60_000
export const MAX_DRAFT_TEXT = 60_000

export type Draft = {
  title: string
  /** The name of the style guide it was written in, or '' when written by hand. */
  guide: string
  /** The rough notes the piece grew from. */
  notes: string
  /** The article. Empty while only the notes exist. */
  text: string
  status: Status
  /** When the server last saved it (ISO, with a Z), or '' for a row saved before this field existed. */
  updatedAt: string
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

function stamp(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string' || !STAMP.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw new Error('The time of the last change must be a date and a time.')
  }
  return value
}

/** Checks a draft. A field that is left out gets its default, so rows saved before it existed still load. */
export function parseDraft(input: unknown): Draft {
  const raw = fields(input)
  return {
    title: text(raw.title, 'Title', { required: true, max: MAX_TITLE }),
    guide: text(raw.guide, 'Style guide', { max: MAX_GUIDE_NAME }),
    notes: longText(raw.notes, 'Notes text', MAX_NOTES),
    text: longText(raw.text, 'Draft text', MAX_DRAFT_TEXT),
    status: raw.status === undefined || raw.status === null || raw.status === '' ? 'draft' : choice(raw.status, 'Status', STATUSES),
    updatedAt: stamp(raw.updatedAt)
  }
}

/** The drafts, the one changed last first. */
export function newestFirst<T extends Pick<Draft, 'title' | 'updatedAt'>>(drafts: T[]): T[] {
  return [...drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title))
}

export function summary(drafts: Draft[]): { total: number; final: number; inProgress: number } {
  const final = drafts.filter(d => d.status === 'final').length
  return { total: drafts.length, final, inProgress: drafts.length - final }
}

/** A title for a piece that has none: its first line, without the marks that make it a heading. */
export function suggestTitle(body: string): string {
  const line = body
    .split('\n')
    .map(l => l.replace(/^[\s#>*_\-"“]+/, '').replace(/[\s*_"”]+$/, '').trim())
    .find(Boolean)
  if (!line) return 'Untitled draft'
  return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line
}

const GAP = /\[NEEDS:[^\]]*\]/g

/** The text in pieces, so a page can mark the gaps the writing service left as `[NEEDS: …]`. */
export function gapParts(body: string): { text: string; gap: boolean }[] {
  const parts: { text: string; gap: boolean }[] = []
  let from = 0
  for (const match of body.matchAll(GAP)) {
    if (match.index > from) parts.push({ text: body.slice(from, match.index), gap: false })
    parts.push({ text: match[0], gap: true })
    from = match.index + match[0].length
  }
  if (from < body.length) parts.push({ text: body.slice(from), gap: false })
  return parts
}

export const countGaps = (body: string): number => body.match(GAP)?.length ?? 0

const daysBefore = (today: string, days: number): string => {
  const date = new Date(`${today}T09:30:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString()
}

/** Three invented pieces: one with gaps still to fill, one final, one that is only notes. Dates sit before `today`. */
export function exampleDrafts(today: string): Draft[] {
  return [
    {
      title: 'The scale that talks to the till',
      guide: 'Plain and warm',
      notes: [
        '- bakery on Harbour Street, owner Mette, counted flour by hand every Sunday',
        '- we built a small scale that sends the weight to the till, took three weeks',
        '- she orders on Sunday night now and is done by ten',
        '- want a quote from her',
        '- how many other bakeries use it?'
      ].join('\n'),
      text: [
        '# The scale that talks to the till',
        '',
        'Every Sunday night, Mette used to count flour by hand. Now she is done by ten.',
        '',
        'Mette runs a bakery on Harbour Street, and last spring she asked us a simple question: can we stop counting by hand? We built a small scale that sends each weight straight to the till. It took us three weeks.',
        '',
        '"[NEEDS: a quote from Mette about what the Sunday evenings were like before]"',
        '',
        'Other bakeries have started using it too: [NEEDS: how many bakeries, and since when]. If you run one and want to try it, write to us and we will set it up with you.'
      ].join('\n'),
      status: 'draft',
      updatedAt: daysBefore(today, 1)
    },
    {
      title: 'The new export is out',
      guide: 'Crisp newsletter',
      notes: ['- export is 3x faster', '- now has the date column', '- no more crash on files over 50 MB', '- old export stays for one more month'].join('\n'),
      text: [
        '# The new export is out',
        '',
        'The new export is out. It is three times faster, it finally includes the date column, and it no longer crashes on files over 50 MB.',
        '',
        'The old export stays for one more month, so nothing breaks while you switch. After that it goes.',
        '',
        'Until next Friday.'
      ].join('\n'),
      status: 'final',
      updatedAt: daysBefore(today, 4)
    },
    {
      title: 'Spring open day: the announcement',
      guide: '',
      notes: ['- open day on a Saturday in April, doors 10 to 16', '- workshop on the hour, free coffee', '- sign-up link to be added', '- who speaks at noon? ask Jonas'].join('\n'),
      text: '',
      status: 'draft',
      updatedAt: daysBefore(today, 9)
    }
  ]
}

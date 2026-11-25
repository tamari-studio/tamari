// The style guides: the voices a person writes in. A guide is a name and the text that describes
// the voice (past articles, a list of dos and don'ts, anything the writer would show a new
// colleague). No data access here (that is writer.server.ts).
import { fields, longText, text } from './check'

export const MAX_GUIDES = 50
export const MAX_GUIDE_NAME = 60
export const MAX_GUIDE_TEXT = 30_000

export type Guide = {
  /** What the voice is called, as it shows in the picker. */
  name: string
  /** The text that describes the voice. It goes into the prompt as it is. */
  text: string
}

const count = (n: number) => n.toLocaleString('en')

export function parseGuide(input: unknown): Guide {
  const raw = fields(input)
  const name = text(raw.name, 'Name', { required: true, max: MAX_GUIDE_NAME })
  const body = longText(raw.text, 'Guide text', MAX_GUIDE_TEXT)
  if (!body) throw new Error('Guide text is needed: paste a few paragraphs in this voice, or describe it.')
  return { name, text: body }
}

/** The words for the limit on how many guides a team keeps. */
export const guidesFull = () => `You can keep ${count(MAX_GUIDES)} style guides at most. Remove one first.`

export function summary(guides: Guide[]): { count: number; characters: number } {
  return { count: guides.length, characters: guides.reduce((sum, guide) => sum + guide.text.length, 0) }
}

/** Two invented voices, one warm and plain, one short and dry. */
export function exampleGuides(): Guide[] {
  return [
    {
      name: 'Plain and warm',
      text: [
        'We write the way we talk to a customer across a table: plain, kind, and in short sentences.',
        '',
        'Do',
        '- Open with the thing the reader cares about, in one or two sentences.',
        '- Say "we" and "you". Use the person\'s name when we have it.',
        '- Use everyday words: "buy", not "purchase"; "help", not "facilitate".',
        '- Give one concrete example before any general point.',
        '- End with what the reader can do next, in one line.',
        '',
        "Don't",
        '- No jargon, no exclamation marks, no "we are thrilled to announce".',
        '- No sentence longer than about 25 words.',
        '',
        'A sample paragraph: "Last spring a bakery on Harbour Street asked us a simple question: can we stop counting flour by hand? We built a small scale that talks to the till. It took three weeks. Now they order on Sunday night and are done by ten."'
      ].join('\n')
    },
    {
      name: 'Crisp newsletter',
      text: [
        'The Friday newsletter: dry, quick and a little wry. The reader has two minutes.',
        '',
        '- Headline: one line, under 70 characters, with a verb.',
        '- The first paragraph says what happened and why it matters. Nothing before it.',
        '- Short paragraphs, three sentences at most. Bullets only for lists of three or more.',
        '- One joke per piece, never at a customer\'s expense.',
        '- Numbers as digits. Dates as "12 March".',
        '- Sign-off is always the same: "Until next Friday."',
        '',
        'A sample opening: "The new export is out. It is faster, it finally includes the date column, and it no longer crashes on files over 50 MB. Here is what changed."'
      ].join('\n')
    }
  ]
}

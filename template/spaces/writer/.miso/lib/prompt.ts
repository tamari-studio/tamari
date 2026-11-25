// The instructions the writing service gets with every request. Pure text: no network and no
// key here, so tests read the prompt as it is.
import type { Guide } from './guides'

/** How long a request may take before it is given up, in seconds. The page tells the person. */
export const WAIT_SECONDS = 45

/** The last thing the prompt says. A gap in the notes is marked, never filled with an invention. */
export const NEEDS_RULE = 'Never invent facts, quotes or figures that are not in the notes. Flag any gap inline as [NEEDS: ...] instead of making it up.'

/**
 * The system prompt for one style guide. It is built by joining strings, with no placeholders to
 * replace, so `$&` or `{name}` in a guide or a voice name stay exactly as they were typed.
 */
export function buildSystemPrompt(guide: Pick<Guide, 'name' | 'text'>): string {
  const name = guide.name.trim()
  return [
    `You are a writing assistant, writing in ${name}'s voice. Below is a tone and style reference for that voice. Match its sentence rhythm, vocabulary and structure closely. The article has to read as ${name}'s own writing, not as generic copy.`,
    '',
    '--- TONE REFERENCE ---',
    guide.text.trim(),
    '--- END TONE REFERENCE ---',
    '',
    "Turn the user's rough notes (a transcript dump, a bullet outline or a rough draft) into a complete article: a clear headline, a tight opening paragraph and body copy that is ready to publish. Write about whatever the notes cover. Reply with the article only, with no preface and no comment on what you did.",
    '',
    NEEDS_RULE
  ].join('\n')
}

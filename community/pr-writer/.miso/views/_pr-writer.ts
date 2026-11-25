// PR writer's pure parts: the system prompt, the checks before a draft, and the
// record kept afterwards. No SDK and no network here: the model is passed in, so
// the tests run with a fake. The Anthropic call is _llm.ts, which only
// pr-writer.server.ts imports.

/** One style guide as the PR writer reads it: a record in the `pr-writer-guides` collection. */
export type StyleGuide = { id: string; name: string; guide: string }

/** Longest input accepted, in characters. A transcript dump is the realistic worst case. */
export const MAX_INPUT_CHARS = 60_000

/** Drafts listed under the writer. */
export const RECENT_DRAFTS = 10

/** A failure with wording a member can act on. Thrown by the model call; shown as is. */
export class DraftError extends Error {}

/** What a draft call needs from the model: a system prompt and the member's input, text back. */
export type Complete = (request: { system: string; input: string }) => Promise<string>

export type DraftResult = { ok: true; draft: string } | { ok: false; error: string }

// The prompt: tone matching and the [NEEDS: ...] rule are what the drafts rely on, so keep them.
// The subject paragraph stops the model from refusing a piece that is not about the writer's
// own organisation.
const SYSTEM_TEMPLATE = `You are a writing assistant, writing in {name}'s voice. Below is a tone/style reference distilled from their past published articles — match its sentence rhythm, vocabulary, and structure precisely. This is not generic PR copy; it needs to read as {name}'s own writing.

--- TONE REFERENCE ---
{tone_reference}
--- END TONE REFERENCE ---

The subject is whatever the input is about: the organisation itself, customers, partners, other companies, people, events and news. Never decline a piece because of its subject.

Turn the user's rough input (a voice-transcript dump, a bullet outline, or a rough draft) into a complete, media-ready article: a clear headline, a tight lede, and body copy ready to paste into a blog or send to journalists. Never invent facts, quotes, or figures that aren't in the input — flag any gap inline as [NEEDS: ...] instead of fabricating it.`

/** The system prompt for one guide. The guide goes in by function so `$&` and the like in its text stay literal. */
export function buildSystemPrompt(guide: Pick<StyleGuide, 'name' | 'guide'>): string {
  return SYSTEM_TEMPLATE.replaceAll('{name}', () => guide.name.trim()).replace(
    '{tone_reference}',
    () => guide.guide.trim()
  )
}

/**
 * One draft: check the input and the guide, call the model, hand back text.
 * Every expected failure comes back as `{ ok: false, error }` so the page can show
 * it next to the input, which stays put for a retry.
 */
export async function writeDraft(args: {
  input: string
  guide: StyleGuide | null
  complete: Complete
}): Promise<DraftResult> {
  const input = args.input.trim()
  if (!input) return { ok: false, error: 'Paste a transcript, outline, or draft first.' }
  if (input.length > MAX_INPUT_CHARS) {
    return {
      ok: false,
      error: `That is ${input.length.toLocaleString('en')} characters; the limit is ${MAX_INPUT_CHARS.toLocaleString('en')}. Cut it down and try again.`
    }
  }
  if (!args.guide)
    return { ok: false, error: 'There is no style guide to write in yet. Add one first.' }

  let draft: string
  try {
    draft = (await args.complete({ system: buildSystemPrompt(args.guide), input })).trim()
  } catch (err) {
    if (err instanceof DraftError) return { ok: false, error: err.message }
    return {
      ok: false,
      error: 'The draft could not be written. Try again; if it keeps failing, tell an admin.'
    }
  }
  if (!draft)
    return { ok: false, error: 'The writing service sent back an empty draft. Try again.' }
  return { ok: true, draft }
}

/** One saved draft, as kept in the `pr-writer-drafts` collection. */
export type DraftRecord = {
  input: string
  output: string
  guide_id: string
  guide_name: string
  model: string
  created_at: string
}

/** Record key: the caller, then the time, so one prefix lists one member's drafts in time order. */
export function draftKey(callerId: string, at: Date): string {
  return `${callerId}/${at.toISOString()}`
}

/** The guide the selector starts on: the first one (the list is sorted by name), else none. */
export function defaultGuideId(guides: { id: string; name: string }[]): string | null {
  return guides[0]?.id ?? null
}

/** Longest voice name and guide text accepted, and most guides kept. */
export const MAX_GUIDE_NAME = 60
export const MAX_GUIDE_CHARS = 30_000
export const MAX_GUIDES = 50

export type GuideInput = { name: string; guide: string }

/** A name and a guide text from the browser, checked and trimmed. The error is fit to show. */
export function parseGuide(name: unknown, guide: unknown): { ok: true; value: GuideInput } | { ok: false; error: string } {
  if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'Give the voice a name.' }
  if (typeof guide !== 'string' || !guide.trim()) return { ok: false, error: 'Paste the style guide text.' }
  const cleanName = name.trim().replace(/\s+/g, ' ')
  if (cleanName.length > MAX_GUIDE_NAME) return { ok: false, error: `The name is longer than ${MAX_GUIDE_NAME} characters.` }
  const cleanGuide = guide.trim()
  if (cleanGuide.length > MAX_GUIDE_CHARS) {
    return { ok: false, error: `The guide is ${cleanGuide.length.toLocaleString('en')} characters; the limit is ${MAX_GUIDE_CHARS.toLocaleString('en')}.` }
  }
  return { ok: true, value: { name: cleanName, guide: cleanGuide } }
}

/** A guide record's key: a short random id, so renaming a voice keeps its drafts' link. */
export function guideKey(random: string): string {
  return `g-${random.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`
}

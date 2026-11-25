import { focusTab } from 'miso'
import { useState } from 'react'

import { proposeChange } from '../lib/notes.server'
import type { ProposalSummary } from '../lib/proposals'
import { byteLength, MAX_NOTE_BYTES, MAX_REASON_CHARS, notePathProblem } from '../lib/paths'
import { errorText, INPUT, OUTLINE, PRIMARY } from './_ui'

/**
 * The form to change a note (`note` given) or add one (`note` null). It sends a proposal, which
 * becomes a pull request on the vault repo; developers review and merge it on GitHub.
 */
export function ProposeForm({ note, onClose }: { note: { path: string; content: string; sha: string } | null; onClose: () => void }) {
  const [path, setPath] = useState(note?.path ?? '')
  const [content, setContent] = useState(note?.content ?? '')
  const [reason, setReason] = useState('')
  const [state, setState] = useState<{ status: 'editing' | 'sending' | 'sent'; error?: string; sent?: ProposalSummary }>({ status: 'editing' })

  const pathProblem = note || path === '' ? null : notePathProblem(path.trim())
  const tooBig = byteLength(content) > MAX_NOTE_BYTES
  const unchanged = note !== null && content === note.content
  const ready = (note !== null || (path.trim() !== '' && !pathProblem)) && content.trim() !== '' && !unchanged && !tooBig && reason.trim() !== ''

  if (state.status === 'sent') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm">
          Sent. Your proposal is{' '}
          {state.sent ? (
            <a href={state.sent.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              pull request #{state.sent.number}
            </a>
          ) : (
            'a pull request'
          )}{' '}
          on GitHub. The note changes when a developer merges it.
        </p>
        <div className="flex gap-2">
          <button type="button" className={PRIMARY} onClick={() => focusTab('view:proposals')}>
            See proposals
          </button>
          <button type="button" className={OUTLINE} onClick={onClose}>
            {note ? 'Back to the note' : 'Back to all notes'}
          </button>
        </div>
      </div>
    )
  }

  const send = () => {
    setState({ status: 'sending' })
    proposeChange({ path: note?.path ?? path.trim(), content, reason, baseSha: note?.sha ?? null }).then(
      sent => setState({ status: 'sent', sent }),
      e => setState({ status: 'editing', error: errorText(e) })
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={e => {
        e.preventDefault()
        if (ready && state.status === 'editing') send()
      }}
    >
      {!note && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Where the note goes</span>
          <input value={path} onChange={e => setPath(e.target.value)} placeholder="Folder/Note name.md" maxLength={200} className={INPUT} />
          {pathProblem && <span className="text-xs text-destructive">{pathProblem}</span>}
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">{note ? 'The note' : 'What it says'}</span>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          spellCheck
          placeholder={'# Title\n\nWrite the note here. Markdown works: # for a heading, - for a list.'}
          className="min-h-96 resize-y rounded-md border bg-background p-3 font-mono text-sm leading-6"
        />
        {tooBig && <span className="text-xs text-destructive">This is too long for one note (at most {MAX_NOTE_BYTES / 1000} kB).</span>}
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Why this change, in one line</span>
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder={note ? 'The deadline moved to March' : 'We had no note about this yet'} maxLength={MAX_REASON_CHARS} className={INPUT} />
      </label>
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex items-center gap-2">
        <button type="submit" className={PRIMARY} disabled={!ready || state.status === 'sending'}>
          {state.status === 'sending' ? 'Sending…' : 'Send for review'}
        </button>
        <button type="button" className={OUTLINE} onClick={onClose}>
          Cancel
        </button>
        <span className="text-xs text-muted-foreground">This opens a pull request. The note changes only when a developer merges it.</span>
      </div>
    </form>
  )
}

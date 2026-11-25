import { IconChevronRight, IconExternalLink, IconFileText, IconFolder, IconPencil, IconPlus, IconSearch } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'

import { splitNote } from '../lib/frontmatter'
import { readNote, searchNotes, type Note, type NoteSearch } from '../lib/notes.server'
import { filterPaths, noteTitle } from '../lib/paths'
import { buildTree, countNotes, type FolderNode } from '../lib/tree'
import { NoteBody } from './_markdown'
import { ProposeForm } from './_propose'
import { Back, errorText, INPUT, OUTLINE } from './_ui'
import { VaultPage } from './_vault'

export const config = { title: 'Vault overview', icon: 'folder' } as const

type Screen = { at: 'list' } | { at: 'note'; path: string } | { at: 'new' }

export default function Vault() {
  return (
    <VaultPage title="Vault" count={v => (v.notes.length === 1 ? '1 note' : `${v.notes.length} notes`)}>
      {vault => <Notes notes={vault.notes} truncated={vault.truncated} />}
    </VaultPage>
  )
}

function Notes({ notes, truncated }: { notes: string[]; truncated: boolean }) {
  const [screen, setScreen] = useState<Screen>({ at: 'list' })
  // Kept here so the search is still there when you come back from a note.
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string[]>([])
  const known = useMemo(() => new Set(notes), [notes])
  const toList = () => setScreen({ at: 'list' })
  const openNote = (path: string) => setScreen({ at: 'note', path })

  if (screen.at === 'note') return <NoteView key={screen.path} path={screen.path} notes={known} onOpen={openNote} onBack={toList} />
  if (screen.at === 'new') {
    return (
      <div className="flex flex-col gap-4">
        <Back label="All notes" onClick={toList} />
        <h2 className="text-xl font-semibold">New note</h2>
        <ProposeForm note={null} onClose={toList} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a note" aria-label="Find a note" className={`${INPUT} min-w-0 flex-1`} />
        <button type="button" className={OUTLINE} onClick={() => setScreen({ at: 'new' })}>
          <IconPlus size={16} stroke={1.75} />
          New note
        </button>
      </div>
      {query.trim() ? <Found notes={notes} query={query} onOpen={openNote} /> : <Folders notes={notes} open={open} setOpen={setOpen} onOpen={openNote} />}
      {truncated && <p className="text-xs text-muted-foreground">The repo is too big for GitHub to list in one go, so some notes are missing.</p>}
    </div>
  )
}

function NoteRow({ path, indent, detail, onOpen }: { path: string; indent?: number; detail?: string; onOpen: (path: string) => void }) {
  return (
    <li>
      <button type="button" onClick={() => onOpen(path)} style={indent === undefined ? undefined : { paddingLeft: indent }} className={`flex w-full gap-1.5 rounded-lg px-2 text-left hover:bg-accent ${detail === undefined ? 'h-8 items-center' : 'items-start py-1.5'}`}>
        <IconFileText size={16} stroke={1.75} className={`shrink-0 text-muted-foreground ${detail === undefined ? '' : 'mt-0.5'}`} />
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{noteTitle(path)}</span>
          {detail !== undefined && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
        </span>
      </button>
    </li>
  )
}

/** Notes whose name matches as you type; "Search inside notes" also looks in their text. */
function Found({ notes, query, onOpen }: { notes: string[]; query: string; onOpen: (path: string) => void }) {
  const byName = useMemo(() => filterPaths(notes, query), [notes, query])
  const [inside, setInside] = useState<{ status: 'idle' } | { status: 'searching' } | { status: 'error'; message: string } | { status: 'done'; result: NoteSearch }>({ status: 'idle' })
  useEffect(() => setInside({ status: 'idle' }), [query])
  const search = () => {
    setInside({ status: 'searching' })
    searchNotes(query).then(
      result => setInside({ status: 'done', result }),
      e => setInside({ status: 'error', message: errorText(e) })
    )
  }
  const inText = inside.status === 'done' ? inside.result.matches.filter(m => m.match === 'text') : []
  return (
    <div className="flex flex-col gap-4 text-sm">
      {byName.length === 0 ? (
        <p className="text-muted-foreground">No note has this in its name.</p>
      ) : (
        <ul className="flex flex-col">
          {byName.slice(0, 100).map(p => (
            <NoteRow key={p} path={p} detail={p} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {byName.length > 100 && <p className="text-xs text-muted-foreground">Showing the first 100 of {byName.length}. Type more to narrow it down.</p>}
      {inside.status === 'idle' && query.trim().length >= 2 && (
        <button type="button" className={`${OUTLINE} self-start`} onClick={search}>
          <IconSearch size={16} stroke={1.75} />
          Search inside notes
        </button>
      )}
      {inside.status === 'searching' && <p className="text-muted-foreground">Searching inside notes…</p>}
      {inside.status === 'error' && <p className="text-destructive">{inside.message}</p>}
      {inside.status === 'done' && !inside.result.searchedText && <p className="text-muted-foreground">Searching inside notes is not available right now, so only names were searched.</p>}
      {inside.status === 'done' && inside.result.searchedText && (
        <section className="flex flex-col gap-1">
          <h2 className="px-2 text-xs font-medium text-muted-foreground">{inText.length === 0 ? 'No other note has this in its text.' : 'Mentioned in'}</h2>
          <ul className="flex flex-col">
            {inText.map(m => (
              <NoteRow key={m.path} path={m.path} detail={m.snippet || m.path} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Folders({ notes, open, setOpen, onOpen }: { notes: string[]; open: string[]; setOpen: (update: (prev: string[]) => string[]) => void; onOpen: (path: string) => void }) {
  const root = useMemo(() => buildTree(notes), [notes])
  const toggle = (path: string) => setOpen(prev => (prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path]))
  return (
    <>
      <section aria-label="Top folders" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {root.folders.map(f => (
          <button key={f.path} type="button" onClick={() => toggle(f.path)} className="flex flex-col gap-1 rounded-lg border p-3 text-left hover:bg-accent">
            <span className="truncate text-sm font-medium">{f.name}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{countNotes(f) === 1 ? '1 note' : `${countNotes(f)} notes`}</span>
          </button>
        ))}
      </section>
      <ul className="flex flex-col text-sm">
        <Children node={root} depth={0} open={open} toggle={toggle} onOpen={onOpen} />
      </ul>
    </>
  )
}

function Children({ node, depth, open, toggle, onOpen }: { node: FolderNode; depth: number; open: string[]; toggle: (p: string) => void; onOpen: (p: string) => void }) {
  const indent = { paddingLeft: 8 + depth * 14 }
  return (
    <>
      {node.folders.map(f => {
        const isOpen = open.includes(f.path)
        return (
          <li key={f.path}>
            <button type="button" aria-expanded={isOpen} onClick={() => toggle(f.path)} style={indent} className="flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left hover:bg-accent">
              <IconChevronRight size={12} stroke={1.75} className={`shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <IconFolder size={16} stroke={1.75} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">{countNotes(f)}</span>
            </button>
            {isOpen && (
              <ul>
                <Children node={f} depth={depth + 1} open={open} toggle={toggle} onOpen={onOpen} />
              </ul>
            )}
          </li>
        )
      })}
      {node.notes.map(p => (
        <NoteRow key={p} path={p} indent={8 + depth * 14 + 18} onOpen={onOpen} />
      ))}
    </>
  )
}

function NoteView({ path, notes, onOpen, onBack }: { path: string; notes: ReadonlySet<string>; onOpen: (path: string) => void; onBack: () => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; note: Note }>({ status: 'loading' })
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    let current = true
    readNote(path).then(
      note => current && setState({ status: 'ready', note }),
      e => current && setState({ status: 'error', message: errorText(e) })
    )
    return () => {
      current = false
    }
  }, [path])
  const parts = useMemo(() => (state.status === 'ready' ? splitNote(state.note.content) : null), [state])
  return (
    <article className="flex flex-col gap-4">
      <Back label="All notes" onClick={onBack} />
      <header className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-xl font-semibold break-words">{noteTitle(path)}</h2>
          {state.status === 'ready' && !editing && (
            <button type="button" className={OUTLINE} onClick={() => setEditing(true)}>
              <IconPencil size={16} stroke={1.75} />
              Suggest a change
            </button>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="break-all">{path}</span>
          {state.status === 'ready' && (
            <a href={state.note.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              <IconExternalLink size={12} stroke={1.75} />
              Open on GitHub
            </a>
          )}
        </p>
      </header>
      {state.status === 'loading' && <p className="text-sm text-muted-foreground">Loading the note…</p>}
      {state.status === 'error' && <p className="text-sm text-destructive">{state.message}</p>}
      {state.status === 'ready' && editing && <ProposeForm note={state.note} onClose={() => setEditing(false)} />}
      {state.status === 'ready' && !editing && parts && (
        <>
          {parts.properties.length > 0 && (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-lg border p-3 text-xs">
              {parts.properties.map(p => (
                <div key={p.key} className="contents">
                  <dt className="text-muted-foreground">{p.key}</dt>
                  <dd className="min-w-0 break-words">{p.value || '-'}</dd>
                </div>
              ))}
            </dl>
          )}
          {parts.body.trim() ? <NoteBody text={parts.body} path={path} notes={notes} onOpen={onOpen} /> : <p className="text-sm text-muted-foreground">This note is empty.</p>}
        </>
      )}
    </article>
  )
}

// Posts: the drafted LinkedIn posts, two a day, each next to the source text it was written
// from. A person approves, rejects or asks for a rewrite. Approved posts appear in News feed.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconArrowBackUp, IconCheck, IconCopy, IconEdit, IconExternalLink, IconPencil, IconX } from '@tabler/icons-react'

import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { Spinner } from '../ui/spinner'
import { Textarea } from '../ui/textarea'
import { cn } from '../ui/utils'
import { CHANNEL } from './_channel'
import { LinkBox } from './_link-box'
import type { Research } from './_research'
import { NO_SOURCES_MESSAGE } from './_sources'
import { styleWarnings } from './_tone'
import { ago, dayLabel, ErrorLine, friendlyError, KeyMissing, PageHeader, RunBar, timeOut, when, type Load } from './_ui'
import { decidePost, editPost, listPosts, rewritePost, type PostRow } from './news.server'

const CLAIM: Record<Research['claims'][number]['status'], { label: string; variant: 'default' | 'destructive' | 'secondary' }> = {
  confirmed: { label: 'Confirmed', variant: 'default' },
  disputed: { label: 'Disputed', variant: 'destructive' },
  unverified: { label: 'Not confirmed', variant: 'secondary' }
}

/** What the web research found, beside a post written from a link. */
function ResearchNotes({ research }: { research: Research }) {
  return (
    <div className="mt-2 flex flex-col gap-3 border-t border-border pt-3">
      <span className="text-muted-foreground">Checked on the web</span>
      {research.summary && <p>{research.summary}</p>}
      <ul className="flex flex-col gap-2">
        {research.claims.map((claim, i) => (
          <li key={i} className="flex flex-col gap-1">
            <span className="flex items-start gap-2">
              <Badge variant={CLAIM[claim.status].variant} className="shrink-0">
                {CLAIM[claim.status].label}
              </Badge>
              <span>{claim.claim}</span>
            </span>
            {claim.note && <span className="text-muted-foreground">{claim.note}</span>}
            {claim.sources.map(source => (
              <a key={source.url} href={source.url} target="_blank" rel="noreferrer" className="truncate text-muted-foreground underline-offset-4 hover:underline">
                {source.title}
              </a>
            ))}
          </li>
        ))}
      </ul>
      {research.otherViews.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Other views</span>
          {research.otherViews.map((view, i) => (
            <p key={i}>
              {view.view}{' '}
              <a href={view.source.url} target="_blank" rel="noreferrer" className="text-muted-foreground underline-offset-4 hover:underline">
                ({view.source.title})
              </a>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export const config = {
  title: 'Posts',
  icon: 'message'
} as const

type Data = { posts: PostRow[]; today: string; hasKey: boolean; sourceCount: number }

const STATUS: Record<PostRow['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Waiting for review', variant: 'outline' },
  approved: { label: 'Approved', variant: 'default' },
  rejected: { label: 'Rejected', variant: 'destructive' }
}

function PostCard({ post, onChange }: { post: PostRow; onChange: (post: PostRow) => void }) {
  const [busy, setBusy] = useState<null | 'approved' | 'rejected' | 'draft' | 'rewrite' | 'edit'>(null)
  const [error, setError] = useState<string | null>(null)
  const [rewriting, setRewriting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')

  function startEdit() {
    setEditText(post.text.replace(/\n*Source: \S+\s*$/, ''))
    setEditing(true)
    setRewriting(false)
  }

  async function saveEdit() {
    setBusy('edit')
    setError(null)
    try {
      const outcome = await timeOut(editPost(post.key, editText))
      if (outcome.ok) {
        onChange(outcome.post)
        setEditing(false)
      } else {
        setError(outcome.error)
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  async function decide(status: 'approved' | 'rejected' | 'draft') {
    setBusy(status)
    setError(null)
    try {
      onChange(await timeOut(decidePost(post.key, status)))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  async function rewrite() {
    setBusy('rewrite')
    setError(null)
    try {
      const outcome = await timeOut(rewritePost(post.key, note))
      if (outcome.ok) {
        onChange(outcome.post)
        setRewriting(false)
        setNote('')
      } else {
        setError(outcome.error)
      }
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(post.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const status = STATUS[post.status]
  const muted = post.status === 'rejected'
  return (
    <article className="grid gap-x-6 gap-y-4 rounded-xl p-5 ring-1 ring-border lg:grid-cols-[1fr_18rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={status.variant}>{status.label}</Badge>
          {post.european && <Badge variant="outline">{CHANNEL.regionFocus}</Badge>}
          {post.origin === 'link' ? (
            <span className="text-muted-foreground">Written from a link{post.addedBy ? ` added by ${post.addedBy}` : ''}</span>
          ) : (
            <span className="text-muted-foreground">Score {post.score}</span>
          )}
          {post.decidedAt && (
            <span className="text-muted-foreground">
              {post.status === 'approved' ? 'Approved' : 'Rejected'} {when(post.decidedAt)}
              {post.decidedBy ? ` by ${post.decidedBy}` : ''}
            </span>
          )}
          {post.handEdited && (
            <Badge variant="outline">
              Edited by hand{post.handEdited.by ? ` by ${post.handEdited.by}` : ''} {when(post.handEdited.at)}
            </Badge>
          )}
        </div>

        <p className={muted ? 'whitespace-pre-wrap text-base text-muted-foreground line-through decoration-1' : 'whitespace-pre-wrap text-base'}>
          {post.text}
        </p>
        {post.status !== 'rejected' && styleWarnings(post.text).length > 0 && (
          <p className="text-sm text-destructive">
            Reads as machine-written: {styleWarnings(post.text).join(', ')}. Rewrite or fix it before approving.
          </p>
        )}

        {rewriting && (
          <div className="flex flex-col gap-2">
            <label htmlFor={`note-${post.key}`} className="text-sm font-medium">
              What should change?
            </label>
            <Textarea
              id={`note-${post.key}`}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="For example: shorter, lead with the funding amount. Leave empty for a fresh version."
              rows={2}
              maxLength={1000}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={rewrite} disabled={busy !== null}>
                {busy === 'rewrite' ? <Spinner data-icon="inline-start" /> : <IconPencil data-icon="inline-start" stroke={1.75} />}
                {busy === 'rewrite' ? 'Rewriting' : 'Rewrite'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRewriting(false)} disabled={busy === 'rewrite'}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {editing && (
          <div className="flex flex-col gap-2">
            <label htmlFor={`edit-${post.key}`} className="text-sm font-medium">
              Your text
            </label>
            <Textarea id={`edit-${post.key}`} value={editText} onChange={e => setEditText(e.target.value)} rows={10} maxLength={3000} />
            <span className="text-sm text-muted-foreground">The source line is added back when you save. The current text is kept as an earlier version.</span>
            {styleWarnings(editText).length > 0 && (
              <span className="text-sm text-destructive">Reads as machine-written: {styleWarnings(editText).join(', ')}</span>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={busy !== null || !editText.trim()}>
                {busy === 'edit' && <Spinner data-icon="inline-start" />}
                Save text
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy === 'edit'}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!rewriting && !editing && (
          <div className="flex flex-wrap items-center gap-2">
            {post.status === 'draft' ? (
              <>
                <Button size="sm" onClick={() => decide('approved')} disabled={busy !== null}>
                  {busy === 'approved' ? <Spinner data-icon="inline-start" /> : <IconCheck data-icon="inline-start" stroke={1.75} />}
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide('rejected')} disabled={busy !== null}>
                  {busy === 'rejected' ? <Spinner data-icon="inline-start" /> : <IconX data-icon="inline-start" stroke={1.75} />}
                  Reject
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => decide('draft')} disabled={busy !== null}>
                {busy === 'draft' ? <Spinner data-icon="inline-start" /> : <IconArrowBackUp data-icon="inline-start" stroke={1.75} />}
                Back to review
              </Button>
            )}
            {post.status !== 'rejected' && (
              <Button size="sm" variant="outline" onClick={startEdit} disabled={busy !== null}>
                <IconEdit data-icon="inline-start" stroke={1.75} />
                Edit text
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setRewriting(true)} disabled={busy !== null}>
              <IconPencil data-icon="inline-start" stroke={1.75} />
              Rewrite with AI
            </Button>
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? <IconCheck data-icon="inline-start" stroke={1.75} /> : <IconCopy data-icon="inline-start" stroke={1.75} />}
              {copied ? 'Copied' : 'Copy text'}
            </Button>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {post.versions.length > 0 && (
          <div className="text-sm">
            <button
              type="button"
              className="text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setShowVersions(v => !v)}
            >
              {showVersions ? 'Hide' : 'Show'} {post.versions.length === 1 ? 'the earlier version' : `${post.versions.length} earlier versions`}
            </button>
            {showVersions && (
              <ol className="mt-2 flex flex-col gap-3">
                {[...post.versions].reverse().map((version, i) => (
                  <li key={i} className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">
                      Written {when(version.at)}
                      {version.replacedBy === 'hand-edit'
                        ? `; replaced by a hand edit${version.by ? ` by ${version.by}` : ''}`
                        : version.note
                          ? `; AI rewrite asked for: ${version.note}`
                          : '; AI rewrite for a fresh version'}
                    </span>
                    <p className="whitespace-pre-wrap text-muted-foreground">{version.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted p-4 text-sm">
        <span className="text-muted-foreground">Written from</span>
        <a href={post.url} target="_blank" rel="noreferrer" className="group inline-flex items-start gap-1 font-medium">
          <span className="group-hover:underline">{post.title}</span>
          <IconExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" stroke={1.75} />
        </a>
        <span className="text-muted-foreground">
          {post.sourceName}, {ago(post.published)}
        </span>
        <p className={cn('whitespace-pre-wrap text-muted-foreground', post.research ? 'line-clamp-6' : 'line-clamp-[14]')}>{post.excerpt}</p>
        {post.research && <ResearchNotes research={post.research} />}
      </aside>
    </article>
  )
}

export default function Posts() {
  const [data, setData] = useState<Load<Data>>({ kind: 'loading' })

  const load = useCallback(() => {
    listPosts().then(
      value => setData({ kind: 'ready', value }),
      err => setData({ kind: 'error', message: friendlyError(err) })
    )
  }, [])
  useEffect(load, [load])

  const replace = useCallback((post: PostRow) => {
    setData(current =>
      current.kind === 'ready'
        ? { kind: 'ready', value: { ...current.value, posts: current.value.posts.map(p => (p.key === post.key ? post : p)) } }
        : current
    )
  }, [])

  const days = useMemo(() => {
    if (data.kind !== 'ready') return []
    const byDay = new Map<string, PostRow[]>()
    for (const post of data.value.posts) byDay.set(post.day, [...(byDay.get(post.day) ?? []), post])
    return [...byDay].sort(([a], [b]) => b.localeCompare(a))
  }, [data])

  const waiting = data.kind === 'ready' ? data.value.posts.filter(p => p.status === 'draft').length : 0

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <PageHeader title="Posts">
          {data.kind === 'ready' && (
            <span className="text-sm text-muted-foreground">
              {waiting === 0 ? 'Nothing waiting for review' : `${waiting} waiting for review`}
            </span>
          )}
        </PageHeader>
        <RunBar onFinished={load} noSources={data.kind === 'ready' && data.value.sourceCount === 0} />
        {data.kind === 'ready' && <LinkBox hasKey={data.value.hasKey} onWritten={load} />}
        {data.kind === 'ready' && !data.value.hasKey && <KeyMissing />}

        {data.kind === 'loading' && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        )}
        {data.kind === 'error' && <ErrorLine message={data.message} onRetry={load} />}
        {data.kind === 'ready' && days.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {data.value.sourceCount === 0
              ? `No posts yet. ${NO_SOURCES_MESSAGE} You can also write a post from a link above.`
              : "No posts yet. Press Run now to fetch the news and draft today's two posts."}
          </p>
        )}
        {data.kind === 'ready' &&
          days.map(([day, posts]) => (
            <section key={day} className="flex flex-col gap-4">
              <h2 className="text-base font-medium">{dayLabel(day, data.value.today)}</h2>
              {[...posts]
                .sort((a, b) => a.slot - b.slot)
                .map(post => (
                  <PostCard key={post.key} post={post} onChange={replace} />
                ))}
            </section>
          ))}
      </div>
    </div>
  )
}

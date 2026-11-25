// Blog: upload one or more .md files and the AI writes one 400–800 word blog post from them, in
// the same tone as the Posts tab. A person approves, rejects or edits it; approved
// blog posts appear in the News feed as cards.
import { useCallback, useEffect, useRef, useState } from 'react'
import { IconAlertTriangle, IconArrowBackUp, IconCheck, IconCopy, IconEdit, IconFileText, IconPencil, IconUpload, IconX } from '@tabler/icons-react'

import { Alert, AlertDescription } from '../ui/alert'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Spinner } from '../ui/spinner'
import { Textarea } from '../ui/textarea'
import { MAX_BLOG_FILE_CHARS, MAX_BLOG_FILES, MAX_BLOG_TOTAL_CHARS, wordCount, type BlogSourceFile } from './_blog'
import { CHANNEL } from './_channel'
import { styleWarnings } from './_tone'
import { dayLabel, ErrorLine, friendlyError, KeyMissing, PageHeader, timeOut, when, type Load } from './_ui'
import { decideBlog, editBlog, listBlogs, writeBlogPost, type BlogRow } from './news.server'

export const config = {
  title: 'Blog',
  icon: 'file'
} as const

type Data = { blogs: BlogRow[]; today: string; hasKey: boolean }

const STATUS: Record<BlogRow['status'], { label: string; variant: 'default' | 'destructive' | 'outline' }> = {
  draft: { label: 'Waiting for review', variant: 'outline' },
  approved: { label: 'Approved', variant: 'default' },
  rejected: { label: 'Rejected', variant: 'destructive' }
}

const n = (value: number) => value.toLocaleString('en-GB')

/** Choose .md files, say what to focus on, and write the post. */
function WriteBox({ hasKey, onWritten }: { hasKey: boolean; onWritten: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<BlogSourceFile[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function add(list: FileList | null) {
    setError(null)
    setDone(null)
    const chosen = [...(list ?? [])]
    const wrong = chosen.filter(f => !/\.(md|markdown|txt)$/i.test(f.name))
    if (wrong.length > 0) setError(`Only .md files can be used; left out ${wrong.map(f => f.name).join(', ')}.`)
    const read = await Promise.all(chosen.filter(f => !wrong.includes(f)).map(async f => ({ name: f.name, text: await f.text() })))
    const tooLong = read.find(f => f.text.length > MAX_BLOG_FILE_CHARS)
    if (tooLong) setError(`${tooLong.name} is longer than ${n(MAX_BLOG_FILE_CHARS)} characters. Shorten it or split it.`)
    setFiles(current => {
      const byName = new Map(current.map(f => [f.name, f]))
      for (const f of read) if (f.text.length <= MAX_BLOG_FILE_CHARS) byName.set(f.name, f)
      return [...byName.values()].slice(0, MAX_BLOG_FILES)
    })
    if (input.current) input.current.value = ''
  }

  async function write() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const outcome = await timeOut(writeBlogPost(files, note))
      if (!outcome.ok) return setError(outcome.error)
      setDone(`Wrote "${outcome.blog.title}", ${n(wordCount(outcome.blog.body))} words. It is in the list below.`)
      setFiles([])
      setNote('')
      onWritten()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  const total = files.reduce((sum, f) => sum + f.text.length, 0)
  const tooMuch = total > MAX_BLOG_TOTAL_CHARS
  return (
    <section aria-labelledby="blog-write" className="flex flex-col gap-3">
      <h2 id="blog-write" className="text-base font-medium">
        Write a blog post
      </h2>
      <div
        className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4"
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          if (!busy) void add(e.dataTransfer.files)
        }}
      >
        <input ref={input} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple hidden onChange={e => void add(e.target.files)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => input.current?.click()} disabled={busy || files.length >= MAX_BLOG_FILES}>
            <IconUpload data-icon="inline-start" stroke={1.75} />
            Choose .md files
          </Button>
          <span className="text-sm text-muted-foreground">or drop them here. Up to {MAX_BLOG_FILES} files, {n(MAX_BLOG_TOTAL_CHARS)} characters together.</span>
        </div>
        {files.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {files.map(f => (
              <li key={f.name} className="flex items-center gap-2">
                <IconFileText className="size-4 shrink-0 text-muted-foreground" stroke={1.75} />
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="shrink-0 text-muted-foreground">{n(f.text.length)} characters</span>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Remove ${f.name}`}
                  disabled={busy}
                  onClick={() => setFiles(current => current.filter(c => c.name !== f.name))}
                >
                  <IconX stroke={1.75} />
                </Button>
              </li>
            ))}
            {tooMuch && (
              <li className="text-destructive">
                {n(total)} characters together; the limit is {n(MAX_BLOG_TOTAL_CHARS)}. Remove a file.
              </li>
            )}
          </ul>
        )}
        <Input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="What should the post focus on? (optional)"
          aria-label="What the post should focus on"
          maxLength={1000}
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={write} disabled={busy || files.length === 0 || tooMuch || !hasKey}>
            {busy ? <Spinner data-icon="inline-start" /> : <IconPencil data-icon="inline-start" stroke={1.75} />}
            {busy ? 'Writing the blog post' : 'Write the blog post'}
          </Button>
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {busy
              ? 'Up to a minute'
              : hasKey
                ? `400–800 words in the ${CHANNEL.name} tone, using only facts from the files.`
                : 'Needs the AI key (NEWSLETTER_ANTHROPIC_KEY) to write.'}
          </span>
        </div>
      </div>
      {done && <p className="text-sm">{done}</p>}
      {error && (
        <Alert variant="destructive">
          <IconAlertTriangle stroke={1.75} />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </section>
  )
}

function BlogCard({ blog, onChange }: { blog: BlogRow; onChange: (blog: BlogRow) => void }) {
  const [busy, setBusy] = useState<null | 'approved' | 'rejected' | 'draft' | 'edit'>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  async function decide(status: 'approved' | 'rejected' | 'draft') {
    setBusy(status)
    setError(null)
    try {
      onChange(await timeOut(decideBlog(blog.key, status)))
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  function startEdit() {
    setTitle(blog.title)
    setBody(blog.body)
    setEditing(true)
  }

  async function saveEdit() {
    setBusy('edit')
    setError(null)
    try {
      const outcome = await timeOut(editBlog(blog.key, title, body))
      if (!outcome.ok) return setError(outcome.error)
      onChange(outcome.blog)
      setEditing(false)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(`${blog.title}\n\n${blog.body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const status = STATUS[blog.status]
  const muted = blog.status === 'rejected'
  const warnings = blog.status === 'rejected' ? [] : styleWarnings(`${blog.title}\n\n${blog.body}`)
  const editWarnings = editing ? styleWarnings(`${title}\n\n${body}`) : []
  return (
    <article className="grid gap-x-6 gap-y-4 rounded-xl p-5 ring-1 ring-border lg:grid-cols-[1fr_18rem]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className="text-muted-foreground">{n(wordCount(blog.body))} words</span>
          {blog.decidedAt && (
            <span className="text-muted-foreground">
              {blog.status === 'approved' ? 'Approved' : 'Rejected'} {when(blog.decidedAt)}
              {blog.decidedBy ? ` by ${blog.decidedBy}` : ''}
            </span>
          )}
          {blog.handEdited && (
            <Badge variant="outline">
              Edited by hand{blog.handEdited.by ? ` by ${blog.handEdited.by}` : ''} {when(blog.handEdited.at)}
            </Badge>
          )}
        </div>

        {editing ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`title-${blog.key}`} className="text-sm font-medium">
              Title
            </label>
            <Input id={`title-${blog.key}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
            <label htmlFor={`body-${blog.key}`} className="text-sm font-medium">
              Text
            </label>
            <Textarea id={`body-${blog.key}`} value={body} onChange={e => setBody(e.target.value)} rows={18} maxLength={12000} />
            <span className="text-sm text-muted-foreground">{n(wordCount(body))} words. The current text is kept as an earlier version.</span>
            {editWarnings.length > 0 && <span className="text-sm text-destructive">Reads as machine-written: {editWarnings.join(', ')}</span>}
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={busy !== null || !title.trim() || !body.trim()}>
                {busy === 'edit' && <Spinner data-icon="inline-start" />}
                Save text
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy === 'edit'}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className={muted ? 'flex flex-col gap-3 text-muted-foreground line-through decoration-1' : 'flex flex-col gap-3'}>
            <h3 className="text-lg font-medium">{blog.title}</h3>
            <p className="whitespace-pre-wrap text-base">{blog.body}</p>
          </div>
        )}

        {!editing && warnings.length > 0 && (
          <p className="text-sm text-destructive">Reads as machine-written: {warnings.join(', ')}. Fix it before approving.</p>
        )}

        {!editing && (
          <div className="flex flex-wrap items-center gap-2">
            {blog.status === 'draft' ? (
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
            {blog.status !== 'rejected' && (
              <Button size="sm" variant="outline" onClick={startEdit} disabled={busy !== null}>
                <IconEdit data-icon="inline-start" stroke={1.75} />
                Edit text
              </Button>
            )}
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

        {blog.versions.length > 0 && (
          <div className="text-sm">
            <button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={() => setShowVersions(v => !v)}>
              {showVersions ? 'Hide' : 'Show'} {blog.versions.length === 1 ? 'the earlier version' : `${blog.versions.length} earlier versions`}
            </button>
            {showVersions && (
              <ol className="mt-2 flex flex-col gap-3">
                {[...blog.versions].reverse().map((version, i) => (
                  <li key={i} className="flex flex-col gap-1 text-muted-foreground">
                    <span className="text-xs">
                      Written {when(version.at)}; replaced by a hand edit{version.by ? ` by ${version.by}` : ''}
                    </span>
                    <span className="font-medium">{version.title}</span>
                    <p className="whitespace-pre-wrap">{version.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-2 self-start rounded-lg bg-muted p-4 text-sm">
        <span className="text-muted-foreground">Written from</span>
        <ul className="flex flex-col gap-1">
          {blog.sources.map(source => (
            <li key={source.name} className="flex items-center gap-1.5">
              <IconFileText className="size-4 shrink-0 text-muted-foreground" stroke={1.75} />
              <span className="min-w-0 truncate">{source.name}</span>
            </li>
          ))}
        </ul>
        {blog.note && <span className="text-muted-foreground">Focus asked for: {blog.note}</span>}
        <span className="text-muted-foreground">
          Written {when(blog.writtenAt)}
          {blog.writtenBy ? ` for ${blog.writtenBy}` : ''}
        </span>
      </aside>
    </article>
  )
}

export default function Blog() {
  const [data, setData] = useState<Load<Data>>({ kind: 'loading' })

  const load = useCallback(() => {
    listBlogs().then(
      value => setData({ kind: 'ready', value }),
      err => setData({ kind: 'error', message: friendlyError(err) })
    )
  }, [])
  useEffect(load, [load])

  const replace = useCallback((blog: BlogRow) => {
    setData(current =>
      current.kind === 'ready'
        ? { kind: 'ready', value: { ...current.value, blogs: current.value.blogs.map(b => (b.key === blog.key ? blog : b)) } }
        : current
    )
  }, [])

  const waiting = data.kind === 'ready' ? data.value.blogs.filter(b => b.status === 'draft').length : 0

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <PageHeader title="Blog">
          {data.kind === 'ready' && (
            <span className="text-sm text-muted-foreground">{waiting === 0 ? 'Nothing waiting for review' : `${waiting} waiting for review`}</span>
          )}
        </PageHeader>
        {data.kind === 'ready' && <WriteBox hasKey={data.value.hasKey} onWritten={load} />}
        {data.kind === 'ready' && !data.value.hasKey && <KeyMissing />}

        {data.kind === 'loading' && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-64" />
          </div>
        )}
        {data.kind === 'error' && <ErrorLine message={data.message} onRetry={load} />}
        {data.kind === 'ready' && data.value.blogs.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No blog posts yet. Choose one or more .md files above to write the first.</p>
        )}
        {data.kind === 'ready' && data.value.blogs.length > 0 && (
          <section className="flex flex-col gap-4">
            {data.value.blogs.map((blog, i) => (
              <div key={blog.key} className="flex flex-col gap-4">
                {(i === 0 || data.value.blogs[i - 1]!.day !== blog.day) && <h2 className="text-base font-medium">{dayLabel(blog.day, data.value.today)}</h2>}
                <BlogCard blog={blog} onChange={replace} />
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

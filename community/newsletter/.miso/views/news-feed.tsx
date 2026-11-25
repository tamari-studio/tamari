// News feed: the approved posts and blog posts, newest first, as readers would see them. A blog
// post shows as a card with its title and the first 200 characters; "Read more" opens the rest.
// Read-only; nothing is published anywhere yet.
import { useCallback, useEffect, useState } from 'react'
import { IconExternalLink } from '@tabler/icons-react'

import { Skeleton } from '../ui/skeleton'
import { blogPreview, PREVIEW_CHARS } from './_blog'
import { CHANNEL } from './_channel'
import { ErrorLine, friendlyError, PageHeader, when, type Load } from './_ui'
import { listBlogFeed, listFeed, type BlogRow, type PostRow } from './news.server'

export const config = {
  title: 'News feed',
  icon: 'file'
} as const

type Item = { kind: 'post'; at: string; post: PostRow } | { kind: 'blog'; at: string; blog: BlogRow }

function BlogCard({ blog, at }: { blog: BlogRow; at: string }) {
  const [open, setOpen] = useState(false)
  const preview = blogPreview(blog.body)
  const more = blog.body.replace(/\s+/g, ' ').trim().length > PREVIEW_CHARS
  return (
    <article className="flex flex-col gap-3 rounded-xl p-5 ring-1 ring-border">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">{CHANNEL.name}</span> · Blog
        </span>
        <span>{when(at)}</span>
      </div>
      <h2 className="text-lg font-medium">{blog.title}</h2>
      <p className={open ? 'whitespace-pre-wrap text-base' : 'text-base'}>{open ? blog.body : preview}</p>
      {more && (
        <button
          type="button"
          className="self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </article>
  )
}

export default function NewsFeed() {
  const [data, setData] = useState<Load<Item[]>>({ kind: 'loading' })

  const load = useCallback(() => {
    // A blog list that fails to load never hides the posts.
    Promise.all([listFeed(), listBlogFeed().catch((): BlogRow[] => [])]).then(
      ([posts, blogs]) => {
        const items: Item[] = [
          ...posts.map((post): Item => ({ kind: 'post', at: post.decidedAt ?? post.writtenAt, post })),
          ...blogs.map((blog): Item => ({ kind: 'blog', at: blog.decidedAt ?? blog.writtenAt, blog }))
        ]
        items.sort((a, b) => b.at.localeCompare(a.at))
        setData({ kind: 'ready', value: items })
      },
      err => setData({ kind: 'error', message: friendlyError(err) })
    )
  }, [])
  useEffect(load, [load])

  const posts = data.kind === 'ready' ? data.value.filter(i => i.kind === 'post').length : 0
  const blogs = data.kind === 'ready' ? data.value.length - posts : 0

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        <PageHeader title="News feed">
          {data.kind === 'ready' && data.value.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {posts} approved {posts === 1 ? 'post' : 'posts'}
              {blogs > 0 ? `, ${blogs} ${blogs === 1 ? 'blog post' : 'blog posts'}` : ''}
            </span>
          )}
        </PageHeader>

        {data.kind === 'loading' && (
          <div className="flex flex-col gap-6">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        )}
        {data.kind === 'error' && <ErrorLine message={data.message} onRetry={load} />}
        {data.kind === 'ready' && data.value.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nothing approved yet. Approve a post in the Posts tab or a blog post in the Blog tab and it appears here.
          </p>
        )}
        {data.kind === 'ready' && data.value.length > 0 && (
          <ol className="flex flex-col">
            {data.value.map(item =>
              item.kind === 'blog' ? (
                <li key={`blog-${item.blog.key}`} className="border-b border-border py-6 first:pt-0 last:border-b-0">
                  <BlogCard blog={item.blog} at={item.at} />
                </li>
              ) : (
                <li key={item.post.key} className="flex flex-col gap-3 border-b border-border py-6 first:pt-0 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">{CHANNEL.name}</span>
                    <span>{when(item.at)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-base">{item.post.text.replace(/\n*Source: \S+\s*$/, '')}</p>
                  <a
                    href={item.post.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {item.post.sourceName}: {item.post.title}
                    <IconExternalLink className="size-3.5 shrink-0" stroke={1.75} />
                  </a>
                </li>
              )
            )}
          </ol>
        )}
      </div>
    </div>
  )
}

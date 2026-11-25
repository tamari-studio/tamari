// Articles: what the feeds brought in over the last 7 days, highest score first. The score is a
// weighted sum of the AI's 0–10 ratings, worked out in code from the current weights.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { IconExternalLink } from '@tabler/icons-react'

import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { cn } from '../ui/utils'
import { CHANNEL } from './_channel'
import { NO_SOURCES_MESSAGE } from './_sources'
import { ago, ErrorLine, friendlyError, KeyMissing, PageHeader, RunBar, type Load } from './_ui'
import { listArticles, listSources, type ArticleRow } from './news.server'

export const config = {
  title: 'Articles',
  icon: 'list'
} as const

type Criteria = { id: string; name: string; weight: number }[]
type Data = { articles: ArticleRow[]; criteria: Criteria; maxAgeDays: number; minScore: number; hasKey: boolean; sourceCount: number }

const FILTERS = [
  { id: 'all', label: 'All' },
  // The id is fixed in the code; the label is the channel's region focus (_channel.ts).
  { id: 'europe', label: CHANNEL.regionFocus },
  { id: 'unrated', label: 'Not rated' }
] as const
type Filter = (typeof FILTERS)[number]['id']

const REGION: Record<string, string> = { europe: 'Europe', us: 'US', china: 'China', other: 'Other' }

function Score({ article }: { article: ArticleRow }) {
  if (article.score === null) {
    return <span className="text-sm text-muted-foreground">{article.gaveUp ? 'Failed' : 'Not rated'}</span>
  }
  return (
    <span
      className={cn(
        'text-2xl font-medium tabular-nums',
        article.score >= 60 ? 'text-foreground' : 'text-muted-foreground'
      )}
    >
      {article.score}
    </span>
  )
}

function Ratings({ article, criteria }: { article: ArticleRow; criteria: Criteria }) {
  if (!article.ratings) return null
  const ratings = article.ratings as Record<string, number>
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {criteria.map(c => (
        <span key={c.id} className="tabular-nums">
          {c.name} <span className="text-foreground">{ratings[c.id]}</span>
        </span>
      ))}
    </div>
  )
}

function ArticleItem({ article, criteria }: { article: ArticleRow; criteria: Criteria }) {
  return (
    <li className="grid grid-cols-[3.5rem_1fr] gap-4 border-b border-border py-4 last:border-b-0">
      <div className="pt-0.5 text-right">
        <Score article={article} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <a href={article.url} target="_blank" rel="noreferrer" className="group inline-flex items-start gap-1 font-medium">
          <span className="group-hover:underline">{article.title}</span>
          <IconExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" stroke={1.75} />
        </a>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{article.sourceName}</span>
          <span>{ago(article.published)}</span>
          {article.region && <Badge variant="outline">{REGION[article.region]}</Badge>}
          {article.european && article.region !== 'europe' && <Badge variant="outline">{CHANNEL.regionFocus} angle</Badge>}
          {!article.draftable && <Badge variant="secondary">Title only</Badge>}
          {article.allegation && (
            <Badge variant="destructive" title="Rests on unproven allegations about a named person, so it is never drafted">
              Allegations: not drafted
            </Badge>
          )}
          {article.postKey && <Badge>In a post</Badge>}
        </div>
        {article.reason && <p className="text-sm">{article.reason}</p>}
        {!article.reason && article.snippet && <p className="line-clamp-2 text-sm text-muted-foreground">{article.snippet}</p>}
        {article.scoreError && !article.ratings && <p className="text-sm text-destructive">{article.scoreError}</p>}
        <Ratings article={article} criteria={criteria} />
      </div>
    </li>
  )
}

export default function Articles() {
  const [data, setData] = useState<Load<Data>>({ kind: 'loading' })
  const [filter, setFilter] = useState<Filter>('all')
  const [showFiltered, setShowFiltered] = useState(false)

  const load = useCallback(() => {
    Promise.all([listArticles(), listSources()]).then(
      ([result, sources]) => setData({ kind: 'ready', value: { ...result, hasKey: sources.hasKey, sourceCount: sources.sources.length } }),
      err => setData({ kind: 'error', message: friendlyError(err) })
    )
  }, [])
  useEffect(load, [load])

  const shown = useMemo(() => {
    if (data.kind !== 'ready') return []
    const all = showFiltered ? data.value.articles : data.value.articles.filter(a => !a.filteredOut)
    if (filter === 'europe') return all.filter(a => a.european)
    if (filter === 'unrated') return all.filter(a => a.score === null)
    return all
  }, [data, filter, showFiltered])
  const filteredCount = data.kind === 'ready' ? data.value.articles.filter(a => a.filteredOut).length : 0

  const weights =
    data.kind === 'ready' ? data.value.criteria.map(c => `${c.name} ${c.weight}`).join(', ') : ''

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
        <PageHeader title="Articles">
          {data.kind === 'ready' && (
            <span className="text-sm text-muted-foreground">
              {data.value.articles.length} from the last 7 days
            </span>
          )}
        </PageHeader>
        <RunBar onFinished={load} noSources={data.kind === 'ready' && data.value.sourceCount === 0} />
        {data.kind === 'ready' && !data.value.hasKey && <KeyMissing />}

        {data.kind === 'loading' && (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
        )}
        {data.kind === 'error' && <ErrorLine message={data.message} onRetry={load} />}
        {data.kind === 'ready' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1" role="group" aria-label="Show">
                {FILTERS.map(f => (
                  <Button
                    key={f.id}
                    size="sm"
                    variant={filter === f.id ? 'secondary' : 'ghost'}
                    aria-pressed={filter === f.id}
                    onClick={() => setFilter(f.id)}
                  >
                    {f.label}
                  </Button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">Score weights: {weights}</span>
            </div>
            {filteredCount > 0 && (
              <p className="text-sm text-muted-foreground">
                {showFiltered ? 'Showing' : 'Hiding'} {filteredCount} older than {data.value.maxAgeDays} days or scored below{' '}
                {data.value.minScore} (set in Scoring).{' '}
                <button type="button" className="underline-offset-4 hover:underline" onClick={() => setShowFiltered(v => !v)}>
                  {showFiltered ? 'Hide them' : 'Show them'}
                </button>
              </p>
            )}
            {shown.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {data.value.articles.length === 0
                  ? data.value.sourceCount === 0
                    ? `No articles yet. ${NO_SOURCES_MESSAGE}`
                    : 'No articles yet. Press Run now to fetch the feeds.'
                  : 'No articles match this filter.'}
              </p>
            ) : (
              <ul>
                {shown.map(article => (
                  <ArticleItem key={article.key} article={article} criteria={data.value.criteria} />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

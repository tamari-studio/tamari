// Sources: every news feed the Newsletter reads, with its region, how it is fetched, how relevant
// it is to the channel's region focus, and how its last fetch went.
import { useCallback, useEffect, useState } from 'react'
import { IconExternalLink, IconRss } from '@tabler/icons-react'

import { Badge } from '../ui/badge'
import { Skeleton } from '../ui/skeleton'
import { cn } from '../ui/utils'
import { NO_SOURCES_MESSAGE } from './_sources'
import { ago, ErrorLine, friendlyError, PageHeader, RunBar, type Load } from './_ui'
import { listSources, type SourceRow } from './news.server'

export const config = {
  title: 'Sources',
  icon: 'rss'
} as const

const REGION: Record<SourceRow['region'], string> = { europe: 'Europe', us: 'US', china: 'China', global: 'Global' }
const CARRIES: Record<SourceRow['carries'], string> = {
  title: 'Title only',
  summary: 'Summary',
  'full text': 'Full text'
}

function Relevance({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-2" aria-label={`Region relevance ${value} of 5`}>
      <span className="flex gap-0.5" aria-hidden>
        {[1, 2, 3, 4, 5].map(n => (
          <span key={n} className={cn('h-3 w-1.5 rounded-sm', n <= value ? 'bg-primary' : 'bg-muted')} />
        ))}
      </span>
      <span className="tabular-nums text-muted-foreground">{value}/5</span>
    </span>
  )
}

function Status({ source }: { source: SourceRow }) {
  const status = source.status
  if (!status) return <span className="text-muted-foreground">Not fetched yet</span>
  if (!status.ok) {
    return (
      <span className="text-destructive">
        Failed {ago(status.lastRunAt)}: the feed {status.error}
      </span>
    )
  }
  return (
    <span>
      {status.added} new, {status.items} in the last 3 days
      <span className="text-muted-foreground"> ({ago(status.lastRunAt)})</span>
    </span>
  )
}

export default function Sources() {
  const [data, setData] = useState<Load<SourceRow[]>>({ kind: 'loading' })

  const load = useCallback(() => {
    listSources().then(
      result => setData({ kind: 'ready', value: result.sources }),
      err => setData({ kind: 'error', message: friendlyError(err) })
    )
  }, [])
  useEffect(load, [load])

  return (
    <div className="h-full w-full overflow-auto bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <PageHeader title="Sources">
          {data.kind === 'ready' && (
            <span className="text-sm text-muted-foreground">
              {data.value.length === 0
                ? 'No feeds yet'
                : `${data.value.length} feeds, ${data.value.filter(s => s.status?.ok).length} working`}
            </span>
          )}
        </PageHeader>
        <RunBar onFinished={load} noSources={data.kind === 'ready' && data.value.length === 0} />

        {data.kind === 'loading' && (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-14" />
            ))}
          </div>
        )}
        {data.kind === 'error' && <ErrorLine message={data.message} onRetry={load} />}
        {data.kind === 'ready' && data.value.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <IconRss className="size-6 text-muted-foreground" stroke={1.5} />
            <p className="font-medium">No sources yet</p>
            <p className="max-w-md text-sm text-muted-foreground">{NO_SOURCES_MESSAGE}</p>
          </div>
        )}
        {data.kind === 'ready' && data.value.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-2 pr-4 font-normal">Source</th>
                  <th className="py-2 pr-4 font-normal">Region</th>
                  <th className="py-2 pr-4 font-normal">Fetched by</th>
                  <th className="py-2 pr-4 font-normal">Region relevance</th>
                  <th className="py-2 font-normal">Last fetch</th>
                </tr>
              </thead>
              <tbody>
                {data.value.map(source => (
                  <tr key={source.id} className="border-b border-border align-top last:border-b-0">
                    <td className="py-3 pr-4">
                      <a
                        href={source.site}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-medium hover:underline"
                      >
                        {source.name}
                        <IconExternalLink className="size-3.5 text-muted-foreground" stroke={1.75} />
                      </a>
                      <div className="text-muted-foreground">{source.topics}</div>
                    </td>
                    <td className="py-3 pr-4">{REGION[source.region]}</td>
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap gap-1">
                        <Badge variant="outline">RSS</Badge>
                        <Badge variant={source.carries === 'title' ? 'secondary' : 'outline'}>{CARRIES[source.carries]}</Badge>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <Relevance value={source.europe} />
                    </td>
                    <td className="py-3">
                      <Status source={source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-sm text-muted-foreground">
              Title-only feeds are rated but not written into posts: a post uses only facts from the feed's own text.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

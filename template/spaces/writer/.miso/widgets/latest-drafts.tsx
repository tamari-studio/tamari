import { newestFirst, summary } from '../lib/drafts'
import { listDrafts } from '../lib/writer.server'
import { Tile, TileRow, useRows } from '../ui/kit'

export const config = { title: 'Latest drafts', rowSpan: 2, colSpan: 2 } as const

export default function LatestDrafts() {
  const { state } = useRows(listDrafts)
  if (state.status === 'loading') return <Tile title="Latest drafts" note="Loading…" />
  if (state.status === 'error') return <Tile title="Latest drafts" note="Could not load the drafts." />
  if (state.rows.length === 0) return <Tile title="Latest drafts" value="0" note="Write one on the Writer page." />

  const { total, final } = summary(state.rows)
  const latest = newestFirst(state.rows).slice(0, 3)
  return (
    <Tile title="Latest drafts" value={String(total)} note={final === 0 ? 'None final yet' : `${final} final`}>
      {/* Rows that do not fit wrap into a second column, which the tile clips: only whole rows show. */}
      <div className="flex flex-1 flex-col flex-wrap content-start gap-1 overflow-hidden [&>*]:w-full">
        {latest.map(draft => (
          <TileRow key={draft.key} label={draft.title} />
        ))}
      </div>
    </Tile>
  )
}

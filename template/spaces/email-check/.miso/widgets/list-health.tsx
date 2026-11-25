import { VERDICT_LABEL, summary } from '../lib/contacts'
import { listContacts } from '../lib/contacts.server'
import { Tile, TileRow, useRows } from '../ui/kit'

export const config = { title: 'List health', rowSpan: 2, colSpan: 2 } as const

export default function ListHealth() {
  const { state } = useRows(listContacts)
  if (state.status === 'loading') return <Tile title="List health" note="Loading…" />
  if (state.status === 'error') return <Tile title="List health" note="Could not load the contacts." />
  if (state.rows.length === 0) return <Tile title="List health" value="–" note="Add addresses on the Contacts page." />

  const sums = summary(state.rows)
  // The rows are whole lines: one that does not fit wraps into a second column, which the tile clips.
  return (
    <Tile title="List health" value={sums.share === null ? '–' : `${sums.share}%`} note={sums.share === null ? 'Nothing checked yet' : `of ${sums.checked} checked are good`} tone={sums.share !== null && sums.share < 50 ? 'bad' : undefined}>
      <ul className="flex h-full flex-col flex-wrap content-start gap-1 overflow-hidden [&>li]:w-full">
        <li>
          <TileRow label={VERDICT_LABEL.ok} detail={String(sums.ok)} />
        </li>
        <li>
          <TileRow label={VERDICT_LABEL.review} detail={String(sums.review)} />
        </li>
        <li>
          <TileRow label={VERDICT_LABEL.skip} detail={String(sums.skip)} />
        </li>
        <li>
          <TileRow label={VERDICT_LABEL.unchecked} detail={String(sums.unchecked)} />
        </li>
      </ul>
    </Tile>
  )
}

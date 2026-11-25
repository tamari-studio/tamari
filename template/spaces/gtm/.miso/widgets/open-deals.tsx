import { listDeals } from '../lib/deals.server'
import { OPEN, STAGE_LABEL, byStage, summary } from '../lib/deals'
import { Tile, TileRow, today, useRows, wholeNumber } from '../ui/kit'

export const config = { title: 'Open deals', rowSpan: 2, colSpan: 2 } as const

export default function OpenDeals() {
  const { state } = useRows(listDeals)
  if (state.status === 'loading') return <Tile title="Open deals" note="Loading…" />
  if (state.status === 'error') return <Tile title="Open deals" note="Could not load the deals." />
  if (state.rows.length === 0) return <Tile title="Open deals" value="0" note="Add deals on the Pipeline page." />

  const sums = summary(state.rows, today())
  const count = `${sums.open} ${sums.open === 1 ? 'deal' : 'deals'}`
  return (
    <Tile title="Open deals" value={wholeNumber(sums.openValue)} note={sums.overdue > 0 ? `${count} · ${sums.overdue} overdue` : count} tone={sums.overdue > 0 ? 'bad' : undefined}>
      {byStage(state.rows)
        .filter(column => OPEN.includes(column.stage))
        .map(column => (
          <TileRow key={column.stage} label={`${STAGE_LABEL[column.stage]} (${column.deals.length})`} detail={wholeNumber(column.value)} />
        ))}
      <TileRow label="Won" detail={wholeNumber(sums.wonValue)} />
    </Tile>
  )
}

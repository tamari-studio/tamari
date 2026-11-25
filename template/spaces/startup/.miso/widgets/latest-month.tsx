import { listMonths } from '../lib/months.server'
import { cashText, growth, monthBefore, monthLabel, newestFirst, percent } from '../lib/months'
import { Tile, TileRow, useRows, wholeNumber } from '../ui/kit'

export const config = { title: 'Latest month', rowSpan: 2, colSpan: 2 } as const

export default function LatestMonth() {
  const { state } = useRows(listMonths)
  if (state.status === 'loading') return <Tile title="Latest month" note="Loading…" />
  if (state.status === 'error') return <Tile title="Latest month" note="Could not load the months." />
  const latest = newestFirst(state.rows)[0]
  if (!latest) return <Tile title="Latest month" value="0" note="Add a month on the Monthly update page." />

  const before = monthBefore(state.rows, latest)
  const change = growth(latest.revenue, before?.revenue)
  return (
    <Tile title="Monthly revenue" value={wholeNumber(latest.revenue)} note={[monthLabel(latest.month), percent(change)].filter(Boolean).join(' · ')} tone={change !== null && change < 0 ? 'bad' : undefined}>
      <TileRow label="Investor update" detail={latest.sent ? 'Sent' : 'Not sent'} tone={latest.sent ? undefined : 'bad'} />
      <TileRow label={cashText(latest)} />
      <TileRow label="Customers" detail={wholeNumber(latest.customers)} />
      <TileRow label="Cash in the bank" detail={wholeNumber(latest.cash)} />
    </Tile>
  )
}

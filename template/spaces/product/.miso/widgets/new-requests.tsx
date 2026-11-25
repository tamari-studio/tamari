import { listRequests } from '../lib/requests.server'
import { inbox, summary } from '../lib/requests'
import { Tile, TileRow, useRows } from '../ui/kit'

export const config = { title: 'New requests', rowSpan: 2, colSpan: 2 } as const

export default function NewRequests() {
  const { state } = useRows(listRequests)
  if (state.status === 'loading') return <Tile title="New requests" note="Loading…" />
  if (state.status === 'error') return <Tile title="New requests" note="Could not load the requests." />
  if (state.rows.length === 0) return <Tile title="New requests" value="0" note="Add requests on the Roadmap page." />

  const counts = summary(state.rows)
  const waiting = inbox(state.rows)
  return (
    <Tile title="New requests" value={String(waiting.length)} note={`${counts.building} in progress · ${counts.planned} planned`}>
      {waiting.map(request => (
        <TileRow key={request.key} label={request.title} detail={`${request.asked} asked`} />
      ))}
    </Tile>
  )
}

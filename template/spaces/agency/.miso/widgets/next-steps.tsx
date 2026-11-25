import { listClients } from '../lib/clients.server'
import { isOverdue, nextSteps, summary } from '../lib/clients'
import { Tile, TileRow, shortDay, today, useRows } from '../ui/kit'

export const config = { title: 'Next steps', rowSpan: 2, colSpan: 2 } as const

export default function NextSteps() {
  const { state } = useRows(listClients)
  if (state.status === 'loading') return <Tile title="Next steps" note="Loading…" />
  if (state.status === 'error') return <Tile title="Next steps" note="Could not load the clients." />
  if (state.rows.length === 0) return <Tile title="Next steps" value="0" note="Add clients on the Clients page." />

  const now = today()
  const sums = summary(state.rows, now)
  const steps = nextSteps(state.rows)
  return (
    <Tile title="Next steps" value={String(steps.length)} note={sums.overdue > 0 ? `${sums.overdue} overdue` : `${sums.active} active clients`} tone={sums.overdue > 0 ? 'bad' : undefined}>
      {steps.map(client => (
        <TileRow key={client.key} label={`${client.name}: ${client.nextStep}`} detail={shortDay(client.nextDate)} tone={isOverdue(client, now) ? 'bad' : undefined} />
      ))}
    </Tile>
  )
}

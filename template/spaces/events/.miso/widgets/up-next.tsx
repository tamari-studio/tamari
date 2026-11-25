import { listItems } from '../lib/show.server'
import { isLate, summary, upNext } from '../lib/show'
import { Tile, TileRow, shortDay, today, useRows } from '../ui/kit'

export const config = { title: 'Up next', rowSpan: 2, colSpan: 2 } as const

export default function UpNext() {
  const { state } = useRows(listItems)
  if (state.status === 'loading') return <Tile title="Up next" note="Loading…" />
  if (state.status === 'error') return <Tile title="Up next" note="Could not load the run of show." />
  if (state.rows.length === 0) return <Tile title="Up next" value="0" note="Add items on the Run of show page." />

  const clock = new Date()
  const now = { day: today(), time: `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}` }
  const sums = summary(state.rows, now)
  const next = upNext(state.rows)
  const first = next[0]
  if (!first) return <Tile title="Up next" value="All done" note={`${sums.done} of ${state.rows.length} ticked off`} />
  return (
    <Tile title="Up next" value={first.start} note={sums.late > 0 ? `${sums.late} late · ${sums.left} left` : `${sums.left} left · ${sums.done} done`} tone={sums.late > 0 ? 'bad' : undefined}>
      {next.map(item => (
        <TileRow key={item.key} label={item.title} detail={item.day === now.day ? item.start : `${shortDay(item.day)} ${item.start}`} tone={isLate(item, now) ? 'bad' : undefined} />
      ))}
    </Tile>
  )
}

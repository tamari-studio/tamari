// ⌘K (Ctrl+K elsewhere): find any open tab in any space by its name or its space's name; Enter opens it.
import { IconLayoutGrid, IconSearch } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Space, Tab } from '../../lib/types'
import { viewIcon } from '../lib/icons'
import { useApplets } from '../lib/queries'
import { navigate, tabPath } from '../lib/router'
import { inSidebarOrder, spaceLabel } from '../lib/subspaces'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { cn } from '../ui/utils'
import { SpaceIcon } from './Sidebar'

type Item = { key: string; space: Space; spaceName: string; tab: Tab; title: string; icon: string | undefined }

// Every query word has to appear in the tab's title or its space's name.
export function matchesQuery(query: string, ...fields: string[]): boolean {
  const haystack = fields.join(' ').toLowerCase()
  return query.toLowerCase().split(/\s+/).every(word => haystack.includes(word))
}

// Lower ranks list first: the tab named exactly that, then tabs whose own name matches,
// then tabs that match only through their space's name. Null: no match.
export function rankMatch(query: string, title: string, spaceName: string): number | null {
  const q = query.trim().toLowerCase()
  if (!matchesQuery(q, title, spaceName)) return null
  if (title.toLowerCase() === q) return 0
  return matchesQuery(q, title) ? 1 : 2
}

export function TabSearch({ spaces, tabs }: { spaces: Space[]; tabs: Tab[] }) {
  const applets = useApplets()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Spaces in sidebar order, tabs in strip order; tabs of spaces this person can't see are left out.
  const items = useMemo(() => {
    const all: Item[] = []
    for (const space of inSidebarOrder(spaces)) {
      for (const tab of tabs.filter(t => t.spaceId === space.id).sort((a, b) => a.position - b.position)) {
        const applet = tab.ref === 'widgets' ? undefined : applets.get(`view:${tab.ref.slice(5)}`)
        const title = tab.ref === 'widgets' ? 'Widgets' : (applet?.title ?? tab.ref.slice(5))
        all.push({ key: tab.id, space, spaceName: spaceLabel(spaces, space), tab, title, icon: applet?.icon })
      }
    }
    return all
  }, [spaces, tabs, applets])

  // Sort is stable, so equal ranks keep sidebar and tab-strip order.
  const results = useMemo(
    () =>
      items
        .map(item => ({ item, rank: rankMatch(query, item.title, item.spaceName) }))
        .filter((r): r is { item: Item; rank: number } => r.rank !== null)
        .sort((a, b) => a.rank - b.rank)
        .map(r => r.item),
    [items, query]
  )
  const active = Math.min(selected, results.length - 1)

  useEffect(() => {
    listRef.current?.querySelector('[data-active=true]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setQuery('')
      setSelected(0)
    }
  }

  const choose = (item: Item | undefined) => {
    if (!item) return
    onOpenChange(false)
    navigate(tabPath(item.space.slug, item.tab.ref))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogTitle className="sr-only">Search tabs</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <IconSearch size={16} stroke={1.75} className="shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setSelected(0)
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                const step = event.key === 'ArrowDown' ? 1 : -1
                setSelected((active + step + results.length) % Math.max(results.length, 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(results[active])
              }
            }}
            placeholder="Search tabs…"
            aria-label="Search tabs"
            role="combobox"
            aria-expanded="true"
            aria-controls="tab-search-results"
            aria-activedescendant={results[active] ? `tab-search-${results[active].key}` : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} id="tab-search-results" role="listbox" aria-label="Tabs" className="max-h-80 overflow-y-auto p-1">
          {results.length === 0 && <p className="px-3 py-6 text-center text-muted-foreground">No tabs match.</p>}
          {results.map((item, index) => {
            const Icon = item.tab.ref === 'widgets' ? IconLayoutGrid : viewIcon(item.icon)
            return (
              <div
                key={item.key}
                id={`tab-search-${item.key}`}
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                onMouseMove={() => setSelected(index)}
                onClick={() => choose(item)}
                className={cn(
                  'flex h-9 cursor-pointer items-center gap-2 rounded-lg px-2',
                  index === active ? 'bg-accent text-foreground' : 'text-muted-foreground'
                )}
              >
                <Icon size={16} stroke={1.75} className="shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <SpaceIcon space={item.space} />
                  {item.spaceName}
                </span>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

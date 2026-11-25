// Data map: what data the workspace holds, which spaces use each piece and
// where it comes from. The connections come from the build's scan of the
// spaces' code (app/build/data-map.ts), minus spaces the viewer doesn't see
// (the server leaves those out). Read-only; a collection's records can be
// browsed here, as on the Shared data page this replaces.
import { IconDatabase, IconPlug, IconStack2, IconTable, IconBolt } from '@tabler/icons-react'
import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { gmailEnvKeys, isConnectorEnabledForSpace, secretKeysFor } from '../../lib/connectors'
import type { Connector, Space } from '../../lib/types'
import { navigate, tabPath } from '../lib/router'
import { useApplets, useCollections, useConnectors, useDataMap, useRecords, useWorkspace } from '../lib/queries'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { cn } from '../ui/utils'

const time = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

type Group = 'table' | 'collection' | 'connector' | 'function'

const GROUPS: { group: Group; title: string; hint: string; icon: ReactNode }[] = [
  { group: 'table', title: 'Shared tables', hint: 'Records the whole organisation shares: people, companies, events, invitations.', icon: <IconTable size={16} stroke={1.75} /> },
  { group: 'collection', title: 'Space working data', hint: 'What one feature keeps for its own work. Any space can read it.', icon: <IconStack2 size={16} stroke={1.75} /> },
  { group: 'connector', title: 'Connected tools', hint: 'Outside services a connector brings in.', icon: <IconPlug size={16} stroke={1.75} /> },
  { group: 'function', title: 'Database actions', hint: 'Steps the database runs for a space, such as adding a person or reading Airtable rows.', icon: <IconBolt size={16} stroke={1.75} /> }
]

type Source = {
  id: string
  group: Group
  label: string
  // The name in the database, when it differs from the label.
  name?: string
  count?: number
  // Space folder → the views and widgets whose own code names the source.
  uses: Map<string, string[]>
}

function readable(name: string): string {
  const words = name.replace(/[_-]+/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// The env names a connector hands to a space's code, whether or not they are set yet.
function connectorKeys(connector: Connector): string[] {
  if (connector.kind === 'supabase') return ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']
  if (connector.kind === 'gmail') return Object.values(gmailEnvKeys(connector))
  return secretKeysFor(connector.kind, connector.config)
}

export function DataPage({ collection }: { collection?: string }) {
  const dataMap = useDataMap()
  const collections = useCollections()
  const connectors = useConnectors()
  const workspace = useWorkspace()
  const applets = useApplets()
  // A space (its folder) narrows the list to what it uses; an open source shows who uses it.
  const [picked, setPicked] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(collection ? `collection:${collection}` : null)
  const [showRecords, setShowRecords] = useState(Boolean(collection))
  const [search, setSearch] = useState('')
  const [sharedOnly, setSharedOnly] = useState(false)

  const spaces = useMemo(() => (workspace.data?.spaces ?? []).filter((s): s is Space & { folder: string } => Boolean(s.folder)), [workspace.data])

  const sources = useMemo(() => {
    const byFolder = new Map(spaces.map(s => [s.folder, s]))
    const out = new Map<string, Source>()
    const use = (source: Source, folder: string, names: string[]) => {
      const known = out.get(source.id) ?? source
      out.set(source.id, known)
      known.uses.set(folder, [...new Set([...(known.uses.get(folder) ?? []), ...names])])
    }
    const env = (dataMap.data ?? []).filter(u => u.kind === 'env' && byFolder.has(u.folder))
    for (const u of dataMap.data ?? []) {
      if (u.kind === 'env' || !byFolder.has(u.folder)) continue
      use({ id: `${u.kind}:${u.name}`, group: u.kind, label: readable(u.name), name: u.name, uses: new Map() }, u.folder, u.applets)
    }
    // A collection with records but no space found for it still belongs on the map.
    for (const c of collections.data ?? []) {
      const id = `collection:${c.name}`
      const source = out.get(id) ?? { id, group: 'collection' as const, label: readable(c.name), name: c.name, uses: new Map() }
      out.set(id, { ...source, count: c.count })
    }
    for (const c of connectors.data ?? []) {
      const source: Source = { id: `connector:${c.id}`, group: 'connector', label: c.name, uses: new Map() }
      out.set(source.id, source)
      const keys = new Set(connectorKeys(c))
      for (const u of env) {
        if (keys.has(u.name) && isConnectorEnabledForSpace(c, byFolder.get(u.folder)!.id)) use(source, u.folder, u.applets)
      }
    }
    return [...out.values()].sort((a, b) => b.uses.size - a.uses.size || a.label.localeCompare(b.label))
  }, [dataMap.data, collections.data, connectors.data, spaces])

  const openSource = sources.find(s => s.id === open)
  const pickedSpace = spaces.find(s => s.folder === picked)
  const pickedSources = pickedSpace ? sources.filter(s => s.uses.has(pickedSpace.folder)) : []
  const needle = search.trim().toLowerCase()
  const shown = sources.filter(
    s =>
      (!pickedSpace || s.uses.has(pickedSpace.folder)) &&
      (!sharedOnly || s.uses.size > 1) &&
      (!needle || s.label.toLowerCase().includes(needle) || (s.name ?? '').toLowerCase().includes(needle))
  )
  const spaceNames = (source: Source) => spaces.filter(s => source.uses.has(s.folder)).map(s => s.name)
  // Sources the space has in common with the picked one.
  const sharedWithPicked = (folder: string) => pickedSources.filter(s => s.uses.has(folder)).length

  const toggleSource = (id: string) => {
    setOpen(o => (o === id ? null : id))
    setShowRecords(false)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 max-md:p-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Data map</h1>
        <p className="text-sm text-muted-foreground">
          What data the workspace holds, and which spaces use it. Pick a space to see what it uses and shares, or a piece of data to see who uses it.
        </p>
        <p className="text-xs text-muted-foreground">The map is worked out automatically from how each space is built, so it can miss a connection or two.</p>
      </header>

      {dataMap.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load the data map: {dataMap.error.message}
        </p>
      )}

      <div className="flex items-start gap-6 max-md:flex-col max-md:items-stretch">
        <nav aria-label="Spaces on the data map" className="flex w-56 shrink-0 flex-col gap-0.5 max-md:w-full md:sticky md:top-6">
          <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">Spaces</h2>
          {workspace.isPending && <Skeleton className="h-24 w-full" />}
          {spaces.map(space => {
            const count = sources.filter(s => s.uses.has(space.folder)).length
            const usesOpen = openSource?.uses.has(space.folder)
            const shared = pickedSpace && space !== pickedSpace ? sharedWithPicked(space.folder) : 0
            return (
              <button
                key={space.id}
                type="button"
                aria-pressed={space === pickedSpace}
                onClick={() => setPicked(p => (p === space.folder ? null : space.folder))}
                className={cn(
                  'flex h-8 items-center gap-2 rounded-lg px-2 text-left text-sm',
                  space === pickedSpace ? 'bg-background font-medium shadow-xs' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  usesOpen && 'text-foreground ring-1 ring-ring',
                  // Dim what the current choice doesn't touch.
                  ((openSource && !usesOpen) || (pickedSpace && space !== pickedSpace && !shared && !openSource)) && 'opacity-50'
                )}
              >
                <span className="flex-1 truncate">{space.name}</span>
                <span className="text-xs tabular-nums">{shared ? `${shared} shared` : count}</span>
              </button>
            )
          })}
        </nav>

        <section className="flex min-w-0 flex-1 flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              aria-label="Search the data"
              placeholder="Search"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="w-56 max-md:w-full"
            />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={sharedOnly} onCheckedChange={setSharedOnly} />
              Only what several spaces use
            </label>
          </div>

          {pickedSpace && (
            <p className="text-sm">
              <span className="font-medium">{pickedSpace.name}</span> uses {pickedSources.length}{' '}
              {pickedSources.length === 1 ? 'piece' : 'pieces'} of data, {pickedSources.filter(s => s.uses.size > 1).length} of them together with
              other spaces.{' '}
              <button type="button" className="underline underline-offset-4" onClick={() => navigate(`/${pickedSpace.slug}`)}>
                Open {pickedSpace.name}
              </button>
            </p>
          )}

          {dataMap.isPending && <Skeleton className="h-40 w-full" />}
          {dataMap.isSuccess && shown.length === 0 && (
            <p className="text-sm text-muted-foreground">{pickedSpace && !needle && !sharedOnly ? 'This space doesn’t use any of the data on the map yet.' : 'Nothing matches. Try another word, or clear the search.'}</p>
          )}

          {GROUPS.map(({ group, title, hint, icon }) => {
            const rows = shown.filter(s => s.group === group)
            if (rows.length === 0) return null
            return (
              <div key={group} className="flex flex-col gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-medium">
                    {icon}
                    {title}
                    <span className="text-xs font-normal text-muted-foreground tabular-nums">{rows.length}</span>
                  </h2>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <ul className="flex flex-col divide-y divide-border rounded-xl bg-background shadow-xs">
                  {rows.map(source => (
                    <li key={source.id}>
                      <button
                        type="button"
                        aria-expanded={source.id === open}
                        onClick={() => toggleSource(source.id)}
                        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-accent"
                      >
                        <span className="min-w-0 shrink-0 font-medium">{source.label}</span>
                        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                          {spaceNames(source).join(', ') || 'Not used by a space yet'}
                        </span>
                      </button>
                      {source.id === open && (
                        <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-sm">
                          {source.count !== undefined && (
                            <p className="text-xs text-muted-foreground">
                              {source.count} {source.count === 1 ? 'record' : 'records'}
                            </p>
                          )}
                          {source.uses.size === 0 ? (
                            <p className="text-muted-foreground">
                              {group === 'connector' ? 'No space uses this connector yet, as far as the map can tell.' : 'No space uses this yet, as far as the map can tell.'}
                            </p>
                          ) : (
                            <ul className="flex flex-col gap-1.5">
                              {spaces
                                .filter(s => source.uses.has(s.folder))
                                .map(space => (
                                  <li key={space.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                    <button type="button" className="font-medium underline underline-offset-4" onClick={() => navigate(`/${space.slug}`)}>
                                      {space.name}
                                    </button>
                                    {source.uses.get(space.folder)!.map(key => {
                                      const applet = applets.get(key)
                                      if (!applet) return null
                                      return (
                                        <button
                                          key={key}
                                          type="button"
                                          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                                          onClick={() => navigate(tabPath(space.slug, applet.kind === 'view' ? key : 'widgets'))}
                                        >
                                          {applet.title}
                                        </button>
                                      )
                                    })}
                                  </li>
                                ))}
                            </ul>
                          )}
                          {group === 'connector' && (
                            <Button variant="outline" size="sm" className="self-start" onClick={() => navigate('/connectors')}>
                              Open Connectors
                            </Button>
                          )}
                          {source.name && (
                            <details className="text-xs text-muted-foreground">
                              <summary className="w-fit cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">For developers</summary>
                              <p className="pt-1">
                                Stored as <code className="font-mono">{source.name}</code>
                              </p>
                            </details>
                          )}
                          {group === 'collection' && source.name && (
                            <>
                              <Button variant="outline" size="sm" className="self-start" aria-expanded={showRecords} onClick={() => setShowRecords(v => !v)}>
                                <IconDatabase size={16} stroke={1.75} />
                                {showRecords ? 'Hide records' : 'Show records'}
                              </Button>
                              {showRecords && <Records collection={source.name} spaces={workspace.data?.spaces ?? []} />}
                            </>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </section>
      </div>
    </div>
  )
}

// A record as a person reads it: one line per field. Only what is nested deeper stays as written.
function fields(data: unknown): [string, string][] {
  const show = (value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—'
    if (typeof value !== 'object') return String(value)
    if (Array.isArray(value) && value.every(item => item === null || typeof item !== 'object')) return value.join(', ') || '—'
    return JSON.stringify(value, null, 2)
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return [['Value', show(data)]]
  return Object.entries(data).map(([name, value]) => [name, show(value)])
}

function Records({ collection, spaces }: { collection: string; spaces: Space[] }) {
  const records = useRecords(collection)
  const [open, setOpen] = useState<string | null>(null)
  const spaceName = (id: string | null) => (id ? (spaces.find(s => s.id === id)?.name ?? id) : 'Every space')

  if (records.isPending) return <Skeleton className="h-24 w-full" />
  if (records.isError) return <p role="alert" className="text-sm text-destructive">Couldn't load the records: {records.error.message}</p>
  if (records.data.length === 0) return <p className="text-sm text-muted-foreground">There are no records here that you can see.</p>
  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {records.data.map(record => (
        <li key={record.key}>
          <button
            type="button"
            aria-expanded={open === record.key}
            onClick={() => setOpen(o => (o === record.key ? null : record.key))}
            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{record.key}</span>
            <span className="text-xs text-muted-foreground">{spaceName(record.spaceId)}</span>
            <span className="w-40 text-right text-xs text-muted-foreground tabular-nums max-md:hidden">{time.format(new Date(record.updatedAt))}</span>
          </button>
          {open === record.key && (
            <dl className="grid max-h-96 grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 overflow-auto bg-muted px-3 py-3 text-xs">
              {fields(record.data).map(([name, value]) => (
                <Fragment key={name}>
                  <dt className="text-muted-foreground">{readable(name)}</dt>
                  <dd className="break-words whitespace-pre-wrap">{value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ul>
  )
}

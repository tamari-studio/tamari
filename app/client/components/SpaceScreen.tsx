// One space: its tab strip and the open tab. Any view from any space can be
// opened here; a tab moves to another space from its menu or by dragging it
// onto that space in the sidebar.
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsExchange,
  IconDots,
  IconLayoutGrid,
  IconPlus,
  IconX
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { CatalogApplet, Space, Tab, Workspace } from '../../lib/types'
import { DRAG_TYPE, markTabRemoved, readDragItem, wasTabRemoved } from '../lib/drag'
import { viewIcon } from '../lib/icons'
import { folderName as nameOfFolder } from '../lib/labels'
import { useApplets, useCatalog, useCloseTab, useMoveTab, useOpenTab, useReorderTabs } from '../lib/queries'
import { keepQuery, navigate, tabPath } from '../lib/router'
import { visit } from '../lib/visited'
import { homeFolder, inSidebarOrder, spaceLabel } from '../lib/subspaces'
import { toast } from '../lib/toast'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { cn } from '../ui/utils'
import { Applet } from './Applet'
import { useConfirm } from './ConfirmDialog'
import { MobileNav } from './Sidebar'
import { WidgetsGrid } from './WidgetsGrid'
import { trackView } from '../lib/usage'

type Props = {
  space: Space
  workspace: Workspace
  tabRef: string | undefined
}

// Views (the widgets tab counts as one) kept mounted per space, the open one included.
const KEEP_MOUNTED = 3

function tabTitle(tab: Tab, applets: Map<string, CatalogApplet>): string {
  if (tab.ref === 'widgets') return 'Widgets'
  return applets.get(`view:${tab.ref.slice(5)}`)?.title ?? tab.ref.slice(5)
}

function sourceFolder(tab: Tab): string | null {
  return tab.ref === 'widgets' ? null : tab.ref.slice(5).split('/')[0]
}

// The last tab each person had open per space. Per browser, not shared: a
// shared "active tab" would make every open window refetch on every click.
function lastTab(spaceId: string): string | null {
  try {
    return localStorage.getItem(`miso:last-tab:${spaceId}`)
  } catch {
    return null
  }
}

function rememberTab(spaceId: string, ref: string): void {
  try {
    localStorage.setItem(`miso:last-tab:${spaceId}`, ref)
  } catch {
    // Private mode or storage blocked: fall back to the space's default tab.
  }
}

export function SpaceScreen({ space, workspace, tabRef }: Props) {
  const applets = useApplets()
  const catalog = useCatalog()
  const closeTab = useCloseTab()
  const [confirm, confirmDialog] = useConfirm()
  const moveTab = useMoveTab()
  const openTab = useOpenTab()
  const reorder = useReorderTabs()
  const [dragOver, setDragOver] = useState<string | null>(null)

  const tabs = useMemo(
    () => workspace.tabs.filter(t => t.spaceId === space.id).sort((a, b) => a.position - b.position),
    [workspace.tabs, space.id]
  )
  const layout = workspace.layouts.find(l => l.spaceId === space.id)
  const otherSpaces = inSidebarOrder(workspace.spaces).filter(s => s.id !== space.id)
  // A subspace has no code of its own: its parent's views count as its own.
  const ownFolder = homeFolder(workspace.spaces, space)
  const folderName = (folder: string) => nameOfFolder(folder, workspace, catalog.data)

  // No tab in the URL: go to your last tab here, else the space's default
  // (imported from .workspace.json), else its first.
  const remembered = lastTab(space.id)
  const fallback =
    (remembered && tabs.some(t => t.ref === remembered) ? remembered : null) ??
    (layout?.activeTab && tabs.some(t => t.ref === layout.activeTab) ? layout.activeTab : tabs[0]?.ref)
  useEffect(() => {
    if (!tabRef && fallback) navigate(keepQuery(tabPath(space.slug, fallback), location.search), { replace: true })
  }, [tabRef, fallback, space.slug])

  const activeRef = tabRef ?? fallback
  const activeTab = tabs.find(t => t.ref === activeRef)

  useEffect(() => {
    if (activeTab) rememberTab(space.id, activeTab.ref)
  }, [activeTab, space.id])

  const viewedRef = activeTab?.ref
  useEffect(() => {
    if (viewedRef) trackView(space.id, viewedRef)
  }, [viewedRef, space.id])

  // A view opened by URL that isn't a tab yet (a shared link) becomes one —
  // once. A tab that existed and then disappeared was closed or moved (maybe
  // by a teammate, arriving through realtime): go elsewhere, don't recreate it.
  const seen = useRef(new Set<string>())
  const tried = useRef(new Set<string>())
  for (const tab of tabs) seen.current.add(tab.ref)
  useEffect(() => {
    if (!tabRef || activeTab || applets.size === 0) return
    const known = tabRef === 'widgets' || applets.has(`view:${tabRef.slice(5)}`)
    if (!known || seen.current.has(tabRef) || tried.current.has(tabRef) || wasTabRemoved(space.id, tabRef)) {
      navigate(`/${space.slug}`, { replace: true })
      return
    }
    tried.current.add(tabRef)
    openTab.mutate(
      { spaceId: space.id, ref: tabRef as Tab['ref'] },
      { onError: () => navigate(`/${space.slug}`, { replace: true }) }
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabRef, activeTab, applets.size, space.id])

  // Keep the last few visited views mounted within the space so switching tabs keeps state.
  // Few, because a hidden view keeps running: its polling and timers don't stop.
  const [visited, setVisited] = useState<string[]>([])
  useEffect(() => {
    if (activeRef) setVisited(v => visit(v, activeRef, KEEP_MOUNTED))
  }, [activeRef])

  const close = (tab: Tab) => {
    markTabRemoved(space.id, tab.ref)
    closeTab.mutate({ tabId: tab.id })
    if (tab.ref === activeRef) {
      const rest = tabs.filter(t => t.id !== tab.id)
      const next = rest[Math.max(0, tabs.indexOf(tab) - 1)]
      navigate(next ? tabPath(space.slug, next.ref) : `/${space.slug}`, { replace: true })
    }
  }

  const moveTo = (tab: Tab, target: Space) => {
    markTabRemoved(space.id, tab.ref)
    moveTab.mutate({ tabId: tab.id, spaceId: target.id })
    toast(`Moved ${tabTitle(tab, applets)} to ${spaceLabel(workspace.spaces, target)}`, 'success')
    if (tab.ref === activeRef) {
      const rest = tabs.filter(t => t.id !== tab.id)
      navigate(rest[0] ? tabPath(space.slug, rest[0].ref) : `/${space.slug}`, { replace: true })
    }
  }

  const onTabDrop = (target: Tab) => (event: DragEvent) => {
    event.preventDefault()
    setDragOver(null)
    const item = readDragItem(event)
    if (!item || item.type !== 'tab' || item.tabId === target.id) return
    if (item.fromSpaceId !== space.id) {
      moveTab.mutate({ tabId: item.tabId, spaceId: space.id })
      return
    }
    const ids = tabs.map(t => t.id).filter(id => id !== item.tabId)
    // The target's index before the dragged tab left, so a drop on the last tab can land after it.
    ids.splice(tabs.findIndex(t => t.id === target.id), 0, item.tabId)
    reorder.mutate({ spaceId: space.id, ids })
  }

  // The keyboard way to reorder: one step along the strip, same call as a drop.
  const shift = (tab: Tab, by: -1 | 1) => {
    const ids = tabs.map(t => t.id)
    const at = ids.indexOf(tab.id)
    ;[ids[at], ids[at + by]] = [ids[at + by], ids[at]]
    reorder.mutate({ spaceId: space.id, ids })
  }

  const openViews = new Set(tabs.map(t => t.ref))
  const viewsByFolder = new Map<string, CatalogApplet[]>()
  for (const applet of catalog.data?.applets ?? []) {
    if (applet.kind !== 'view') continue
    viewsByFolder.set(applet.folder, [...(viewsByFolder.get(applet.folder) ?? []), applet])
  }
  const ownFirst = [...viewsByFolder.keys()].sort((a, b) => (a === ownFolder ? -1 : b === ownFolder ? 1 : folderName(a).localeCompare(folderName(b))))

  const openView = (ref: Tab['ref']) => {
    if (!openViews.has(ref)) openTab.mutate({ spaceId: space.id, ref })
    navigate(tabPath(space.slug, ref))
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 px-3">
        <MobileNav label={spaceLabel(workspace.spaces, space)} spaces={workspace.spaces} />
        {/* Tabs sit on the header's bottom edge so the active one joins the sheet below. */}
        <div
          role="tablist"
          aria-label={`${space.name} tabs`}
          data-tour="tabs"
          className="flex min-w-0 flex-1 items-end gap-0.5 self-stretch overflow-x-auto px-2 [scrollbar-width:none]"
        >
          {tabs.map(tab => {
            const active = tab.ref === activeRef
            const from = sourceFolder(tab)
            const Icon = tab.ref === 'widgets' ? IconLayoutGrid : viewIcon(applets.get(`view:${tab.ref.slice(5)}`)?.icon)
            return (
              <div
                key={tab.id}
                role="tab"
                aria-selected={active}
                draggable
                onDragStart={event => {
                  event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: 'tab', tabId: tab.id, ref: tab.ref, fromSpaceId: space.id }))
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={event => {
                  if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
                  event.preventDefault()
                  setDragOver(tab.id)
                }}
                onDragLeave={() => setDragOver(d => (d === tab.id ? null : d))}
                onDrop={onTabDrop(tab)}
                className={cn(
                  'group relative flex h-9 shrink-0 items-center rounded-t-lg text-sm transition-colors',
                  active ? 'miso-folder-tab z-10 bg-background text-foreground' : 'text-muted-foreground hover:bg-background/50 hover:text-foreground',
                  dragOver === tab.id && 'ring-2 ring-ring'
                )}
              >
                {active && <span aria-hidden className="miso-folder-tab-edge" />}
                <button
                  type="button"
                  className="flex h-full items-center gap-1.5 pr-1 pl-2.5"
                  onClick={() => navigate(tabPath(space.slug, tab.ref))}
                >
                  <Icon size={16} stroke={1.75} />
                  <span className="max-w-48 truncate">{tabTitle(tab, applets)}</span>
                  {from && from !== ownFolder && (
                    <span className="rounded bg-accent px-1 text-xs text-muted-foreground">{folderName(from)}</span>
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label={`${tabTitle(tab, applets)} tab options`}
                        title="Move or close this tab"
                        className={cn('mr-1 rounded-md p-0.5 hover:bg-accent', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
                      />
                    }
                  >
                    <IconDots size={12} stroke={1.75} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-52">
                    {tabs.length > 1 && (
                      <>
                        <DropdownMenuItem disabled={tab.id === tabs[0].id} onClick={() => shift(tab, -1)}>
                          <IconArrowLeft stroke={1.75} />
                          Move left
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={tab.id === tabs[tabs.length - 1].id} onClick={() => shift(tab, 1)}>
                          <IconArrowRight stroke={1.75} />
                          Move right
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <IconArrowsExchange stroke={1.75} />
                        Move to space
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-48">
                        {otherSpaces.map(target => (
                          <DropdownMenuItem key={target.id} onClick={() => moveTo(tab, target)}>
                            {spaceLabel(workspace.spaces, target)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() =>
                        // Tabs are the whole team's, so closing one closes it for everyone.
                        confirm({
                          title: `Close ${tabTitle(tab, applets)} for everyone?`,
                          description: `Tabs are shared: everyone on ${space.name} loses this tab. Anyone can open the view again with +.`,
                          action: 'Close tab',
                          destructive: true,
                          run: () => close(tab)
                        })
                      }
                    >
                      <IconX stroke={1.75} />
                      Close tab
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open a view" title="Open a view" data-tour="add-tab" className="mb-1 shrink-0 self-end" />}>
              <IconPlus stroke={1.75} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-96 w-64">
              {!openViews.has('widgets') && (
                <>
                  <DropdownMenuItem onClick={() => openView('widgets')}>
                    <IconLayoutGrid stroke={1.75} />
                    Widgets
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              {ownFirst.map(folder => (
                <DropdownMenuGroup key={folder}>
                  <DropdownMenuLabel>{folder === ownFolder ? `${folderName(folder)} (this space)` : folderName(folder)}</DropdownMenuLabel>
                  {viewsByFolder.get(folder)!.map(view => {
                    const ref = `view:${view.ref}` as const
                    const Icon = viewIcon(view.icon)
                    return (
                      <DropdownMenuItem key={view.ref} onClick={() => openView(ref)}>
                        <Icon stroke={1.75} />
                        <span className="flex-1 truncate">{view.title}</span>
                        {openViews.has(ref) && <span className="text-xs text-muted-foreground">Open</span>}
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuGroup>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* ml-px: the scroll container around this screen clips the 1px ring of shadow-xs on the left. */}
      <main className="relative min-h-0 flex-1 overflow-hidden rounded-tl-xl bg-background shadow-xs max-md:rounded-none md:ml-px">
        {tabs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <p>This space has no tabs open.</p>
            <p>Open widgets or a view from any space with the + button.</p>
          </div>
        )}
        {visited
          .map(ref => tabs.find(t => t.ref === ref))
          .filter((tab): tab is Tab => Boolean(tab))
          .map(tab => (
            // Keyed by ref: a just-opened tab's pending id changes to the real one, which would remount the view.
            <div key={tab.ref} className={cn('absolute inset-0 overflow-auto', tab.ref !== activeRef && 'hidden')}>
              {tab.ref === 'widgets' ? (
                <WidgetsGrid space={space} workspace={workspace} />
              ) : (
                <Applet kind="view" refId={tab.ref.slice(5)} name={tabTitle(tab, applets)} spaceId={space.id} params={tab.params} />
              )}
            </div>
          ))}
      </main>

      {confirmDialog}
    </div>
  )
}

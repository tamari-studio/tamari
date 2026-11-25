import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Space } from '../lib/types'
import { DraftGate } from './components/DraftGate'
import { Onboarding } from './components/Onboarding'
import { SpaceScreen } from './components/SpaceScreen'
import { ConnectAgentBanner } from './components/ConnectAgentBanner'
import { PreviewBanner } from './components/PreviewBanner'
import { MobileNav, Sidebar } from './components/Sidebar'
import { TabSearch } from './components/TabSearch'
import { useActivityHeartbeat } from './lib/activity'
import { trackView, useUsageTracking } from './lib/usage'
import { resolveOpen } from './lib/open-ref'
import { catalogBehind } from './lib/catalog-sync'
import { isOthersDraft, listedSpaces } from './lib/drafts'
import { HttpError } from './lib/http'
import { catalogQuery, keys, useApplets, useLiveUpdates, useMe, useOpenTab, useOrgSettings, useWorkspace } from './lib/queries'
import { keepQuery, navigate, tabPath, useRoute, type Route } from './lib/router'
import { inSidebarOrder, spaceLabel } from './lib/subspaces'
import { applyTheme } from './lib/theme'
import { toast } from './lib/toast'
import { ConnectorsPage } from './pages/ConnectorsPage'
import { DataPage } from './pages/DataPage'
import { PeoplePage } from './pages/PeoplePage'
import { SettingsPage } from './pages/SettingsPage'
import { ProposalsPage } from './pages/ProposalsPage'
import { UsagePage } from './pages/UsagePage'
import { setBridge, setCurrentSpace } from './runtime/session'
import { Button } from './ui/button'
import { Skeleton } from './ui/skeleton'
import { WORDMARK } from '../lib/brand'

// What the browser tab and the phone menu call the screen.
const PAGE_TITLE: Record<Exclude<Route['page'], 'home' | 'space'>, string> = {
  connectors: 'Connectors',
  'shared-data': 'Data map',
  members: 'People & access',
  'space-access': 'People & access',
  usage: 'Usage',
  proposals: 'Proposals',
  settings: 'Settings'
}

function findSpace(spaces: Space[], slug: string): Space | undefined {
  return spaces.find(s => s.slug === slug) ?? spaces.find(s => s.previousSlugs.includes(slug))
}

export function App() {
  const workspace = useWorkspace()
  const route = useRoute()
  const applets = useApplets()
  const openTab = useOpenTab()
  // Every view the server sent (GET /api/catalog), before the client's own filter.
  const catalog = useQuery(catalogQuery).data
  const allViews = useMemo(() => new Map((catalog?.applets ?? []).filter(a => a.kind === 'view').map(a => [`view:${a.ref}`, a])), [catalog])
  const queryClient = useQueryClient()
  // Access changed (the workspace shows other spaces than the catalog): read the catalog again,
  // once per workspace update, so a disagreement the server keeps can't loop.
  const checkedAt = useRef(0)
  useEffect(() => {
    if (!workspace.data || !catalog || checkedAt.current === workspace.dataUpdatedAt) return
    checkedAt.current = workspace.dataUpdatedAt
    if (catalogBehind(workspace.data, catalog)) void queryClient.invalidateQueries({ queryKey: keys.catalog })
  }, [workspace.data, workspace.dataUpdatedAt, catalog, queryClient])
  useLiveUpdates()
  useActivityHeartbeat()
  useUsageTracking()

  const spaces = workspace.data?.spaces ?? []
  const space = route.page === 'space' ? findSpace(spaces, route.slug) : undefined
  // Other people's drafts are reachable by their address, never listed (lib/drafts.ts).
  const meId = useMe().data?.id
  const listed = useMemo(() => listedSpaces(spaces, catalog, meId), [spaces, catalog, meId])
  const [openedDrafts, setOpenedDrafts] = useState<ReadonlySet<string>>(new Set())
  const gated = space !== undefined && isOthersDraft(space, catalog, meId) && !openedDrafts.has(space.id)

  useEffect(() => {
    setCurrentSpace(space?.id ?? null)
  }, [space?.id])

  // One look for the whole app, on every page (Settings → Organisation).
  const theme = useOrgSettings().data?.theme
  useEffect(() => applyTheme(theme), [theme])

  // A refetch that fails (focus, a teammate's change, after a save) keeps the loaded app and its
  // open views; the person is told once per failure, and the next refetch tries again. A refused
  // session (401, 403: expired or suspended) is not "out of date": asking /api/me again lets main.tsx's
  // Gate sign them out or show the waiting screen.
  const refreshFailed = workspace.isRefetchError ? workspace.errorUpdatedAt : 0
  const refused = workspace.error instanceof HttpError && (workspace.error.status === 401 || workspace.error.status === 403)
  useEffect(() => {
    if (!refreshFailed) return
    if (refused) void queryClient.invalidateQueries({ queryKey: keys.me })
    else toast("Couldn't refresh the workspace, so it may be out of date. It tries again when you come back to this tab.", 'error')
  }, [refreshFailed, refused, queryClient])

  const title = route.page === 'space' ? space && spaceLabel(spaces, space) : route.page === 'home' ? undefined : PAGE_TITLE[route.page]
  useEffect(() => {
    document.title = title ? `${title} · ${WORDMARK}` : WORDMARK
  }, [title])

  // Workspace pages count as views with no space; a space's tabs are counted in SpaceScreen.
  useEffect(() => {
    if (route.page !== 'home' && route.page !== 'space') trackView(null, `page:${route.page}`)
  }, [route.page])

  // Old slugs and / land on a real space; an old tab path (`/my-day/my-day/calendar`) becomes the current one.
  useEffect(() => {
    if (!workspace.data) return
    const first = inSidebarOrder(spaces)[0]
    if (route.page === 'home' && first) navigate(keepQuery(`/${first.slug}`, location.search), { replace: true })
    if (route.page === 'space' && space && (space.slug !== route.slug || (route.tab && tabPath(space.slug, route.tab) !== location.pathname))) {
      navigate(keepQuery(route.tab ? tabPath(space.slug, route.tab) : `/${space.slug}`, location.search), { replace: true })
    }
  }, [workspace.data, route, space, spaces])

  // focusTab / canOpen / sendChatMessage from inside views and widgets (lib/open-ref.ts).
  useEffect(() => {
    const context = { current: space, spaces: workspace.data?.spaces ?? [], visible: applets, all: allViews }
    setBridge({
      focusTab(fromFolder, tab, params) {
        const target = resolveOpen(fromFolder, tab, context)
        if (target.kind === 'refuse') toast(target.message, target.tone)
        if (target.kind !== 'open') return
        openTab.mutate({ spaceId: target.space.id, ref: target.ref, params })
        navigate(tabPath(target.space.slug, target.ref))
      },
      canOpen: (fromFolder, tab) => resolveOpen(fromFolder, tab, context).kind === 'open',
      sendChatMessage(_fromFolder, message) {
        void navigator.clipboard?.writeText(message).catch(() => {})
        toast("Chat isn't part of this app yet. The message is on your clipboard.")
      }
    })
    return () => setBridge(null)
  }, [space, workspace.data?.spaces, applets, allViews, openTab])

  if (workspace.isPending) {
    return (
      <div className="flex h-dvh gap-4 p-4">
        <Skeleton className="h-full w-52 max-md:hidden" />
        <Skeleton className="h-full flex-1" />
      </div>
    )
  }
  // Only the first load replaces the app. A failed refetch keeps what is loaded (the effect above says so).
  if (workspace.isError && !workspace.data) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 p-4 text-sm">
        <p className="font-medium">Couldn't load the workspace.</p>
        <p className="text-muted-foreground">{workspace.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => void workspace.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-muted">
      <PreviewBanner />
      <ConnectAgentBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar spaces={listed} />
        <TabSearch spaces={listed} tabs={workspace.data.tabs} />
        <Onboarding />
        <div className="min-w-0 flex-1 overflow-auto">
          {/* A space has the menu in its tab strip; every other screen gets it here, or a phone has no way out. */}
          {!space && (
            <div className="flex h-12 items-center px-3 md:hidden">
              <MobileNav label={title ?? 'Menu'} spaces={listed} />
            </div>
          )}
          {route.page === 'connectors' && <ConnectorsPage />}
          {route.page === 'members' && <PeoplePage tab={route.tab ?? 'members'} />}
          {route.page === 'space-access' && <PeoplePage tab="spaces" />}
          {route.page === 'usage' && <UsagePage />}
          {route.page === 'proposals' && <ProposalsPage />}
          {route.page === 'settings' && <SettingsPage tab={route.tab ?? 'personal'} />}
          {route.page === 'shared-data' && <DataPage collection={route.collection} />}
          {route.page === 'space' && space && gated && (
            <DraftGate name={space.name} onOpen={() => setOpenedDrafts(opened => new Set([...opened, space.id]))} />
          )}
          {/* Only once the catalog says whether this is someone's draft. */}
          {route.page === 'space' && space && !gated && catalog && (
            <SpaceScreen key={space.id} space={space} workspace={workspace.data} tabRef={route.tab} />
          )}
          {route.page === 'home' && listed.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm">
              <p className="font-medium">No space is open to you yet.</p>
              <p className="text-muted-foreground">Ask an admin to add you to a team or open a space to you. It shows up here once they do.</p>
            </div>
          )}
          {route.page === 'space' && !space && (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-sm">
              <p className="font-medium">There's no space called {route.slug}.</p>
              <p className="text-muted-foreground">It may have been renamed, or it isn't open to you. Pick a space from the menu.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

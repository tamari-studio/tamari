// The space list. Dropping a dragged tab or widget on a space moves it there.
import {
  IconChartBar,
  IconChevronDown,
  IconChevronRight,
  IconCompass,
  IconDatabase,
  IconGitPullRequest,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLogout,
  IconMessageReport,
  IconPlug,
  IconPlus,
  IconPoint,
  IconSettings,
  IconUsers,
} from '@tabler/icons-react'
import { useEffect, useState, type DragEvent } from 'react'
import type { Space } from '../../lib/types'
import { spaceIcon } from '../lib/icons'
import { DRAG_TYPE, markTabRemoved, readDragItem } from '../lib/drag'
import { startTour } from '../lib/onboarding'
import { navigate, useRoute } from '../lib/router'
import { hasAtLeast } from '../../vendor/dto-core/tier'
import { useMe, useMoveTab, useMoveWidget, useOrgSettings, useProposals, useWaitingCount } from '../lib/queries'
import { toast } from '../lib/toast'
import { getSupabase } from '../runtime/session'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../ui/utils'
import { FeedbackDialog } from './FeedbackDialog'
import { NewSubspaceDialog } from './NewSubspaceDialog'
import { SamplesDialog, useBrowseTemplates } from './SamplePicker'
import { childrenOf, inSidebarOrder, topLevel } from '../lib/subspaces'
import { Logo } from './Logo'

export function SpaceIcon({ space }: { space: Space }) {
  const Icon = spaceIcon(space)
  return <Icon size={16} stroke={1.75} className="mx-0.5 shrink-0" />
}

// Fades labels out while the sidebar narrows, and back in once it has widened.
const fade = (collapsed: boolean) =>
  cn('transition-opacity duration-150 motion-reduce:transition-none', collapsed ? 'opacity-0' : 'opacity-100 delay-150')

// A right-hand tooltip on the element itself, shown only while `show` (the rail is collapsed).
function Hint({ label, show, children }: { label?: string | null; show: boolean; children: React.ReactElement }) {
  return (
    <Tooltip disabled={!show || !label}>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

// Icons keep the same left position in both states, so collapsing only clips the labels.
function NavRow({
  active,
  onClick,
  icon,
  label,
  collapsed,
  tour,
  className,
  badge = 0,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  collapsed: boolean
  // The tour's anchor for this row (lib/onboarding.ts).
  tour?: string
  className?: string
  // A count that needs someone's attention, such as people waiting to be let in.
  badge?: number
}) {
  return (
    <Hint label={label} show={collapsed}>
      <button
        type="button"
        onClick={onClick}
        data-tour={tour}
        className={cn(
          'relative flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm transition-colors [&>svg]:shrink-0',
          active ? 'bg-background font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          className
        )}
      >
        {icon}
        <span className={cn('truncate', fade(collapsed))}>{label}</span>
        {badge > 0 && (
          <span
            className={cn(
              'ml-auto rounded-full bg-primary px-1.5 text-xs leading-5 font-medium text-primary-foreground tabular-nums',
              collapsed && 'absolute top-0.5 left-5 size-2 p-0 text-[0px]'
            )}
          >
            {badge}
            <span className="sr-only"> waiting</span>
          </span>
        )}
      </button>
    </Hint>
  )
}

const COLLAPSED_KEY = 'miso:sidebar-collapsed'
// The spaces whose subspaces are unfolded, per browser.
const UNFOLDED_KEY = 'miso:sidebar-unfolded'

function initiallyUnfolded(): Set<string> {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(UNFOLDED_KEY) ?? '[]')
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

function initiallyCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function Sidebar({ spaces }: { spaces: Space[] }) {
  const route = useRoute()
  const me = useMe()
  const orgName = useOrgSettings().data?.name
  // People & access is for active admins and owners, the rule /api/members enforces.
  const canManageMembers = hasAtLeast(me.data?.tier ?? null, me.data?.status ?? null, 'admin')
  const waiting = useWaitingCount(canManageMembers)
  const proposals = useProposalsNav(canManageMembers)
  // Owners make subspaces and get every one from the API; anyone else gets only their own draft copies (proposals).
  const isOwner = hasAtLeast(me.data?.tier ?? null, me.data?.status ?? null, 'owner')
  const moveTab = useMoveTab()
  const moveWidget = useMoveWidget()
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const [unfolded, setUnfolded] = useState(initiallyUnfolded)
  const [newSubspaceOf, setNewSubspaceOf] = useState<Space | null>(null)
  const templates = useBrowseTemplates(canManageMembers)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const activeSlug = route.page === 'space' ? route.slug : null
  const activeParent = spaces.find(s => s.slug === activeSlug)?.parentId ?? null

  const setFolded = (spaceId: string, open: boolean) => {
    setUnfolded(current => {
      const next = new Set(current)
      if (open) next.add(spaceId)
      else next.delete(spaceId)
      try {
        localStorage.setItem(UNFOLDED_KEY, JSON.stringify([...next]))
      } catch {
        // Storage blocked: the choice lasts until reload.
      }
      return next
    })
  }

  // Arriving on a subspace (a link, ⌘K) unfolds its parent, so the open row is in view.
  useEffect(() => {
    if (activeParent && !unfolded.has(activeParent)) setFolded(activeParent, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeParent])

  const toggleCollapsed = () => {
    setCollapsed(c => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
      } catch {
        // Storage blocked: the choice lasts until reload.
      }
      return !c
    })
  }

  // ⌘S (Ctrl+S elsewhere) toggles the rail instead of the browser's Save page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!event.repeat) toggleCollapsed()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const dropZone = (space: Space) => ({
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      setDropTarget(space.id)
    },
    onDragLeave: () => setDropTarget(t => (t === space.id ? null : t)),
    onDrop: onDrop(space)
  })

  const onDrop = (space: Space) => (event: DragEvent) => {
    event.preventDefault()
    setDropTarget(null)
    const item = readDragItem(event)
    if (!item || item.fromSpaceId === space.id) return
    if (item.type === 'tab') {
      markTabRemoved(item.fromSpaceId, item.ref)
      moveTab.mutate({ tabId: item.tabId, spaceId: space.id })
    }
    else moveWidget.mutate({ fromSpaceId: item.fromSpaceId, toSpaceId: space.id, ref: item.ref })
    toast(`Moved to ${space.name}`, 'success')
  }

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col gap-4 overflow-hidden px-3 py-4 transition-[width] duration-300 ease-in-out motion-reduce:transition-none max-md:hidden',
        // w-15 leaves exactly the 36px a row's icon is centred in.
        collapsed ? 'w-15' : 'w-56'
      )}
    >
      {/* The toggle is pinned top right, so collapsing slides it left until it sits over the icons. */}
      <div className="relative flex h-7 items-center">
        {/* pr-10 keeps a long workspace name clear of the toggle (w-9) pinned over its right end. */}
        <Logo name={orgName ?? undefined} className={cn('pr-10 pl-2 text-base font-medium tracking-tight', fade(collapsed))} />
        <Hint label="Expand sidebar (⌘S)" show={collapsed}>
          <button
            type="button"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            title={collapsed ? undefined : 'Collapse sidebar (⌘S)'}
            onClick={toggleCollapsed}
            className="absolute right-0 flex h-7 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {collapsed ? <IconLayoutSidebarLeftExpand size={18} stroke={1.75} /> : <IconLayoutSidebarLeftCollapse size={18} stroke={1.75} />}
          </button>
        </Hint>
      </div>

      {/* Scrolling clips both axes, so pad by the active row's shadow ring (and pull back with -m-1) to keep it whole. */}
      <nav aria-label="Spaces" data-tour="spaces" className="-m-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1">
        {topLevel(spaces).map(space => {
          const subspaces = childrenOf(spaces, space.id)
          // Owners make subspaces; anyone else folds only the ones they get, such as their own
          // draft copy of the space (a proposal).
          const foldable = isOwner || subspaces.length > 0
          const open = foldable && !collapsed && unfolded.has(space.id)
          return (
            <div key={space.id} className="flex flex-col gap-0.5">
              <div
                {...dropZone(space)}
                className={cn('group/space relative rounded-lg', dropTarget === space.id && 'ring-2 ring-ring')}
              >
                <NavRow
                  // Folded or on the rail, the parent stands in for the subspace that is open.
                  active={activeSlug === space.slug || (activeParent === space.id && !open)}
                  onClick={() => navigate(`/${space.slug}`)}
                  icon={<SpaceIcon space={space} />}
                  label={space.name}
                  collapsed={collapsed}
                  className={foldable && !collapsed ? 'pr-8' : undefined}
                />
                {foldable && !collapsed && (
                  <button
                    type="button"
                    aria-label={`${open ? 'Fold' : 'Unfold'} the subspaces of ${space.name}`}
                    aria-expanded={open}
                    title={open ? 'Fold subspaces' : subspaces.length ? `Subspaces (${subspaces.length})` : 'Subspaces'}
                    onClick={() => setFolded(space.id, !open)}
                    className={cn(
                      'absolute top-1 right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground',
                      // An empty fold only shows on hover, so spaces without subspaces stay quiet.
                      !open && subspaces.length === 0 && 'opacity-0 group-hover/space:opacity-100 focus-visible:opacity-100'
                    )}
                  >
                    <IconChevronRight size={14} stroke={1.75} className={cn('transition-transform motion-reduce:transition-none', open && 'rotate-90')} />
                  </button>
                )}
              </div>
              {open && (
                <div role="group" aria-label={`${space.name} subspaces`} className="ml-4 flex flex-col gap-0.5 border-l pl-1.5">
                  {subspaces.map(sub => (
                    <div key={sub.id} {...dropZone(sub)} className={cn('rounded-lg', dropTarget === sub.id && 'ring-2 ring-ring')}>
                      <NavRow
                        active={activeSlug === sub.slug}
                        onClick={() => navigate(`/${sub.slug}`)}
                        icon={sub.symbol ? <SpaceIcon space={sub} /> : <IconPoint size={16} stroke={1.75} className="mx-0.5" />}
                        label={sub.name}
                        collapsed={collapsed}
                      />
                    </div>
                  ))}
                  {isOwner && (
                    <NavRow
                      active={false}
                      onClick={() => setNewSubspaceOf(space)}
                      icon={<IconPlus size={16} stroke={1.75} className="mx-0.5" />}
                      label="New subspace"
                      collapsed={collapsed}
                      className="text-xs"
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="flex flex-col gap-0.5">
        {/* The workspace's own pages first, then help; the tour (lib/onboarding.ts) walks them in this order. */}
        <nav aria-label="Workspace" className="flex flex-col gap-0.5">
          {templates && (
            <NavRow active={templatesOpen} onClick={() => setTemplatesOpen(true)} icon={<IconLayoutGrid size={16} stroke={1.75} className="mx-0.5" />} label="Browse templates" collapsed={collapsed} />
          )}
          <NavRow active={route.page === 'connectors'} onClick={() => navigate('/connectors')} icon={<IconPlug size={16} stroke={1.75} className="mx-0.5" />} label="Connectors" collapsed={collapsed} tour="connectors" />
          {canManageMembers && (
            <>
              <NavRow active={route.page === 'members' || route.page === 'space-access'} onClick={() => navigate('/members')} icon={<IconUsers size={16} stroke={1.75} className="mx-0.5" />} label="People & access" collapsed={collapsed} tour="members" badge={waiting} />
              <NavRow active={route.page === 'usage'} onClick={() => navigate('/usage')} icon={<IconChartBar size={16} stroke={1.75} className="mx-0.5" />} label="Usage" collapsed={collapsed} tour="usage" />
            </>
          )}
          {proposals.shown && (
            <NavRow active={route.page === 'proposals'} onClick={() => navigate('/proposals')} icon={<IconGitPullRequest size={16} stroke={1.75} className="mx-0.5" />} label="Proposals" collapsed={collapsed} badge={proposals.waiting} />
          )}
        </nav>
        <div className="mx-2 my-1.5 border-t" />
        <NavRow active={false} onClick={startTour} icon={<IconCompass size={16} stroke={1.75} className="mx-0.5" />} label="Take the tour" collapsed={collapsed} tour="tour" />
        <NavRow active={feedbackOpen} onClick={() => setFeedbackOpen(true)} icon={<IconMessageReport size={16} stroke={1.75} className="mx-0.5" />} label="Feedback" collapsed={collapsed} tour="feedback" />
        <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        <NewSubspaceDialog parent={newSubspaceOf} onOpenChange={open => !open && setNewSubspaceOf(null)} />
        <SamplesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
        <div className="mt-2 flex h-8 items-center gap-1 text-xs text-muted-foreground">
          {/* Your menu: opens on hover, and on click or Enter for touch and keyboard. */}
          <DropdownMenu>
            <DropdownMenuTrigger
              openOnHover
              data-tour="account"
              aria-label="Your menu: Data map and Settings"
              className={cn(
                'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left hover:bg-accent hover:text-foreground data-popup-open:bg-accent',
                (route.page === 'settings' || route.page === 'shared-data') && 'text-foreground'
              )}
            >
              {me.data?.avatarUrl ? (
                <img src={me.data.avatarUrl} alt="" className="size-5 shrink-0 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent font-medium uppercase">
                  {(me.data?.name ?? me.data?.email)?.slice(0, 1)}
                </span>
              )}
              <span className={cn('min-w-0 flex-1 truncate', fade(collapsed))}>{me.data?.name ?? me.data?.email}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="truncate">{me.data?.email}</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => navigate('/shared-data')} className={cn(route.page === 'shared-data' && 'bg-accent font-medium')}>
                  <IconDatabase stroke={1.75} />
                  Data map
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/settings')} className={cn(route.page === 'settings' && 'bg-accent font-medium')}>
                  <IconSettings stroke={1.75} />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Collapsed, the rail is too narrow for it: expand to sign out. */}
          <button
            type="button"
            aria-label="Sign out"
            title="Sign out"
            tabIndex={collapsed ? -1 : undefined}
            className={cn('shrink-0 rounded-md p-1 hover:bg-accent hover:text-foreground', fade(collapsed), collapsed && 'pointer-events-none')}
            onClick={() => void getSupabase().auth.signOut()}
          >
            <IconLogout size={16} stroke={1.75} />
          </button>
        </div>
      </div>
    </aside>
  )
}

// Proposals exist only where the install has them (the Compose install); admins and owners see
// how many wait for them, a member their own that wait.
function useProposalsNav(decider: boolean): { shown: boolean; waiting: number } {
  const data = useProposals().data
  return { shown: Boolean(data), waiting: (data ?? []).filter(p => p.status === 'open' && (decider || p.mine)).length }
}

// Phones have no rail: the same destinations in one menu, on every screen. `label` is where you are.
export function MobileNav({ label, spaces }: { label: string; spaces: Space[] }) {
  const me = useMe()
  const canManageMembers = hasAtLeast(me.data?.tier ?? null, me.data?.status ?? null, 'admin')
  const waiting = useWaitingCount(canManageMembers)
  const proposals = useProposalsNav(canManageMembers)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const templates = useBrowseTemplates(canManageMembers)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  return (
    <div className="md:hidden">
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <SamplesDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={`${label}: open the menu`} data-tour="menu" />}>
          <span className="max-w-28 truncate">{label}</span>
          <IconChevronDown stroke={1.75} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-[80dvh] w-52">
          {inSidebarOrder(spaces).map(space => (
            <DropdownMenuItem key={space.id} onClick={() => navigate(`/${space.slug}`)} className={cn(space.parentId && 'pl-6')}>
              {space.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {templates && <DropdownMenuItem onClick={() => setTemplatesOpen(true)}>Browse templates</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => navigate('/connectors')}>Connectors</DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/shared-data')}>Data map</DropdownMenuItem>
          {canManageMembers && (
            <>
              <DropdownMenuItem onClick={() => navigate('/members')}>People & access{waiting > 0 && ` (${waiting} waiting)`}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/usage')}>Usage</DropdownMenuItem>
            </>
          )}
          {proposals.shown && <DropdownMenuItem onClick={() => navigate('/proposals')}>Proposals{proposals.waiting > 0 && ` (${proposals.waiting} waiting)`}</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => navigate('/settings')}>Settings</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={startTour}>Take the tour</DropdownMenuItem>
          <DropdownMenuItem onClick={() => setFeedbackOpen(true)}>Feedback</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void getSupabase().auth.signOut()}>Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

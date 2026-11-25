// Server state for the shell. `workspace` (spaces, tabs, layouts) is one query
// so moving a tab between spaces is one optimistic update; teammates' changes
// arrive through Supabase Realtime and just invalidate it (see useLiveUpdates).
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import { visibleCatalog } from '../../lib/access'
import type {
  Proposal,
  BuildManifest,
  Catalog,
  CatalogApplet,
  Connector,
  ConnectorInput,
  ConnectorPatch,
  DataUse,
  Department,
  FeedbackInput,
  FeedbackItem,
  Invitation,
  Me,
  Member,
  MemberChange,
  MembersResponse,
  MemberTier,
  OrgSettings,
  RecordCollection,
  SharedRecord,
  Space,
  SpaceAccessChange,
  SpaceAccessResponse,
  SpaceAccessRule,
  SpaceLayout,
  Tab,
  TabRef,
  WelcomeInput,
  WelcomeResult,
  WelcomeState,
  WidgetPlacement,
  Workspace
} from '../../lib/types'
import type { UsageAction, UsageReport } from '../../lib/usage'
import { getSupabase } from '../runtime/session'
import { api, HttpError, staticJson } from './http'
import { trackAction } from './usage'
import { toast } from './toast'

export const keys = {
  workspace: ['workspace'] as const,
  catalog: ['catalog'] as const,
  manifest: ['manifest'] as const,
  connectors: ['connectors'] as const,
  me: ['me'] as const,
  members: ['members'] as const,
  departments: ['departments'] as const,
  spaceAccess: ['space-access'] as const,
  spaceAccessSpaces: ['space-access', 'spaces'] as const,
  usage: (days: number) => ['usage', days] as const,
  proposals: ['proposals'] as const,
  proposalDiff: (id: string) => ['proposals', id, 'diff'] as const,
  myFeedback: ['feedback', 'mine'] as const,
  allFeedback: ['feedback', 'all'] as const,
  collections: ['records'] as const,
  dataMap: ['data-map'] as const,
  records: (name: string) => ['records', name] as const,
  settings: ['settings'] as const,
  allowedDomains: ['allowed-domains'] as const,
  invitations: ['invitations'] as const
}

export function useMe() {
  return useQuery(meQuery)
}

// The welcome step on first sign-in (components/Onboarding.tsx).
export function useWelcome(enabled: boolean) {
  return useQuery({ queryKey: ['welcome'], queryFn: () => api<WelcomeState>('/api/welcome'), enabled, staleTime: Infinity })
}

// A department opens spaces, so everything that depends on who they are is read again.
export function useSaveWelcome() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: WelcomeInput) => api<WelcomeResult>('/api/welcome', { method: 'POST', body: input }),
    onSuccess: () =>
      Promise.all([keys.me, keys.spaceAccess, keys.catalog, keys.workspace, keys.departments].map(queryKey => qc.invalidateQueries({ queryKey })))
  })
}

// Admins and owners only (the Sidebar shows the page from /api/me's tier).
export function useMembers() {
  return useQuery({ queryKey: keys.members, queryFn: () => api<MembersResponse>('/api/members') })
}

// How many people wait for an admin to let them in, for the sidebar. Shares the Members page's cache.
export function useWaitingCount(enabled: boolean) {
  return useQuery({
    queryKey: keys.members,
    queryFn: () => api<MembersResponse>('/api/members'),
    enabled,
    // Nothing pushes a new sign-up (no realtime on app.app_user) and focus refetch is off app-wide.
    refetchInterval: 60_000,
    select: data => data.members.filter(member => member.status === 'pending').length
  }).data ?? 0
}

// The Usage page, for admins and owners (the API refuses anyone else). Days are counted in the
// viewer's own time zone.
// The Proposals page (server/proposal-routes.ts). null where the install has none (no spaces
// volume: the routes answer 404), so the sidebar leaves the page out.
export function useProposals() {
  return useQuery({
    queryKey: keys.proposals,
    queryFn: async () => {
      try {
        return await api<Proposal[]>('/api/proposals')
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return null
        throw err
      }
    },
    retry: false
  })
}

export function useProposalDiff(id: string, enabled: boolean) {
  return useQuery({ queryKey: keys.proposalDiff(id), queryFn: () => api<{ diff: string; cut: boolean }>(`/api/proposals/${encodeURIComponent(id)}/diff`), enabled })
}

export type ProposalAction = 'approve' | 'reject' | 'withdraw'

// Approving waits for the build and changes spaces, so the workspace and catalog are read again.
export function useDecideProposal() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: ProposalAction; reason?: string }) =>
      api<{ status: string; errors?: string }>(`/api/proposals/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: reason === undefined ? {} : { reason } }),
    onSettled: async (_data, _err, { action }) => {
      await qc.invalidateQueries({ queryKey: keys.proposals })
      if (action === 'approve') await Promise.all([qc.invalidateQueries({ queryKey: keys.workspace }), qc.invalidateQueries({ queryKey: keys.catalog })])
    }
  })
}

export function useUsageReport(days: number) {
  return useQuery({
    queryKey: keys.usage(days),
    queryFn: () => {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      return api<UsageReport>(`/api/usage/report?days=${days}&tz=${encodeURIComponent(tz)}`)
    },
    staleTime: 60_000
  })
}

// Your own feedback and whether it was completed; fetched while the dialog is open.
export function useMyFeedback(enabled: boolean) {
  return useQuery({ queryKey: keys.myFeedback, queryFn: () => api<FeedbackItem[]>('/api/feedback/mine'), enabled })
}

// Everyone's feedback, for owners and admins (the API refuses anyone else).
export function useAllFeedback(enabled: boolean) {
  return useQuery({ queryKey: keys.allFeedback, queryFn: () => api<FeedbackItem[]>('/api/feedback'), enabled })
}

export function useCompleteFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) =>
      api<FeedbackItem>(`/api/feedback/${id}`, { method: 'PATCH', body: { completed } }),
    onError: err => toast(`Couldn't update the issue: ${err instanceof Error ? err.message : String(err)}`, 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] })
  })
}

export function useSendFeedback() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: FeedbackInput) => api<FeedbackItem>('/api/feedback', { method: 'POST', body: input }),
    onSuccess: () => trackAction('feedback.send', null),
    onSettled: () => qc.invalidateQueries({ queryKey: ['feedback'] })
  })
}

// A deleted or re-roled member also changes department counts and who a space rule reaches.
function invalidatePeople(qc: QueryClient) {
  return Promise.all([keys.members, keys.departments, keys.spaceAccess, keys.catalog].map(queryKey => qc.invalidateQueries({ queryKey })))
}

export function useChangeMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: MemberChange }) =>
      api<Member>(`/api/members/${id}`, { method: 'PATCH', body: change }),
    onError: err => toast(`Couldn't change the role: ${err instanceof Error ? err.message : String(err)}`, 'error'),
    onSettled: () => invalidatePeople(qc)
  })
}

export function useDeleteMember() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/api/members/${id}`, { method: 'DELETE' }),
    onError: err => toast(`Couldn't delete the member: ${err instanceof Error ? err.message : String(err)}`, 'error'),
    onSettled: () => invalidatePeople(qc)
  })
}

// Email domains whose new sign-ups get in as members (Members tab). Errors show next to the input.
export function useAllowedDomains() {
  return useQuery({ queryKey: keys.allowedDomains, queryFn: () => api<string[]>('/api/allowed-domains') })
}

export function useAddAllowedDomain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (domain: string) => api<{ domain: string }>('/api/allowed-domains', { method: 'POST', body: { domain } }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.allowedDomains })
  })
}

export function useRemoveAllowedDomain() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (domain: string) => api(`/api/allowed-domains/${encodeURIComponent(domain)}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.allowedDomains })
  })
}

// Admins and owners only: open invites (server/invitations.ts).
export function useInvitations() {
  return useQuery({ queryKey: keys.invitations, queryFn: () => api<Invitation[]>('/api/invitations') })
}

export function useInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invite: { email: string; tier: MemberTier }) => api<Invitation>('/api/invitations', { method: 'POST', body: invite }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.invitations })
  })
}

export function useRevokeInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/api/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.invitations })
  })
}

// Which tiers see which space (Space access page); everyone reads them.
export function useSpaceAccessRules() {
  return useQuery({ queryKey: keys.spaceAccess, queryFn: () => api<SpaceAccessRule[]>('/api/space-access') })
}

// Admins and owners only: every space with who sees it.
export function useSpaceAccess() {
  return useQuery({ queryKey: keys.spaceAccessSpaces, queryFn: () => api<SpaceAccessResponse>('/api/space-access/spaces') })
}

// `access: null` goes back to the space's default.
export function useSetSpaceAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ spaceId, access }: { spaceId: string; access: SpaceAccessChange | null }) =>
      api(`/api/space-access/${encodeURIComponent(spaceId)}`, { method: 'PUT', body: access ?? { tiers: null } }),
    onMutate: async ({ spaceId, access }) => {
      await qc.cancelQueries({ queryKey: keys.spaceAccessSpaces })
      const previous = qc.getQueryData<SpaceAccessResponse>(keys.spaceAccessSpaces)
      if (previous) {
        const reset = { departments: [], people: [] }
        qc.setQueryData<SpaceAccessResponse>(keys.spaceAccessSpaces, {
          ...previous,
          spaces: previous.spaces.map(s =>
            s.id === spaceId ? { ...s, ...(access ?? { ...reset, tiers: s.defaultTiers }), custom: access !== null } : s
          )
        })
      }
      return { previous }
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(keys.spaceAccessSpaces, context.previous)
      toast(`Couldn't change who sees the space: ${err instanceof Error ? err.message : String(err)}`, 'error')
    },
    // Your own sidebar can change too: an admin can take a space away from admins.
    onSettled: () => Promise.all([keys.spaceAccess, keys.catalog, keys.workspace].map(queryKey => qc.invalidateQueries({ queryKey })))
  })
}

// Admins and owners only: departments and who is in them (Members and Space access pages).
export function useDepartments() {
  return useQuery({ queryKey: keys.departments, queryFn: () => api<Department[]>('/api/departments') })
}

// A department change can change who a space rule reaches, so the rules reload too.
function useDepartmentMutation<T>(fn: (vars: T) => Promise<unknown>, failure: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onError: err => toast(`${failure}: ${err instanceof Error ? err.message : String(err)}`, 'error'),
    onSettled: () => Promise.all([keys.departments, keys.spaceAccess, keys.catalog].map(queryKey => qc.invalidateQueries({ queryKey })))
  })
}

export function useCreateDepartment() {
  return useDepartmentMutation((name: string) => api<Department>('/api/departments', { method: 'POST', body: { name } }), "Couldn't add the team")
}

export function useRenameDepartment() {
  return useDepartmentMutation(
    ({ id, name }: { id: string; name: string }) => api(`/api/departments/${id}`, { method: 'PATCH', body: { name } }),
    "Couldn't rename the team"
  )
}

export function useDeleteDepartment() {
  return useDepartmentMutation((id: string) => api(`/api/departments/${id}`, { method: 'DELETE' }), "Couldn't delete the team")
}

export function useSetDepartmentMembers() {
  return useDepartmentMutation(async ({ departmentId, userIds, on }: { departmentId: string; userIds: string[]; on: boolean }) => {
    // shortcut: one request per person, eight at a time; give the API a bulk route if a selection runs to many hundreds.
    for (let i = 0; i < userIds.length; i += 8) {
      await Promise.all(userIds.slice(i, i + 8).map(userId => api(`/api/departments/${departmentId}/members/${userId}`, { method: on ? 'PUT' : 'DELETE' })))
    }
  }, "Couldn't change the team")
}

// Realtime keeps the workspace fresh (useLiveUpdates), so it only refetches on focus once it is
// five minutes old, for changes Realtime doesn't carry (a tier or space-access change).
export const workspaceQuery = {
  queryKey: keys.workspace,
  queryFn: () => api<Workspace>('/api/workspace'),
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: true
}

// Read again on focus after five minutes, so a promoted, moved or suspended person sees it without
// a full reload (a refused answer reaches the Gate in main.tsx).
export const meQuery = { queryKey: keys.me, queryFn: () => api<Me>('/api/me'), staleTime: 5 * 60_000, refetchOnWindowFocus: true }

// Signed-in only and filtered to what this person sees (GET /api/catalog), so it is read again with
// the workspace and whenever who sees what may have changed.
export const catalogQuery = {
  queryKey: keys.catalog,
  queryFn: () => api<Catalog>('/api/catalog'),
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: true
}

export const manifestQuery = {
  queryKey: keys.manifest,
  queryFn: () => staticJson<BuildManifest>('/manifest.json'),
  staleTime: Infinity
}

export function useWorkspace() {
  return useQuery(workspaceQuery)
}

// Without the spaces the viewer's tier doesn't see (spaces.json minTier, or a
// rule from the Space access page) and their views and widgets, and without
// views and widgets that ask for a higher tier themselves. Until /api/me
// answers, that's everything that asks for a tier.
export function useCatalog() {
  const me = useMe().data
  const rules = useSpaceAccessRules().data
  const tier = me?.tier ?? null
  const status = me?.status ?? null
  const id = me?.id
  const select = useCallback((catalog: Catalog) => visibleCatalog(catalog, { id, tier, status }, rules), [id, tier, status, rules])
  return useQuery({ ...catalogQuery, select })
}

export function useManifest() {
  return useQuery(manifestQuery)
}

// Memoised on the catalog, so effects that depend on it (App's bridge) don't rerun every render.
export function useApplets(): Map<string, CatalogApplet> {
  const { data } = useCatalog()
  return useMemo(() => {
    const map = new Map<string, CatalogApplet>()
    for (const applet of data?.applets ?? []) map.set(`${applet.kind}:${applet.ref}`, applet)
    return map
  }, [data])
}

export function useConnectors() {
  return useQuery({ queryKey: keys.connectors, queryFn: () => api<Connector[]>('/api/connectors') })
}

export function useDataMap() {
  return useQuery({ queryKey: keys.dataMap, queryFn: () => api<DataUse[]>('/api/data-map'), staleTime: Infinity })
}

export function useCollections() {
  return useQuery({ queryKey: keys.collections, queryFn: () => api<RecordCollection[]>('/api/records') })
}

export function useRecords(collection: string | undefined) {
  return useQuery({
    queryKey: keys.records(collection ?? ''),
    queryFn: () => api<SharedRecord[]>(`/api/records/${encodeURIComponent(collection!)}`),
    enabled: Boolean(collection)
  })
}

// --- Workspace mutations ----------------------------------------------------------

function patchWorkspace(qc: QueryClient, update: (w: Workspace) => Workspace): Workspace | undefined {
  const previous = qc.getQueryData<Workspace>(keys.workspace)
  if (previous) qc.setQueryData(keys.workspace, update(previous))
  return previous
}

// Workspace and connector writes run one at a time per key (a layout PUT sends
// the whole grid, so two in flight at once can undo each other), and the list
// is refetched only once the last one settles: a refetch while saves are
// pending would bring back what they're about to change. Realtime waits too.
export function settleLast(qc: QueryClient, key: readonly string[]): Promise<void> | undefined {
  return qc.isMutating({ mutationKey: key }) === 1 ? qc.invalidateQueries({ queryKey: key }) : undefined
}

function useWorkspaceMutation<V>(options: {
  run: (vars: V) => Promise<unknown>
  optimistic?: (w: Workspace, vars: V) => Workspace
  error: string
  // Counted on the Usage page once the server has taken it, with the space it happened in.
  action: UsageAction
  spaceOf: (vars: V) => string | null
}) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: keys.workspace,
    scope: { id: 'workspace' },
    mutationFn: options.run,
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: keys.workspace })
      return { previous: options.optimistic ? patchWorkspace(qc, w => options.optimistic!(w, vars)) : undefined }
    },
    onSuccess: (_data, vars) => trackAction(options.action, options.spaceOf(vars)),
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.workspace, ctx.previous)
      toast(`${options.error}: ${err instanceof Error ? err.message : String(err)}`, 'error')
    },
    onSettled: () => settleLast(qc, keys.workspace)
  })
}

export function useOpenTab() {
  return useWorkspaceMutation<{ spaceId: string; ref: TabRef; params?: Record<string, unknown> }>({
    run: ({ spaceId, ref, params }) => api<Tab>(`/api/spaces/${spaceId}/tabs`, { method: 'POST', body: { ref, params } }),
    optimistic: (w, { spaceId, ref, params }) => {
      const existing = w.tabs.find(t => t.spaceId === spaceId && t.ref === ref)
      if (existing) {
        return params === undefined ? w : { ...w, tabs: w.tabs.map(t => (t === existing ? { ...t, params } : t)) }
      }
      const max = Math.max(-1, ...w.tabs.filter(t => t.spaceId === spaceId).map(t => t.position))
      const tab: Tab = { id: `pending-${ref}`, spaceId, ref, position: max + 1, params: params ?? null }
      return { ...w, tabs: [...w.tabs, tab] }
    },
    error: "Couldn't open the tab",
    action: 'tab.open',
    spaceOf: v => v.spaceId
  })
}

export function useCloseTab() {
  return useWorkspaceMutation<{ tabId: string }>({
    run: ({ tabId }) => api(`/api/tabs/${tabId}`, { method: 'DELETE' }),
    optimistic: (w, { tabId }) => ({ ...w, tabs: w.tabs.filter(t => t.id !== tabId) }),
    error: "Couldn't close the tab",
    action: 'tab.close',
    spaceOf: () => null
  })
}

export function useMoveTab() {
  return useWorkspaceMutation<{ tabId: string; spaceId: string }>({
    run: ({ tabId, spaceId }) => api<Tab>(`/api/tabs/${tabId}/move`, { method: 'POST', body: { spaceId } }),
    optimistic: (w, { tabId, spaceId }) => {
      const tab = w.tabs.find(t => t.id === tabId)
      if (!tab) return w
      const duplicate = w.tabs.some(t => t.spaceId === spaceId && t.ref === tab.ref)
      const max = Math.max(-1, ...w.tabs.filter(t => t.spaceId === spaceId).map(t => t.position))
      return {
        ...w,
        tabs: duplicate
          ? w.tabs.filter(t => t.id !== tabId)
          : w.tabs.map(t => (t.id === tabId ? { ...t, spaceId, position: max + 1 } : t))
      }
    },
    error: "Couldn't move the tab",
    action: 'tab.move',
    spaceOf: v => v.spaceId
  })
}

export function useReorderTabs() {
  return useWorkspaceMutation<{ spaceId: string; ids: string[] }>({
    run: ({ spaceId, ids }) => api(`/api/spaces/${spaceId}/tabs/order`, { method: 'PUT', body: { ids } }),
    optimistic: (w, { ids }) => ({
      ...w,
      tabs: w.tabs.map(t => (ids.includes(t.id) ? { ...t, position: ids.indexOf(t.id) } : t))
    }),
    error: "Couldn't reorder tabs",
    action: 'tab.reorder',
    spaceOf: v => v.spaceId
  })
}

export function useSaveLayout() {
  return useWorkspaceMutation<{ spaceId: string; widgets: WidgetPlacement[] }>({
    run: ({ spaceId, widgets }) => api<SpaceLayout>(`/api/spaces/${spaceId}/layout`, { method: 'PUT', body: { widgets } }),
    optimistic: (w, { spaceId, widgets }) => {
      const current = w.layouts.find(l => l.spaceId === spaceId) ?? { spaceId, widgets: [], activeTab: null }
      return { ...w, layouts: [...w.layouts.filter(l => l.spaceId !== spaceId), { ...current, widgets }] }
    },
    error: "Couldn't save the layout",
    action: 'widget.arrange',
    spaceOf: v => v.spaceId
  })
}

export function useMoveWidget() {
  return useWorkspaceMutation<{ fromSpaceId: string; toSpaceId: string; ref: string }>({
    run: ({ fromSpaceId, toSpaceId, ref }) =>
      api(`/api/spaces/${fromSpaceId}/widgets/move`, { method: 'POST', body: { ref, spaceId: toSpaceId } }),
    optimistic: (w, { fromSpaceId, toSpaceId, ref }) => ({
      ...w,
      layouts: w.layouts.map(l =>
        l.spaceId === fromSpaceId
          ? { ...l, widgets: l.widgets.filter(x => x.ref !== ref) }
          : l.spaceId === toSpaceId && !l.widgets.some(x => x.ref === ref)
            ? { ...l, widgets: [...l.widgets, { ref }] }
            : l
      )
    }),
    error: "Couldn't move the widget",
    action: 'widget.move',
    spaceOf: v => v.toSpaceId
  })
}

// A space's name, symbol or both. Admins and owners (Settings → Organisation); the API refuses anyone else.
export function useEditSpace() {
  return useWorkspaceMutation<{ spaceId: string; name?: string; symbol?: string | null }>({
    run: ({ spaceId, ...body }) => api<Space>(`/api/spaces/${encodeURIComponent(spaceId)}`, { method: 'PATCH', body }),
    optimistic: (w, { spaceId, ...change }) => ({ ...w, spaces: w.spaces.map(s => (s.id === spaceId ? { ...s, ...change } : s)) }),
    error: "Couldn't update the space",
    action: 'space.edit',
    spaceOf: v => v.spaceId
  })
}

// A new top-level space with no folder (Settings → Organisation). Admins and owners; the API
// refuses anyone else. It has no tabs yet; the refetch brings it to the sidebar.
export function useCreateSpace() {
  return useWorkspaceMutation<{ name: string; symbol: string | null }>({
    run: body => api<Space>('/api/spaces', { method: 'POST', body }),
    error: "Couldn't add the space",
    action: 'space.create',
    spaceOf: () => null
  })
}

// Owners only (the API refuses anyone else). A new subspace has no tabs yet; the refetch brings it.
export function useCreateSubspace() {
  return useWorkspaceMutation<{ parentId: string; name: string }>({
    run: ({ parentId, name }) => api<Space>(`/api/spaces/${encodeURIComponent(parentId)}/subspaces`, { method: 'POST', body: { name } }),
    error: "Couldn't make the subspace",
    action: 'subspace.create',
    spaceOf: v => v.parentId
  })
}

export function useDeleteSubspace() {
  return useWorkspaceMutation<{ spaceId: string; parentId: string }>({
    run: ({ spaceId }) => api(`/api/spaces/${encodeURIComponent(spaceId)}`, { method: 'DELETE' }),
    optimistic: (w, { spaceId }) => ({
      spaces: w.spaces.filter(s => s.id !== spaceId),
      tabs: w.tabs.filter(t => t.spaceId !== spaceId),
      layouts: w.layouts.filter(l => l.spaceId !== spaceId)
    }),
    error: "Couldn't delete the subspace",
    action: 'subspace.delete',
    spaceOf: v => v.parentId
  })
}

// --- Organisation settings ------------------------------------------------------------

// Everyone reads the organisation's look; Realtime brings an admin's change (useLiveUpdates).
export function useOrgSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<OrgSettings>('/api/settings'), staleTime: 5 * 60_000 })
}

export function useSaveOrgTheme() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: keys.settings,
    mutationFn: (theme: OrgSettings['theme']) => api<OrgSettings>('/api/settings/theme', { method: 'PUT', body: theme }),
    onMutate: async theme => {
      await qc.cancelQueries({ queryKey: keys.settings })
      const previous = qc.getQueryData<OrgSettings>(keys.settings)
      qc.setQueryData<OrgSettings>(keys.settings, { theme, name: previous?.name ?? null })
      return { previous }
    },
    onSuccess: () => trackAction('theme.edit', null),
    onError: (err, _theme, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.settings, ctx.previous)
      toast(`Couldn't save the look: ${err instanceof Error ? err.message : String(err)}`, 'error')
    },
    onSettled: () => settleLast(qc, keys.settings)
  })
}

export function useSaveOrgName() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: keys.settings,
    mutationFn: (name: string | null) => api<OrgSettings>('/api/settings/name', { method: 'PUT', body: { name } }),
    onMutate: async name => {
      await qc.cancelQueries({ queryKey: keys.settings })
      const previous = qc.getQueryData<OrgSettings>(keys.settings)
      qc.setQueryData<OrgSettings>(keys.settings, { theme: previous?.theme ?? {}, name })
      return { previous }
    },
    onError: (err, _name, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.settings, ctx.previous)
      toast(`Couldn't save the workspace name: ${err instanceof Error ? err.message : String(err)}`, 'error')
    },
    onSettled: () => settleLast(qc, keys.settings)
  })
}

// --- Connectors ---------------------------------------------------------------------

export function useCreateConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: ConnectorInput) => api<Connector>('/api/connectors', { method: 'POST', body: input }),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.connectors })
  })
}

export function useUpdateConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: keys.connectors,
    scope: { id: 'connectors' },
    mutationFn: ({ id, patch }: { id: string; patch: ConnectorPatch }) =>
      api<Connector>(`/api/connectors/${id}`, { method: 'PATCH', body: patch }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: keys.connectors })
      const previous = qc.getQueryData<Connector[]>(keys.connectors)
      if (previous && patch.disabledSpaceIds) {
        qc.setQueryData(
          keys.connectors,
          previous.map(c => (c.id === id ? { ...c, disabledSpaceIds: patch.disabledSpaceIds! } : c))
        )
      }
      return { previous }
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.connectors, ctx.previous)
      toast(`Couldn't save the connector: ${err instanceof Error ? err.message : String(err)}`, 'error')
    },
    onSettled: () => settleLast(qc, keys.connectors)
  })
}

export function useDeleteConnector() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/api/connectors/${id}`, { method: 'DELETE' }),
    onError: err => toast(`Couldn't remove the connector: ${err instanceof Error ? err.message : String(err)}`, 'error'),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.connectors })
  })
}

// --- Live updates -------------------------------------------------------------------

export function useLiveUpdates(): void {
  const qc = useQueryClient()
  useEffect(() => {
    const supabase = getSupabase()
    let timer: ReturnType<typeof setTimeout> | undefined
    let subscribedBefore = false
    // Skipped while this browser's own saves are pending: the last one refetches (settleLast).
    const refresh = (key: readonly string[]) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (qc.isMutating({ mutationKey: key }) === 0) void qc.invalidateQueries({ queryKey: key })
      }, 250)
    }
    const channel = supabase
      .channel('miso-workspace')
      .on('postgres_changes', { event: '*', schema: 'miso', table: 'spaces' }, () => refresh(keys.workspace))
      .on('postgres_changes', { event: '*', schema: 'miso', table: 'tabs' }, () => refresh(keys.workspace))
      .on('postgres_changes', { event: '*', schema: 'miso', table: 'space_layouts' }, () => refresh(keys.workspace))
      .on('postgres_changes', { event: '*', schema: 'miso', table: 'org_settings' }, () => {
        if (qc.isMutating({ mutationKey: keys.settings }) === 0) void qc.invalidateQueries({ queryKey: keys.settings })
      })
      .on('postgres_changes', { event: '*', schema: 'miso', table: 'connectors' }, () => {
        if (qc.isMutating({ mutationKey: keys.connectors }) === 0) void qc.invalidateQueries({ queryKey: keys.connectors })
      })
      .subscribe(status => {
        // Changes made while the channel was down (sleep, lost network) sent no events.
        if (status !== 'SUBSCRIBED') return
        if (subscribedBefore) {
          refresh(keys.workspace)
          void qc.invalidateQueries({ queryKey: keys.catalog })
          void qc.invalidateQueries({ queryKey: keys.connectors })
          void qc.invalidateQueries({ queryKey: keys.settings })
        }
        subscribedBefore = true
      })
    return () => {
      clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [qc])
}

// Spaces (a tab of People & access): who sees each space. A space is either
// shared with everyone, or limited to the departments, people and roles picked
// here; owners always see every space. A space nobody changed keeps its default
// from spaces.json (`minTier`). The server applies the rules
// (app/lib/access.ts); this page only edits them.
import type { Department, Member, MemberTier, SpaceAccessChange, SpaceAccessEntry } from '../../lib/types'
import { useConfirm } from '../components/ConfirmDialog'
import { Picker } from '../components/Picker'
import { TIER_LABEL } from '../lib/labels'
import { accessSummary, displayName, isShared, limitedAccess, limitWarning, sharedAccess } from '../lib/people'
import { useDepartments, useMe, useMembers, useSetSpaceAccess, useSpaceAccess } from '../lib/queries'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Skeleton } from '../ui/skeleton'

const WHO = [
  { value: 'shared', label: 'Everyone' },
  { value: 'limited', label: 'Only the people I pick' }
]

type SpaceRowProps = {
  space: SpaceAccessEntry
  tiers: MemberTier[]
  // Undefined while they load: a pick can't be told from a deleted one yet.
  departments: Department[] | undefined
  people: Member[] | undefined
  isOwner: boolean
}

function SpaceRow({ space, tiers, departments, people, isOwner }: SpaceRowProps) {
  const setAccess = useSetSpaceAccess()
  const [confirm, confirmDialog] = useConfirm()
  const current: SpaceAccessChange = { tiers: space.tiers, departments: space.departments, people: space.people }
  const shared = isShared(space, tiers)

  const toggle = (key: keyof SpaceAccessChange, id: string, on: boolean) => {
    const list: string[] = current[key]
    const next = on ? [...list, id] : list.filter(x => x !== id)
    // `next` keeps the key's own element type: it's `list` plus an id from that key's own options.
    setAccess.mutate({ spaceId: space.id, access: { ...current, [key]: next } as SpaceAccessChange })
  }

  return (
    <li className="flex items-center gap-4 rounded-xl bg-background px-4 py-3 shadow-xs max-lg:flex-wrap">
      <div className="flex min-w-56 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{space.name}</span>
        <div className="flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>Seen by: {accessSummary(space, tiers, departments ?? [])}</span>
          {space.custom && (
            <Button
              variant="ghost"
              size="xs"
              className="text-muted-foreground"
              disabled={setAccess.isPending}
              title={`Back to how this space started: seen by ${accessSummary({ ...space, tiers: space.defaultTiers, departments: [], people: [] }, tiers, []).toLowerCase()}`}
              onClick={() => setAccess.mutate({ spaceId: space.id, access: null })}
            >
              Reset to default
            </Button>
          )}
        </div>
      </div>
      {/* One width on wide screens, so "Who sees it" starts at the same place on every row. */}
      <div className="flex flex-wrap items-end gap-3 lg:w-[36rem] lg:shrink-0">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Who sees it</span>
          <Select
            items={WHO}
            value={shared ? 'shared' : 'limited'}
            disabled={setAccess.isPending}
            onValueChange={next => {
              if (!next || (next === 'shared') === shared) return
              if (next === 'shared') setAccess.mutate({ spaceId: space.id, access: sharedAccess(tiers) })
              else confirm({ ...limitWarning(space.name), run: () => setAccess.mutate({ spaceId: space.id, access: limitedAccess(space) }) })
            }}
          >
            <SelectTrigger size="sm" className="w-48" aria-label={`Who sees ${space.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WHO.map(item => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!shared && (
          <>
            <Picker
              label="Teams"
              empty="No teams yet. Add them on the Teams tab."
              none="No teams"
              gone="Deleted team"
              options={(departments ?? []).map(d => ({ id: d.id, label: d.name }))}
              selected={space.departments}
              disabled={setAccess.isPending || !departments}
              onToggle={(id, on) => toggle('departments', id, on)}
            />
            <Picker
              label="Single people"
              empty="Nobody to pick."
              none="Nobody"
              gone="Deleted person"
              // Someone waiting or suspended sees nothing, but stays listed so the pick can be seen and undone.
              options={(people ?? [])
                .filter(p => p.status === 'active' || space.people.includes(p.id))
                .map(p => ({ id: p.id, label: p.status === 'active' ? displayName(p) : `${displayName(p)} (${p.status === 'pending' ? 'waiting' : 'suspended'})` }))}
              selected={space.people}
              disabled={setAccess.isPending || !people}
              onToggle={(id, on) => toggle('people', id, on)}
            />
            <Picker
              label="Everyone with the role"
              empty="No roles."
              none="No roles"
              gone="Unknown role"
              // Only an owner takes admins off a space (the server says the same).
              options={tiers.map(tier => ({ id: tier, label: `${TIER_LABEL[tier]}s`, disabled: tier === 'admin' && !isOwner && space.tiers.includes('admin') }))}
              selected={space.tiers}
              disabled={setAccess.isPending}
              onToggle={(id, on) => toggle('tiers', id, on)}
            />
          </>
        )}
      </div>
      {confirmDialog}
    </li>
  )
}

export function SpaceAccessPage() {
  const access = useSpaceAccess()
  const departments = useDepartments()
  const members = useMembers()
  const isOwner = useMe().data?.tier === 'owner'

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        A space is shared with everyone, or limited to the people you pick: whole teams, single people, or everyone with a role. Anyone
        who matches one of them sees it, and owners always see every space.
      </p>

      {access.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}
      {access.isError && <p className="text-sm text-destructive">Couldn't load spaces: {access.error.message}</p>}
      {departments.isError && <p className="text-sm text-destructive">Couldn't load teams: {departments.error.message}</p>}
      {members.isError && <p className="text-sm text-destructive">Couldn't load members: {members.error.message}</p>}

      {access.data && (
        <ul className="flex flex-col gap-2">
          {access.data.spaces.map(space => (
            <SpaceRow
              key={space.id}
              space={space}
              tiers={access.data.tiers}
              departments={departments.data}
              people={members.data?.members}
              isOwner={isOwner}
            />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Someone who can't see a space can't see its views and widgets either. The shared data it shows stays protected by each person's role.
      </p>
    </div>
  )
}

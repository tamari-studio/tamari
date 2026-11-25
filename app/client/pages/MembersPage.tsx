// Members (a tab of People & access): everyone with a login, their role, their
// departments and (owners only) when they last used the app. The list is
// searched, filtered and sorted in the browser; ticked people are put in or
// taken out of a department together. Admins and owners change roles and delete
// an account outright after confirming; the server and the database enforce who
// may change whom, this page only explains it.
import { IconChevronDown, IconCopy, IconLock, IconTrash, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import type { Department, Invitation, Member, MemberTier } from '../../lib/types'
import { useConfirm } from '../components/ConfirmDialog'
import { TIER_LABEL } from '../lib/labels'
import { displayName, filterMembers, NO_FILTER, type MemberFilter, type MemberSort } from '../lib/people'
import { formatLastActive } from '../lib/relative-time'
import {
  useAddAllowedDomain,
  useAllowedDomains,
  useChangeMember,
  useDeleteMember,
  useDepartments,
  useInvitations,
  useInvite,
  useMembers,
  useRemoveAllowedDomain,
  useRevokeInvite,
  useSetDepartmentMembers
} from '../lib/queries'
import { toast } from '../lib/toast'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/alert-dialog'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Skeleton } from '../ui/skeleton'
import { APP_NAME } from '../../lib/brand'

// Rows drawn at once; the rest come with "Show more", so a long list stays quick.
const PAGE = 100

function StatusBadge({ member }: { member: Member }) {
  if (member.status === 'active') return <span className="text-xs text-muted-foreground">Active</span>
  if (member.status === 'suspended') return <Badge variant="destructive">Suspended</Badge>
  return <Badge variant="secondary">Waiting</Badge>
}

function RoleCell({ member, tiers }: { member: Member; tiers: MemberTier[] }) {
  const change = useChangeMember()
  const [confirm, confirmDialog] = useConfirm()

  if (member.locked) {
    return (
      <span title={member.locked} className="flex h-8 w-36 items-center gap-1.5 text-sm text-muted-foreground">
        <IconLock size={16} stroke={1.75} aria-hidden />
        {member.tier ? TIER_LABEL[member.tier] : 'No role'}
        <span className="sr-only">({member.locked})</span>
      </span>
    )
  }

  const items = [...tiers.map(tier => ({ value: tier, label: TIER_LABEL[tier] })), { value: 'suspended', label: 'Suspended' }]
  const value = member.status === 'suspended' ? 'suspended' : member.tier
  return (
    <>
      <Select
        items={items}
        value={value}
        disabled={change.isPending}
        onValueChange={next => {
          if (!next || next === value) return
          if (next !== 'suspended') return change.mutate({ id: member.id, change: { tier: next as MemberTier } })
          confirm({
            title: `Suspend ${displayName(member)}?`,
            description: `${member.email ?? 'They'} can't open the workspace any more (within a minute), until an admin gives them a role again. Their account and activity stay.`,
            action: 'Suspend',
            destructive: true,
            run: () => change.mutate({ id: member.id, change: { status: 'suspended' } })
          })
        }}
      >
        <SelectTrigger className="w-36" aria-label={`Role for ${displayName(member)}`}>
          <SelectValue placeholder="Choose a role" />
        </SelectTrigger>
        <SelectContent>
          {items.map(item => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {confirmDialog}
    </>
  )
}

function DepartmentsCell({ member, departments }: { member: Member; departments: Department[] }) {
  const setMembers = useSetDepartmentMembers()
  const names = departments.filter(d => d.memberIds.includes(member.id)).map(d => d.name)
  const label = names.length ? names.join(', ') : 'No team'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="w-40 justify-between font-normal"
            disabled={setMembers.isPending}
            title={label}
            aria-label={`Teams for ${displayName(member)}: ${label}`}
          />
        }
      >
        <span className="truncate">{label}</span>
        <IconChevronDown stroke={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {departments.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Add a team on the Teams tab first.</p>}
        {departments.map(department => (
          <DropdownMenuCheckboxItem
            key={department.id}
            checked={department.memberIds.includes(member.id)}
            disabled={setMembers.isPending}
            // Stay open: someone can be in several departments.
            closeOnClick={false}
            onCheckedChange={on => setMembers.mutate({ departmentId: department.id, userIds: [member.id], on })}
          >
            {department.name}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type Item = { value: string; label: string }

function FilterSelect({ label, value, items, onChange }: { label: string; value: string; items: Item[]; onChange: (value: string) => void }) {
  return (
    <Select items={items} value={value} onValueChange={next => next && onChange(next as string)}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(item => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// "Add to department" / "Remove from department" for the ticked people.
function BulkMenu({ label, departments, disabled, onPick }: { label: string; departments: Department[]; disabled: boolean; onPick: (d: Department) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={disabled} />}>
        {label}
        <IconChevronDown stroke={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        {departments.length === 0 && <p className="px-2 py-1.5 text-xs text-muted-foreground">Add a team on the Teams tab first.</p>}
        {departments.map(department => (
          <DropdownMenuItem key={department.id} onClick={() => onPick(department)}>
            {department.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Email domains whose new sign-ups get in as members without waiting (server/allowed-domains.ts).
function DomainsCard() {
  const domains = useAllowedDomains()
  const add = useAddAllowedDomain()
  const remove = useRemoveAllowedDomain()
  const [domain, setDomain] = useState('')
  const [confirm, confirmDialog] = useConfirm()
  const error = add.error ?? remove.error ?? domains.error

  return (
    <section aria-labelledby="allowed-domains" className="flex flex-col gap-3 rounded-xl bg-background p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="allowed-domains" className="flex-1 text-sm font-medium">
          Let people in by email domain
        </h2>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault()
            remove.reset()
            add.mutate(domain, { onSuccess: () => setDomain('') })
          }}
        >
          <Input
            className="w-56"
            value={domain}
            onChange={e => setDomain(e.target.value)}
            placeholder="yourcompany.com"
            aria-label="Email domain"
            aria-invalid={add.isError || undefined}
            maxLength={253}
          />
          <Button type="submit" variant="outline" disabled={add.isPending || !domain.trim()}>
            Add
          </Button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground">
        New sign-ups with these addresses get in as members. People already waiting stay waiting: let them in below.
      </p>
      {domains.data && domains.data.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {domains.data.map(d => (
            <li key={d} className="flex h-7 items-center gap-1 rounded-md border pl-2.5 text-sm">
              {d}
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${d}`}
                disabled={remove.isPending}
                onClick={() =>
                  confirm({
                    title: `Stop letting in ${d}?`,
                    description: `New sign-ups with an @${d} address wait for an admin again. People already in keep their access.`,
                    action: 'Remove',
                    destructive: true,
                    run: () => {
                      add.reset()
                      remove.mutate(d)
                    }
                  })
                }
              >
                <IconX stroke={1.75} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {confirmDialog}
    </section>
  )
}

// Nothing is emailed yet: the admin sends this link themselves. Signing in with the invited
// address is what lets them in, so the link is just the app.
const inviteLink = () => `${location.origin}/`

function copyInviteLink() {
  navigator.clipboard
    ?.writeText(inviteLink())
    .then(() => toast('Invite link copied', 'success'))
    .catch(() => toast("Couldn't copy. The link is " + inviteLink()))
}

const daysLeft = (invite: Invitation) => {
  const days = Math.max(1, Math.ceil((Date.parse(invite.expiresAt) - Date.now()) / 86_400_000))
  return days === 1 ? 'Expires within a day' : `Expires in ${days} days`
}

// Admins and owners invite an address at a role; it lands active at that role when they sign up.
function InvitesCard({ tiers }: { tiers: MemberTier[] }) {
  const invites = useInvitations()
  const invite = useInvite()
  const revoke = useRevokeInvite()
  const [email, setEmail] = useState('')
  const [tier, setTier] = useState<MemberTier>('member')
  const [confirm, confirmDialog] = useConfirm()
  const error = invite.error ?? revoke.error ?? invites.error
  const items = tiers.map(t => ({ value: t, label: TIER_LABEL[t] }))

  return (
    <section aria-labelledby="invite-people" className="flex flex-col gap-3 rounded-xl bg-background p-4 shadow-xs">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="invite-people" className="flex-1 text-sm font-medium">
          Invite people
        </h2>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={e => {
            e.preventDefault()
            revoke.reset()
            invite.mutate({ email, tier }, { onSuccess: () => setEmail('') })
          }}
        >
          <Input
            type="email"
            className="w-56"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="name@example.com"
            aria-label="Email address to invite"
            aria-invalid={invite.isError || undefined}
            maxLength={320}
          />
          <Select items={items} value={tier} onValueChange={next => next && setTier(next as MemberTier)}>
            <SelectTrigger className="w-32" aria-label="Role for the invite">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map(item => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" variant="outline" disabled={invite.isPending || !email.trim()}>
            Invite
          </Button>
        </form>
      </div>
      {invite.data ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <span className="flex-1">
            Send {invite.data.email} this link. When they sign in with that address they get in as {TIER_LABEL[invite.data.tier].toLowerCase()}.
          </span>
          <Button variant="outline" size="sm" onClick={copyInviteLink}>
            <IconCopy stroke={1.75} />
            Copy invite link
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Anyone you invite gets in at the role you pick when they sign in with that address, whatever its domain. Invites expire after 14 days.
        </p>
      )}
      {invites.data && invites.data.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {invites.data.map(i => (
            <li key={i.id} className="flex items-center gap-3 px-3 py-1.5 text-sm max-md:flex-wrap">
              <span className="min-w-40 flex-1 truncate">{i.email}</span>
              <span className="w-20 text-muted-foreground">{TIER_LABEL[i.tier]}</span>
              <span className="w-36 text-xs text-muted-foreground">{daysLeft(i)}</span>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`Copy invite link for ${i.email}`} title="Copy invite link" onClick={copyInviteLink}>
                <IconCopy stroke={1.75} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Revoke the invite for ${i.email}`}
                title="Revoke invite"
                disabled={revoke.isPending}
                onClick={() =>
                  confirm({
                    title: `Revoke the invite for ${i.email}?`,
                    description: 'If they sign in, they wait for an admin like anyone else.',
                    action: 'Revoke',
                    destructive: true,
                    run: () => {
                      invite.reset()
                      revoke.mutate(i.id)
                    }
                  })
                }
              >
                <IconX stroke={1.75} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}
      {confirmDialog}
    </section>
  )
}

const people = (n: number) => (n === 1 ? '1 person' : `${n} people`)

export function MembersPage() {
  const members = useMembers()
  const departments = useDepartments()
  const remove = useDeleteMember()
  const setMembers = useSetDepartmentMembers()
  const isOwner = members.data?.viewer.tier === 'owner'
  // The Departments tab links here with ?department=<id> to show one department's people.
  const [filter, setFilter] = useState<MemberFilter>(() => ({
    ...NO_FILTER,
    department: new URLSearchParams(location.search).get('department') ?? 'all'
  }))
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [limit, setLimit] = useState(PAGE)
  const [deleting, setDeleting] = useState<Member | null>(null)

  const all = members.data?.members ?? []
  const groups = departments.data ?? []
  const shown = filterMembers(all, groups, filter)
  // Only ticked people the filter still shows: nothing is changed out of sight.
  const chosen = shown.filter(m => selected.has(m.id))
  const waiting = all.filter(m => m.status === 'pending').length
  const set = (change: Partial<MemberFilter>) => {
    setFilter(f => ({ ...f, ...change }))
    setLimit(PAGE)
  }
  const filtered = shown.length !== all.length

  const tick = (id: string, on: boolean) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const assign = (department: Department, on: boolean) =>
    setMembers.mutate(
      { departmentId: department.id, userIds: chosen.map(m => m.id), on },
      {
        onSuccess: () => {
          toast(on ? `Added ${people(chosen.length)} to ${department.name}` : `Removed ${people(chosen.length)} from ${department.name}`, 'success')
          setSelected(new Set())
        }
      }
    )

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        A role decides what someone can do with the shared data, and owners and admins manage people and access. Someone who signs in for the
        first time waits, and sees nothing, until you give them a role, unless you invited them or their email domain is let in.
      </p>

      {members.data && <InvitesCard tiers={members.data.assignableTiers} />}
      <DomainsCard />

      {members.isPending && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      )}
      {members.isError && <p className="text-sm text-destructive">Couldn't load members: {members.error.message}</p>}
      {departments.isError && <p className="text-sm text-destructive">Couldn't load teams: {departments.error.message}</p>}

      {members.data && (
        <>
          <div role="search" aria-label="Find members" className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              className="w-56 bg-background"
              placeholder="Search name or email"
              aria-label="Search name or email"
              value={filter.query}
              onChange={e => set({ query: e.target.value })}
            />
            <FilterSelect
              label="Team"
              value={filter.department}
              onChange={department => set({ department })}
              items={[
                { value: 'all', label: 'All teams' },
                { value: 'none', label: 'No team' },
                ...groups.map(d => ({ value: d.id, label: d.name }))
              ]}
            />
            <FilterSelect
              label="Role"
              value={filter.role}
              onChange={role => set({ role })}
              items={[
                { value: 'all', label: 'All roles' },
                ...(Object.keys(TIER_LABEL) as MemberTier[]).map(tier => ({ value: tier, label: TIER_LABEL[tier] })),
                { value: 'none', label: 'No role yet' }
              ]}
            />
            <FilterSelect
              label="Status"
              value={filter.status}
              onChange={status => set({ status })}
              items={[
                { value: 'all', label: 'Any status' },
                { value: 'active', label: 'Active' },
                { value: 'pending', label: 'Waiting' },
                { value: 'suspended', label: 'Suspended' }
              ]}
            />
            <FilterSelect
              label="Sort"
              value={filter.sort}
              onChange={sort => set({ sort: sort as MemberSort })}
              items={[
                { value: 'joined', label: 'Sort: joined' },
                { value: 'name', label: 'Sort: name' },
                { value: 'role', label: 'Sort: role' },
                ...(isOwner ? [{ value: 'active', label: 'Sort: last active' }] : [])
              ]}
            />
          </div>

          <div className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={shown.length > 0 && chosen.length === shown.length}
                disabled={shown.length === 0}
                onChange={e => setSelected(e.target.checked ? new Set(shown.map(m => m.id)) : new Set())}
              />
              <span className="sr-only">Select all {shown.length} shown</span>
            </label>
            {chosen.length > 0 ? (
              <>
                <span className="font-medium">{chosen.length} selected</span>
                <BulkMenu label="Add to team" departments={groups} disabled={setMembers.isPending} onPick={d => assign(d, true)} />
                <BulkMenu label="Remove from team" departments={groups} disabled={setMembers.isPending} onPick={d => assign(d, false)} />
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </>
            ) : (
              <>
                <span className="text-muted-foreground" aria-live="polite">
                  {filtered ? `${shown.length} of ${people(all.length)}` : people(all.length)}
                </span>
                {waiting > 0 && filter.status !== 'pending' && (
                  <Button variant="outline" size="xs" onClick={() => set({ ...NO_FILTER, status: 'pending' })}>
                    {waiting} waiting for a role
                  </Button>
                )}
                {filtered && (
                  <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => set(NO_FILTER)}>
                    Clear filters
                  </Button>
                )}
              </>
            )}
          </div>

          {shown.length === 0 ? (
            <p className="rounded-xl bg-background px-4 py-6 text-center text-sm text-muted-foreground shadow-xs">Nobody matches.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-xl bg-background shadow-xs">
              {shown.slice(0, limit).map(member => (
                <li key={member.id} className="flex items-center gap-3 px-4 py-2 max-md:flex-wrap">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-primary"
                    aria-label={`Select ${displayName(member)}`}
                    checked={selected.has(member.id)}
                    onChange={e => tick(member.id, e.target.checked)}
                  />
                  {/* Narrow screens: the name gets the first line to itself and the controls wrap under it. */}
                  <div className="flex min-w-40 flex-1 flex-col max-md:min-w-[calc(100%-1.75rem)]">
                    <span className="truncate text-sm font-medium">{displayName(member)}</span>
                    <span className="truncate text-xs text-muted-foreground">{member.position ? `${member.position} · ${member.email}` : member.email}</span>
                  </div>
                  <DepartmentsCell member={member} departments={groups} />
                  <RoleCell member={member} tiers={members.data.assignableTiers} />
                  <div className="w-20 shrink-0">
                    <StatusBadge member={member} />
                  </div>
                  {isOwner && (
                    <div className="w-28 shrink-0 text-right text-xs text-muted-foreground max-md:hidden" title="Last active (visible to owners only)">
                      {formatLastActive(member.lastActiveAt)}
                    </div>
                  )}
                  <div className="w-7 shrink-0 max-md:ml-auto">
                    {!member.locked && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${displayName(member)}`}
                        title="Delete member"
                        disabled={remove.isPending}
                        onClick={() => setDeleting(member)}
                      >
                        <IconTrash stroke={1.75} />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {shown.length > limit && (
            <Button variant="outline" className="self-center" onClick={() => setLimit(l => l + PAGE)}>
              Show {Math.min(PAGE, shown.length - limit)} more
            </Button>
          )}
          {isOwner && <p className="text-xs text-muted-foreground">Last activity is visible to owners only.</p>}
        </>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting ? displayName(deleting) : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              This erases {deleting?.email}'s {APP_NAME} account: their sign-in, role and activity. This can't be undone. If they sign
              in again, they start over and wait for a role. To keep them out, suspend them instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) remove.mutate(deleting.id)
                setDeleting(null)
              }}
            >
              Delete member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

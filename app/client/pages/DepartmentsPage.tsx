// Departments (a tab of People & access): each department with its people and
// the spaces opened to it, next to the spaces shared with everyone. Opening a
// space to a department, or sharing it, writes that space's access rule, the
// same one the Spaces tab edits.
import { IconDots, IconPencil, IconTrash } from '@tabler/icons-react'
import { useState, type FormEvent } from 'react'
import type { Department, Member, SpaceAccessEntry, SpaceAccessResponse } from '../../lib/types'
import { useConfirm } from '../components/ConfirmDialog'
import { Picker } from '../components/Picker'
import { displayName, isShared, limitedAccess, limitWarning, sharedAccess, withDepartment } from '../lib/people'
import {
  useCreateDepartment,
  useDeleteDepartment,
  useDepartments,
  useMembers,
  useRenameDepartment,
  useSetDepartmentMembers,
  useSetSpaceAccess,
  useSpaceAccess
} from '../lib/queries'
import { navigate } from '../lib/router'
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
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'

// Names listed on a card before "and N more".
const NAMES = 12

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function Names({ names, none }: { names: string[]; none: string }) {
  if (names.length === 0) return <span className="text-muted-foreground">{none}</span>
  const more = names.length - NAMES
  return (
    <span>
      {names.slice(0, NAMES).join(', ')}
      {more > 0 && <span className="text-muted-foreground"> and {more} more</span>}
    </span>
  )
}

// One labelled line of a card: what's there on the left, the control that changes it on the right.
function Line({ label, children, action }: { label: string; children: React.ReactNode; action: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm max-md:flex-wrap">
      <span className="w-16 shrink-0 pt-1 text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 pt-0.5">{children}</div>
      {action}
    </div>
  )
}

type CardProps = {
  department: Department
  // Undefined while they load.
  members: Member[] | undefined
  access: SpaceAccessResponse | undefined
  onRename: () => void
  onDelete: () => void
}

function DepartmentCard({ department, members, access, onRename, onDelete }: CardProps) {
  const setMembers = useSetDepartmentMembers()
  const setAccess = useSetSpaceAccess()
  // Counted from the people who still exist, once they have loaded.
  const inIt = members?.filter(m => department.memberIds.includes(m.id))
  const size = inIt?.length ?? department.memberIds.length
  // A shared space is everyone's, so it isn't one of the department's own.
  const limited = access?.spaces.filter(s => !isShared(s, access.tiers)) ?? []
  const own = limited.filter(s => s.departments.includes(department.id))

  return (
    <li className="flex flex-col gap-3 rounded-xl bg-background px-4 py-3 shadow-xs">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{department.name}</h3>
        <span className="text-xs text-muted-foreground">
          {count(size, 'person', 'people')} · {count(own.length, 'space of its own', 'spaces of its own')}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`${department.name} options`} title="Rename or delete" />}>
            <IconDots stroke={1.75} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onRename}>
              <IconPencil stroke={1.75} />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <IconTrash stroke={1.75} />
              Delete team
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Line
        label="People"
        action={
          <Picker
            label={`People in ${department.name}`}
            text="Add or remove"
            empty="Nobody to pick."
            none="Nobody"
            gone="Deleted person"
            // Suspended people stay out of the list unless they are already in.
            options={(members ?? []).filter(m => m.status !== 'suspended' || department.memberIds.includes(m.id)).map(m => ({ id: m.id, label: displayName(m) }))}
            selected={department.memberIds}
            disabled={setMembers.isPending || !members}
            onToggle={(id, on) => setMembers.mutate({ departmentId: department.id, userIds: [id], on })}
          />
        }
      >
        <Names names={(inIt ?? []).map(displayName)} none={members ? 'Nobody yet.' : 'Loading…'} />
        {size > 0 && (
          <Button variant="ghost" size="xs" className="ml-1 text-muted-foreground" onClick={() => navigate(`/members?department=${department.id}`)}>
            Show in Members
          </Button>
        )}
      </Line>
      <Line
        label="Spaces"
        action={
          <Picker
            label={`Spaces opened to ${department.name}`}
            text="Add or remove"
            empty="Every space is shared with everyone. Limit one on the Spaces tab first."
            none="None"
            gone="Unknown space"
            options={limited.map(s => ({ id: s.id, label: s.name }))}
            selected={own.map(s => s.id)}
            disabled={setAccess.isPending || !access}
            onToggle={(id, on) => {
              const space = limited.find(s => s.id === id)
              if (space) setAccess.mutate({ spaceId: id, access: withDepartment(space, department.id, on) })
            }}
          />
        }
      >
        <Names names={own.map(s => s.name)} none={access ? 'Only the shared spaces.' : 'Loading…'} />
        {own.length > 0 && <span className="text-muted-foreground">, plus the shared spaces</span>}
      </Line>
    </li>
  )
}

function SharedCard({ access }: { access: SpaceAccessResponse | undefined }) {
  const setAccess = useSetSpaceAccess()
  const [confirm, confirmDialog] = useConfirm()
  const spaces = access?.spaces ?? []
  const shared = access ? spaces.filter(s => isShared(s, access.tiers)) : []
  const toggle = (space: SpaceAccessEntry, on: boolean) => {
    if (!access) return
    if (on) setAccess.mutate({ spaceId: space.id, access: sharedAccess(access.tiers) })
    else confirm({ ...limitWarning(space.name), run: () => setAccess.mutate({ spaceId: space.id, access: limitedAccess(space) }) })
  }

  return (
    <section aria-labelledby="shared-spaces" className="flex flex-col gap-3 rounded-xl bg-background px-4 py-3 shadow-xs">
      <div className="flex items-center gap-2">
        <h3 id="shared-spaces" className="flex-1 text-sm font-medium">
          Shared with everyone
        </h3>
        <span className="text-xs text-muted-foreground">{count(shared.length, 'space', 'spaces')}</span>
      </div>
      <Line
        label="Spaces"
        action={
          <Picker
            label="Spaces shared with everyone"
            text="Add or remove"
            empty="No spaces."
            none="None"
            gone="Unknown space"
            options={spaces.map(s => ({ id: s.id, label: s.name }))}
            selected={shared.map(s => s.id)}
            disabled={setAccess.isPending || !access}
            onToggle={(id, on) => {
              const space = spaces.find(s => s.id === id)
              if (space) toggle(space, on)
            }}
          />
        }
      >
        <Names names={shared.map(s => s.name)} none={access ? 'No space is shared with everyone.' : 'Loading…'} />
      </Line>
      <p className="text-xs text-muted-foreground">
        Everyone with a role sees these, whatever their team. Take one off the list and only admins and owners see it, until you open it
        to a team.
      </p>
      {confirmDialog}
    </section>
  )
}

export function DepartmentsPage() {
  const departments = useDepartments()
  const members = useMembers()
  const access = useSpaceAccess()
  const create = useCreateDepartment()
  const rename = useRenameDepartment()
  const remove = useDeleteDepartment()
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState<{ department: Department; name: string } | null>(null)
  const [deleting, setDeleting] = useState<Department | null>(null)

  const add = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate(name.trim(), { onSuccess: () => setName('') })
  }

  const grouped = new Set(departments.data?.flatMap(d => d.memberIds))
  const loose = departments.data && members.data ? members.data.members.filter(m => !grouped.has(m.id)).length : 0

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        A team is a group of people with its own spaces. Everyone sees the shared spaces; on top of those, people see the spaces opened
        to the teams they are in. Someone can be in several teams.
      </p>

      {departments.isError && <p className="text-sm text-destructive">Couldn't load teams: {departments.error.message}</p>}
      {members.isError && <p className="text-sm text-destructive">Couldn't load members: {members.error.message}</p>}
      {access.isError && <p className="text-sm text-destructive">Couldn't load spaces: {access.error.message}</p>}

      <SharedCard access={access.data} />

      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex-1 text-sm font-medium">Teams{departments.data ? ` (${departments.data.length})` : ''}</h2>
        <form className="flex gap-2" onSubmit={add}>
          <Input
            className="w-56 bg-background"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="New team"
            maxLength={80}
            aria-label="New team name"
          />
          <Button type="submit" variant="outline" disabled={create.isPending || !name.trim()}>
            Add team
          </Button>
        </form>
      </div>

      {departments.isPending && <Skeleton className="h-24 w-full" />}
      {departments.data?.length === 0 && (
        <p className="rounded-xl bg-background px-4 py-6 text-center text-sm text-muted-foreground shadow-xs">
          No teams yet. Add one, put people in it, then open spaces to it.
        </p>
      )}
      {departments.data && departments.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {departments.data.map(department => (
            <DepartmentCard
              key={department.id}
              department={department}
              members={members.data?.members}
              access={access.data}
              onRename={() => setRenaming({ department, name: department.name })}
              onDelete={() => setDeleting(department)}
            />
          ))}
        </ul>
      )}
      {loose > 0 && (
        <p className="text-sm text-muted-foreground">
          {count(loose, 'person is', 'people are')} in no team and see only the shared spaces.
          <Button variant="ghost" size="xs" className="ml-1 text-muted-foreground" onClick={() => navigate('/members?department=none')}>
            Show in Members
          </Button>
        </p>
      )}

      <Dialog open={renaming !== null} onOpenChange={open => !open && setRenaming(null)}>
        <DialogContent>
          <form
            className="flex flex-col gap-4"
            onSubmit={event => {
              event.preventDefault()
              if (renaming && renaming.name.trim()) rename.mutate({ id: renaming.department.id, name: renaming.name.trim() })
              setRenaming(null)
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename team</DialogTitle>
            </DialogHeader>
            <Input
              value={renaming?.name ?? ''}
              onChange={e => renaming && setRenaming({ ...renaming, name: e.target.value })}
              maxLength={80}
              aria-label="Team name"
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!renaming?.name.trim()}>
                Rename
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={open => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its {deleting?.memberIds.length ?? 0} people leave it, and every space it opened to them stops counting it. They keep any space their
              role or their own name gives them.
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
              Delete team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Settings: Personal (your own account: your name) and Organisation (the workspace name, the app's
// look and the spaces' names and icons, for admins and owners). The look is one for the whole app, not one per space.
import { IconTrash } from '@tabler/icons-react'
import { useEffect, useState, type FormEvent, type MouseEvent } from 'react'
import { APP_NAME } from '../../lib/brand'
import { SYMBOLS } from '../../lib/symbols'
import type { Space, SpaceTheme } from '../../lib/types'
import { hasAtLeast } from '../../vendor/dto-core/tier'
import { ConnectAi } from '../components/ConnectAi'
import { SamplePicker, useSamples } from '../components/SamplePicker'
import { useConfirm } from '../components/ConfirmDialog'
import { ICONS, spaceIcon } from '../lib/icons'
import { useCreateSpace, useDeleteSubspace, useEditSpace, useMe, useOrgSettings, useSaveOrgName, useSaveOrgTheme, useSaveWelcome, useWorkspace } from '../lib/queries'
import { navigate } from '../lib/router'
import { toast } from '../lib/toast'
import { childrenOf, topLevel } from '../lib/subspaces'
import { THEME_OPTIONS } from '../lib/theme'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Skeleton } from '../ui/skeleton'
import { cn } from '../ui/utils'

const label = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
// What applyTheme uses when the organisation hasn't picked one.
const DEFAULTS: Required<SpaceTheme> = { font: 'sans', color: 'default', radius: 'soft' }

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-background p-5 shadow-xs">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm max-sm:flex-col max-sm:items-stretch max-sm:gap-1.5">
      <span className="text-muted-foreground">{title}</span>
      {children}
    </div>
  )
}

function Personal() {
  const me = useMe().data
  // The welcome step's save, with no departments: it only renames (server/welcome.ts checks the name).
  const save = useSaveWelcome()
  const [name, setName] = useState('')
  useEffect(() => setName(me?.name ?? ''), [me?.name])
  const changed = !!name.trim() && name.trim() !== (me?.name ?? '')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!changed || save.isPending) return
    save.mutate({ name: name.trim(), departmentIds: [] }, { onSuccess: () => toast('Name saved.'), onError: error => toast(error.message, 'error') })
  }
  return (
    <Section title="Your account" description="Your name is what the team sees. Your email and picture come from how you sign in.">
      <div className="flex items-center gap-4">
        {me?.avatarUrl ? (
          <img src={me.avatarUrl} alt="" className="size-14 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="flex size-14 items-center justify-center rounded-full bg-accent text-lg font-medium uppercase">
            {(me?.name ?? me?.email ?? '?').slice(0, 1)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">Profile picture</span>
      </div>
      <form onSubmit={submit} className="contents">
        <Field title="Name">
          <div className="flex gap-2">
            <Input aria-label="Name" value={name} onChange={event => setName(event.target.value)} maxLength={80} autoComplete="name" placeholder="Your name" />
            <Button type="submit" size="sm" disabled={!changed || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Field>
      </form>
      <Field title="Email">
        <span className="truncate">{me?.email ?? '—'}</span>
      </Field>
    </Section>
  )
}

function WorkspaceName() {
  const settings = useOrgSettings()
  const save = useSaveOrgName()
  const [name, setName] = useState('')
  const saved = settings.data?.name ?? ''
  useEffect(() => setName(saved), [saved])
  const trimmed = name.trim()
  return (
    <Section title="Workspace name" description={`Shown at the top of the sidebar for everyone. Leave it empty to show ${APP_NAME}.`}>
      {settings.isPending ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <form
          className="flex items-center gap-2"
          onSubmit={event => {
            event.preventDefault()
            save.mutate(trimmed || null)
          }}
        >
          <Input value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder={APP_NAME} aria-label="Workspace name" className="flex-1" />
          <Button type="submit" size="sm" disabled={trimmed === saved || save.isPending}>
            Save
          </Button>
        </form>
      )}
    </Section>
  )
}

function Appearance() {
  const settings = useOrgSettings()
  const save = useSaveOrgTheme()
  const [theme, setTheme] = useState<SpaceTheme>({})
  useEffect(() => {
    if (settings.data) setTheme(settings.data.theme)
  }, [settings.data])
  const changed = (['font', 'color', 'radius'] as const).some(key => (theme[key] ?? DEFAULTS[key]) !== (settings.data?.theme[key] ?? DEFAULTS[key]))

  const select = (key: 'font' | 'color' | 'radius', title: string) => (
    <Field title={title}>
      <Select value={theme[key] ?? DEFAULTS[key]} onValueChange={value => setTheme(t => ({ ...t, [key]: value as string }))}>
        <SelectTrigger className="w-44 max-sm:w-full" aria-label={title}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {THEME_OPTIONS[key].map(option => (
            <SelectItem key={option} value={option}>
              {label(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )

  return (
    <Section title="Appearance" description="One look for the whole app. Everyone sees it on every space.">
      {settings.isPending ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={event => {
            event.preventDefault()
            save.mutate(theme)
          }}
        >
          {select('font', 'Font')}
          {select('color', 'Color')}
          {select('radius', 'Corners')}
          <div className="flex justify-end">
            <Button type="submit" disabled={!changed || save.isPending}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Section>
  )
}

// The space's icon: a grid of symbols, and back to the default once one is picked.
function SymbolPicker({ space, symbol, onPick }: { space: Pick<Space, 'name' | 'folder'>; symbol: string | null; onPick: (symbol: string | null) => void }) {
  const Current = spaceIcon({ folder: space.folder, symbol })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button type="button" variant="outline" size="icon-sm" aria-label={`Icon of ${space.name}`} title="Pick an icon" />}
      >
        <Current stroke={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="grid w-auto grid-cols-8 gap-0.5">
        {SYMBOLS.map(id => {
          const Icon = ICONS[id]
          return (
            <DropdownMenuItem
              key={id}
              aria-label={label(id)}
              title={label(id)}
              onClick={() => onPick(id)}
              className={cn('justify-center p-1.5', id === symbol && 'bg-accent text-accent-foreground')}
            >
              <Icon stroke={1.75} />
            </DropdownMenuItem>
          )
        })}
        {symbol && (
          <DropdownMenuItem onClick={() => onPick(null)} className="col-span-8 justify-center text-muted-foreground">
            Use the default icon
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SpaceName({ space, onDelete }: { space: Space; onDelete?: () => void }) {
  const edit = useEditSpace()
  const [name, setName] = useState(space.name)
  const [symbol, setSymbol] = useState(space.symbol)
  useEffect(() => setName(space.name), [space.name])
  useEffect(() => setSymbol(space.symbol), [space.symbol])
  const trimmed = name.trim()
  const nameChanged = trimmed !== space.name
  const symbolChanged = symbol !== space.symbol
  return (
    <form
      className={cn('flex items-center gap-2', space.parentId && 'pl-6')}
      onSubmit={event => {
        event.preventDefault()
        if (!trimmed || !(nameChanged || symbolChanged)) return
        edit.mutate({ spaceId: space.id, ...(nameChanged && { name: trimmed }), ...(symbolChanged && { symbol }) })
      }}
    >
      <SymbolPicker space={space} symbol={symbol} onPick={setSymbol} />
      <Input value={name} onChange={event => setName(event.target.value)} maxLength={80} required aria-label={`Name of ${space.name}`} className="flex-1" />
      <Button type="submit" variant="outline" size="sm" disabled={!trimmed || !(nameChanged || symbolChanged)}>
        Save
      </Button>
      {onDelete && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${space.name}`} title="Delete subspace" onClick={onDelete}>
          <IconTrash stroke={1.75} className="text-destructive" />
        </Button>
      )}
    </form>
  )
}

// A new top-level space: only a name and an icon, no code of its own. Its tabs hold views from any
// space, and it gets subspaces like the others.
function AddSpace() {
  const create = useCreateSpace()
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState<string | null>(null)
  const trimmed = name.trim()
  return (
    <form
      className="flex items-center gap-2 border-t pt-4"
      onSubmit={event => {
        event.preventDefault()
        if (!trimmed) return
        create.mutate(
          { name: trimmed, symbol },
          {
            onSuccess: () => {
              toast(`Added ${trimmed} to the sidebar`, 'success')
              setName('')
              setSymbol(null)
            }
          }
        )
      }}
    >
      <SymbolPicker space={{ name: trimmed || 'the new space', folder: null }} symbol={symbol} onPick={setSymbol} />
      <Input value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="New space name" aria-label="Name of the new space" className="flex-1" />
      <Button type="submit" size="sm" disabled={!trimmed || create.isPending}>
        Add space
      </Button>
    </form>
  )
}

function Spaces() {
  const spaces = useWorkspace().data?.spaces ?? []
  const deleteSubspace = useDeleteSubspace()
  const [confirm, confirmDialog] = useConfirm()
  return (
    <Section title="Spaces" description="Names and icons everyone sees in the sidebar, and new spaces. Subspaces show for owners only.">
      <div className="flex flex-col gap-2">
        {topLevel(spaces).map(space => (
          <div key={space.id} className="flex flex-col gap-2">
            <SpaceName space={space} />
            {childrenOf(spaces, space.id).map(sub => (
              <SpaceName
                key={sub.id}
                space={sub}
                onDelete={() =>
                  confirm({
                    title: `Delete ${sub.name}?`,
                    description: `Its tabs and widget layout are deleted. Shared data its views saved stays with ${space.name}.`,
                    action: 'Delete subspace',
                    destructive: true,
                    run: () => deleteSubspace.mutate({ spaceId: sub.id, parentId: space.id })
                  })
                }
              />
            ))}
          </div>
        ))}
      </div>
      <AddSpace />
      {confirmDialog}
    </Section>
  )
}

// Only where the app can add spaces itself (the self-hosted install): elsewhere nothing shows.
function SampleSpaces() {
  const samples = useSamples()
  if (!samples.data?.available) return null
  return (
    <Section title="Templates" description="Starter spaces for common kinds of work, each with example rows. They become your company's own spaces.">
      <SamplePicker />
    </Section>
  )
}

export function SettingsPage({ tab }: { tab: 'personal' | 'organisation' }) {
  const me = useMe()
  const isAdmin = hasAtLeast(me.data?.tier ?? null, me.data?.status ?? null, 'admin')
  const tabs = [
    { id: 'personal', label: 'Personal', path: '/settings' },
    ...(isAdmin ? [{ id: 'organisation', label: 'Organisation', path: '/settings/organisation' }] : [])
  ]
  // Real links, so they can be opened in a new tab; a plain click stays in the app.
  const go = (path: string) => (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    navigate(path)
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 max-md:p-4">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Settings</h1>
        <nav aria-label="Settings" className="flex gap-1 border-b">
          {tabs.map(t => (
            <a
              key={t.id}
              href={t.path}
              onClick={go(t.path)}
              aria-current={t.id === tab ? 'page' : undefined}
              className={cn(
                '-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                t.id === tab ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
            </a>
          ))}
        </nav>
      </header>
      {me.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : tab === 'personal' ? (
        <>
          <Personal />
          <ConnectAi />
        </>
      ) : isAdmin ? (
        <>
          <WorkspaceName />
          <Appearance />
          <Spaces />
          <SampleSpaces />
        </>
      ) : (
        <div className="flex flex-col items-center gap-1 p-6 text-center text-sm">
          <p className="font-medium">Organisation settings are for admins and owners.</p>
          <p className="text-muted-foreground">Ask an admin to change the look of the app or the name of a space.</p>
        </div>
      )}
    </div>
  )
}

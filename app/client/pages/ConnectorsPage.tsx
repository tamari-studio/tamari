// Connectors: the keys spaces need to reach outside services. Each is set up
// once for the whole workspace and reaches every space, including spaces added
// later, until a space is turned off for it.
import {
  IconAlertTriangle,
  IconBraces,
  IconBrandAirtable,
  IconBrandGmail,
  IconBrandGoogleDrive,
  IconBrandSupabase,
  IconCircleCheck,
  IconExternalLink,
  IconPlug,
  IconSearch,
  IconTicket,
  type Icon
} from '@tabler/icons-react'
import { useId, useRef, useState, type ReactNode } from 'react'
import {
  CONNECTOR_KINDS,
  connectorStatus,
  fieldLabel,
  isConnectorEnabledForSpace,
  nextDisabledSpaceIds,
  providedEnvNames,
  reachLabel,
  secretKeysFor
} from '../../lib/connectors'
import type { Connector, ConnectorConfig, ConnectorKind, Space } from '../../lib/types'
import { hasAtLeast } from '../../vendor/dto-core/tier'
import { useConnectors, useCreateConnector, useDeleteConnector, useMe, useUpdateConnector, useWorkspace } from '../lib/queries'
import { topLevel } from '../lib/subspaces'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { APP_NAME } from '../../lib/brand'

const KIND_ICONS: Record<ConnectorKind, Icon> = {
  supabase: IconBrandSupabase,
  airtable: IconBrandAirtable,
  tito: IconTicket,
  gmail: IconBrandGmail,
  'google-drive': IconBrandGoogleDrive,
  custom: IconBraces
}

// Offered in the gallery. Google Drive gives spaces nothing yet, and custom sits behind its own link.
const GALLERY_KINDS: ConnectorKind[] = ['airtable', 'tito', 'gmail', 'supabase']

// Search shows up once there is enough to search through.
const SEARCH_FROM = 7

const SECRET_NOTE =
  `Saved values are kept encrypted and never shown again, not even to admins. ${APP_NAME} can't test a value for you: if a space still shows an error afterwards, the value is probably wrong.`

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// Keeps the last open value on screen while its dialog animates shut.
function useLast<T>(value: T | null): T | null {
  const last = useRef(value)
  if (value !== null) last.current = value
  return last.current
}

export function ConnectorsPage() {
  const connectors = useConnectors()
  const workspace = useWorkspace()
  // A subspace runs its views as its parent, so it has no connector settings of its own.
  const spaces = topLevel(workspace.data?.spaces ?? [])
  const [query, setQuery] = useState('')
  const [connecting, setConnecting] = useState<ConnectorKind | null>(null)
  const [managingId, setManagingId] = useState<string | null>(null)
  // Everyone sees the connectors; only admins and owners change them (the API refuses anyone else).
  const me = useMe()
  const canEdit = hasAtLeast(me.data?.tier ?? null, me.data?.status ?? null, 'admin')

  const all = connectors.data ?? []
  const connectedKinds = new Set(all.map(c => c.kind))
  // Each Gmail mailbox gets its own names, so a second one is fine. A second connector of
  // another kind would only fight the first over the same name, so it isn't offered.
  const available = GALLERY_KINDS.filter(kind => kind === 'gmail' || !connectedKinds.has(kind))
  const needle = query.trim().toLowerCase()
  const matches = (...texts: string[]) => !needle || texts.some(text => text.toLowerCase().includes(needle))
  const shownConnected = all.filter(c => matches(c.name, CONNECTOR_KINDS[c.kind].label))
  const shownAvailable = available.filter(kind => matches(CONNECTOR_KINDS[kind].label, CONNECTOR_KINDS[kind].description))
  const managing = all.find(c => c.id === managingId) ?? null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 max-md:p-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-medium tracking-[-0.02em]">Connectors</h1>
        <p className="text-sm text-muted-foreground">
          Connect the outside services your spaces work with, such as Airtable or Tito. A service is connected once for the
          whole workspace: every space can then use it.
        </p>
        {me.data && !canEdit && (
          <p className="text-sm text-muted-foreground">You can see what is connected. Admins and owners connect and change services.</p>
        )}
      </header>

      {connectors.isPending && (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true" aria-label="Loading connectors">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}
      {connectors.isError && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load connectors: {connectors.error.message}
        </p>
      )}

      {connectors.data && (
        <>
          {all.length + available.length >= SEARCH_FROM && (
            <div className="relative">
              <IconSearch size={16} stroke={1.75} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                aria-label="Search connectors"
                placeholder="Search connectors"
                className="pl-8"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
          )}

          <section aria-labelledby="connectors-connected" className="flex flex-col gap-3">
            <h2 id="connectors-connected" className="text-sm font-medium">
              In this workspace
            </h2>
            {all.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl bg-background p-8 text-center text-sm text-muted-foreground shadow-xs">
                <IconPlug size={24} stroke={1.5} aria-hidden />
                <p>
                  {canEdit
                    ? 'Nothing is connected yet. Pick a service below to connect it for every space.'
                    : 'Nothing is connected yet. An admin or owner can connect a service here.'}
                </p>
              </div>
            ) : shownConnected.length === 0 ? (
              <p className="text-sm text-muted-foreground">No connected service matches "{query.trim()}".</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {shownConnected.map(connector => {
                  const status = connectorStatus(connector)
                  return (
                    <ConnectorCard
                      key={connector.id}
                      kind={connector.kind}
                      title={connector.name}
                      badge={<StatusBadge state={status.state} label={status.label} />}
                      note={`Available in: ${reachLabel(connector, spaces.map(s => s.id)).toLowerCase()}`}
                      action={
                        <Button variant="outline" size="sm" aria-label={`${canEdit ? 'Manage' : 'View'} ${connector.name}`} onClick={() => setManagingId(connector.id)}>
                          {canEdit ? 'Manage' : 'View'}
                        </Button>
                      }
                    />
                  )
                })}
              </ul>
            )}
          </section>

          {shownAvailable.length > 0 && (
            <section aria-labelledby="connectors-available" className="flex flex-col gap-3">
              <h2 id="connectors-available" className="text-sm font-medium">
                Available to connect
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {shownAvailable.map(kind => (
                  <ConnectorCard
                    key={kind}
                    kind={kind}
                    title={CONNECTOR_KINDS[kind].label}
                    note={connectedKinds.has(kind) ? 'Connect another mailbox.' : undefined}
                    action={
                      canEdit && (
                        <Button size="sm" aria-label={`Connect ${CONNECTOR_KINDS[kind].label}`} onClick={() => setConnecting(kind)}>
                          Connect
                        </Button>
                      )
                    }
                  />
                ))}
              </ul>
            </section>
          )}

          {canEdit && (
            <p className="text-sm text-muted-foreground">
              Need a service that isn't listed?{' '}
              <button type="button" className="rounded-sm underline underline-offset-3 outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => setConnecting('custom')}>
                Add a custom connector
              </button>
              .
            </p>
          )}
        </>
      )}

      <ConnectDialog kind={connecting} onClose={() => setConnecting(null)} />
      <ManageDialog connector={managing} spaces={spaces} canEdit={canEdit} onClose={() => setManagingId(null)} />
    </div>
  )
}

function StatusBadge({ state, label }: { state: 'connected' | 'attention' | 'inactive'; label: string }) {
  if (state === 'connected') {
    return (
      <Badge className="bg-success/10 text-success">
        <IconCircleCheck aria-hidden />
        {label}
      </Badge>
    )
  }
  if (state === 'attention') {
    return (
      <Badge variant="destructive">
        <IconAlertTriangle aria-hidden />
        {label}
      </Badge>
    )
  }
  return <Badge variant="secondary">{label}</Badge>
}

function KindIcon({ kind }: { kind: ConnectorKind }) {
  const KindSvg = KIND_ICONS[kind]
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground" aria-hidden>
      <KindSvg size={20} stroke={1.5} />
    </span>
  )
}

function ConnectorCard({ kind, title, badge, note, action }: { kind: ConnectorKind; title: string; badge?: ReactNode; note?: string; action: ReactNode }) {
  const info = CONNECTOR_KINDS[kind]
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-background p-4 shadow-xs">
      <div className="flex items-start gap-3">
        <KindIcon kind={kind} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="truncate text-sm font-medium">{title}</h3>
          {title !== info.label && <p className="text-xs text-muted-foreground">{info.label}</p>}
        </div>
        {badge}
      </div>
      <p className="text-sm text-muted-foreground">{info.description}</p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{note}</span>
        {action}
      </div>
    </li>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: (ids: { id: string; 'aria-describedby'?: string }) => ReactNode }) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <label htmlFor={id} className="text-muted-foreground">
        {label}
      </label>
      {children({ id, 'aria-describedby': hint ? hintId : undefined })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

function KindHelp({ kind }: { kind: ConnectorKind }) {
  const info = CONNECTOR_KINDS[kind]
  if (!info.help) return null
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-accent p-3 text-sm">
      <p className="font-medium">Where to find {info.secretKeys.length + (info.needsUrl ? 1 : 0) > 1 ? 'these' : 'it'}</p>
      <p className="text-muted-foreground">{info.help}</p>
      {info.helpUrl && (
        <a href={info.helpUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 underline underline-offset-3">
          Open {info.label}
          <IconExternalLink size={14} stroke={1.75} aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </div>
  )
}

// The settings one connector stores, for the connect and the manage forms. Values typed
// here live only in this component: they are sent once and gone when the dialog closes.
function useConnectorForm(kind: ConnectorKind, existing: Connector | null) {
  const [name, setName] = useState(existing?.name ?? '')
  const [url, setUrl] = useState(existing?.config.url ?? '')
  const [envKeys, setEnvKeys] = useState((existing?.config.envKeys ?? []).join(', '))
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const config: ConnectorConfig = {
    ...(CONNECTOR_KINDS[kind].needsUrl ? { url } : {}),
    ...(kind === 'custom' ? { envKeys: envKeys.split(/[\s,]+/).filter(Boolean) } : {})
  }
  const keys = secretKeysFor(kind, config)
  // Only the fields on screen: a value typed for a renamed key would be refused.
  const filled = Object.fromEntries(Object.entries(secrets).filter(([k, v]) => keys.includes(k) && v.trim() !== ''))

  const fields = (
    <>
      {(existing || kind === 'gmail' || kind === 'custom') && (
        <Field
          label={kind === 'gmail' ? 'Mailbox name' : 'Name'}
          hint={
            kind === 'gmail' && !existing?.config.connectedAccount
              ? 'The part of the address before the @, for example "partners". Spaces find the mailbox by this name, so changing it later can break them.'
              : undefined
          }
        >
          {ids => <Input {...ids} value={name} required onChange={e => setName(e.target.value)} />}
        </Field>
      )}
      {CONNECTOR_KINDS[kind].needsUrl && (
        <Field label="Project URL">
          {ids => <Input {...ids} type="url" value={url} placeholder="https://….supabase.co" required onChange={e => setUrl(e.target.value)} />}
        </Field>
      )}
      {kind === 'custom' && (
        <Field label="Value names" hint="The names the space's code asks for, in capitals, separated by commas. A field for each value appears below.">
          {ids => <Input {...ids} value={envKeys} placeholder="BRELLA_TOKEN, HUBSPOT_KEY" required onChange={e => setEnvKeys(e.target.value)} />}
        </Field>
      )}
      {keys.map(key => {
        const stored = existing?.setKeys.includes(key) ?? false
        return (
          <Field key={key} label={fieldLabel(kind, key)} hint={stored ? 'A value is saved. Leave this empty to keep it, or paste a new one to replace it.' : undefined}>
            {ids => (
              <Input
                {...ids}
                type="password"
                autoComplete="off"
                value={secrets[key] ?? ''}
                required={!existing}
                placeholder={stored ? 'Saved' : 'Paste it here'}
                onChange={e => setSecrets(s => ({ ...s, [key]: e.target.value }))}
              />
            )}
          </Field>
        )
      })}
    </>
  )
  return { name, config, filled, fields }
}

function ConnectDialog({ kind, onClose }: { kind: ConnectorKind | null; onClose: () => void }) {
  const shown = useLast(kind)
  return (
    <Dialog open={kind !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">{shown && <ConnectForm kind={shown} onClose={onClose} />}</DialogContent>
    </Dialog>
  )
}

function ConnectForm({ kind, onClose }: { kind: ConnectorKind; onClose: () => void }) {
  const create = useCreateConnector()
  const form = useConnectorForm(kind, null)
  const [error, setError] = useState<string | null>(null)
  const info = CONNECTOR_KINDS[kind]

  const submit = async () => {
    setError(null)
    const name = form.name.trim() || info.label
    try {
      await create.mutateAsync({ kind, name, config: form.config, secrets: form.filled })
      toast(`${name} is connected. Every space can use it now.`, 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <KindIcon kind={kind} />
          {kind === 'custom' ? 'Add a custom connector' : `Connect ${info.label}`}
        </DialogTitle>
        <DialogDescription>{info.description} It is on in every space until you turn a space off.</DialogDescription>
      </DialogHeader>
      <form
        className="flex flex-col gap-3"
        onSubmit={event => {
          event.preventDefault()
          void submit()
        }}
      >
        <KindHelp kind={kind} />
        {form.fields}
        <p className="text-xs text-muted-foreground">{SECRET_NOTE}</p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Not connected: {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Connecting…' : 'Connect'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function ManageDialog({ connector, spaces, canEdit, onClose }: { connector: Connector | null; spaces: Space[]; canEdit: boolean; onClose: () => void }) {
  const shown = useLast(connector)
  return (
    <Dialog open={connector !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        {shown && <ManagePanel connector={shown} spaces={spaces} canEdit={canEdit} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function ManagePanel({ connector, spaces, canEdit, onClose }: { connector: Connector; spaces: Space[]; canEdit: boolean; onClose: () => void }) {
  const update = useUpdateConnector()
  const remove = useDeleteConnector()
  const form = useConnectorForm(connector.kind, connector)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const info = CONNECTOR_KINDS[connector.kind]
  const status = connectorStatus(connector)
  const envNames = providedEnvNames(connector)
  const missing = status.missing.map(key => fieldLabel(connector.kind, key)).join(', ')

  const save = async () => {
    setError(null)
    try {
      await update.mutateAsync({ id: connector.id, patch: { name: form.name, config: form.config, secrets: form.filled } })
      toast(`${form.name.trim() || connector.name} is saved.`, 'success')
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3 pr-8">
          <KindIcon kind={connector.kind} />
          <span className="min-w-0 truncate">{connector.name}</span>
          <StatusBadge state={status.state} label={status.label} />
        </DialogTitle>
        <DialogDescription>{info.description}</DialogDescription>
      </DialogHeader>

      {status.state === 'attention' && (
        <p role="status" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          Missing: {missing}.{' '}
          {connector.kind === 'gmail' ? "Spaces can't use this mailbox until all three values are saved. " : ''}
          {canEdit ? 'Add it under Settings below.' : 'Ask an admin or owner to add it.'}
        </p>
      )}

      <section aria-labelledby="connector-spaces" className="flex flex-col gap-2">
        <h3 id="connector-spaces" className="text-sm font-medium">
          Where it can be used
        </h3>
        <p className="text-xs text-muted-foreground">
          {canEdit
            ? "On in every space, new ones included. Turn it off for a space that shouldn't use it."
            : 'On in every space, new ones included, unless an admin or owner turned a space off.'}
        </p>
        <ul className="flex flex-col">
          {spaces.map(space => {
            const enabled = isConnectorEnabledForSpace(connector, space.id)
            return (
              <li key={space.id}>
                {canEdit ? (
                  <label className="flex h-8 items-center justify-between gap-2 rounded-md px-1 text-sm hover:bg-accent">
                    <span className="truncate">{space.name}</span>
                    <Switch
                      checked={enabled}
                      onCheckedChange={next =>
                        update.mutate({ id: connector.id, patch: { disabledSpaceIds: nextDisabledSpaceIds(connector, space.id, next) } })
                      }
                    />
                  </label>
                ) : (
                  <div className="flex h-8 items-center justify-between gap-2 px-1 text-sm">
                    <span className="truncate">{space.name}</span>
                    <span className="text-xs text-muted-foreground">{enabled ? 'On' : 'Off'}</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground">
        Connected on {formatDay(connector.createdAt)}
        {formatDay(connector.updatedAt) !== formatDay(connector.createdAt) && `, last changed on ${formatDay(connector.updatedAt)}`}.
      </p>

      {envNames.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">For developers</summary>
          <p className="pt-2">
            Space code reads {envNames.length === 1 ? 'this value' : 'these values'} as{' '}
            {envNames.map((envName, i) => (
              <span key={envName}>
                {i > 0 && ', '}
                <code className="font-mono">{envName}</code>
              </span>
            ))}
            . A value the hosting already sets under the same name wins over the connector.
          </p>
        </details>
      )}

      {canEdit && (
        <form
          aria-labelledby="connector-settings"
          className="flex flex-col gap-3 border-t pt-4"
          onSubmit={event => {
            event.preventDefault()
            void save()
          }}
        >
          <h3 id="connector-settings" className="text-sm font-medium">
            Settings
          </h3>
          {form.fields}
          {secretKeysFor(connector.kind, form.config).length > 0 && <p className="text-xs text-muted-foreground">{SECRET_NOTE}</p>}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              Not saved: {error}
            </p>
          )}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="destructive" onClick={() => setConfirming(true)}>
              Disconnect
            </Button>
            <Button type="submit" disabled={update.isPending}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {connector.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Every space stops being able to use it, and the saved values are deleted. This can't be undone: to use it again
              you connect it from scratch.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                remove.mutate(connector.id, { onSuccess: () => toast(`${connector.name} is disconnected.`, 'success') })
                setConfirming(false)
                onClose()
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

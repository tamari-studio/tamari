// Loads one view or widget module from this build and renders it. Every
// applet gets its own error boundary: a view that can't reach local-only data
// (a SQLite file on someone's Mac) fails on its own, not the whole space.
import { IconAlertTriangle, IconRefresh } from '@tabler/icons-react'
import { Component, memo, useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { appletAccess } from '../lib/drafts'
import { useCatalog, useManifest, useMe } from '../lib/queries'
import { isStaleBuildError, reloadOnceForNewBuild } from '../lib/stale-build'
import { hideApplet, showApplet } from '../runtime/session'
import { Button } from '../ui/button'
import { Skeleton } from '../ui/skeleton'
import { APP_NAME } from '../../lib/brand'

type LoadedAppletProps = { params?: Record<string, unknown> | null }
type AppletComponent = ComponentType<LoadedAppletProps>

const modules = new Map<string, Promise<AppletComponent>>()
const EMPTY_PARAMS: Record<string, unknown> = {}

const stylesheets = new Map<string, Promise<void>>()

// An applet's own stylesheet (manifest.moduleCss), added once. Resolves when it has loaded, or
// failed: a missing stylesheet shouldn't keep the view from rendering.
function loadStylesheet(href: string): Promise<void> {
  let pending = stylesheets.get(href)
  if (!pending) {
    pending = new Promise(resolve => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      link.onload = link.onerror = () => resolve()
      document.head.appendChild(link)
    })
    stylesheets.set(href, pending)
  }
  return pending
}

// Memoised, so a workspace refetch or Realtime event re-renders a view only when its params change.
function loadModule(url: string, css: string | undefined): Promise<AppletComponent> {
  let pending = modules.get(url)
  if (!pending) {
    pending = Promise.all([import(/* @vite-ignore */ url), css ? loadStylesheet(css) : undefined]).then(
      ([mod]: [{ default?: AppletComponent }, unknown]) => {
        if (typeof mod.default !== 'function') throw new Error('This module has no default export to render.')
        return memo(mod.default)
      }
    )
    pending.catch(() => modules.delete(url))
    modules.set(url, pending)
  }
  return pending
}

type BoundaryProps = { name: string; children: ReactNode; compact?: boolean }
type BoundaryState = { error: Error | null }

class AppletBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <AppletError
        compact={this.props.compact}
        title={`${this.props.name} stopped working`}
        message={this.state.error.message}
        onRetry={() => this.setState({ error: null })}
      />
    )
  }
}

function AppletError({ title, message, onRetry, compact, noReload }: { title: string; message: string; onRetry?: () => void; compact?: boolean; noReload?: boolean }) {
  return (
    <div className={compact ? 'flex h-full flex-col gap-1.5 overflow-auto p-3 text-xs' : 'mx-auto flex max-w-lg flex-col items-start gap-2 p-8 text-sm'}>
      <div className="flex items-center gap-1.5 font-medium text-destructive">
        <IconAlertTriangle size={compact ? 12 : 16} stroke={1.75} />
        {title}
      </div>
      <p className="break-words whitespace-pre-wrap text-muted-foreground">{message}</p>
      <div className="flex flex-wrap gap-2">
        {onRetry && (
          <Button variant="outline" size={compact ? 'xs' : 'sm'} onClick={onRetry}>
            <IconRefresh stroke={1.75} />
            Try again
          </Button>
        )}
        {!noReload && (
          <Button variant="outline" size={compact ? 'xs' : 'sm'} onClick={() => window.location.reload()}>
            <IconRefresh stroke={1.75} />
            Reload the page
          </Button>
        )}
      </div>
    </div>
  )
}

type AppletProps = {
  kind: 'view' | 'widget'
  refId: string
  name: string
  // The space showing this applet: its server function calls run as it.
  spaceId: string
  params?: Record<string, unknown> | null
  compact?: boolean
}

export function Applet({ kind, refId, name, spaceId, params, compact }: AppletProps) {
  const manifest = useManifest()
  const folder = refId.split('/')[0] ?? ''
  const token = useRef(Symbol(refId)).current
  // Registered during render so calls from the applet's first effects already
  // name this space; the effect re-registers after a StrictMode remount.
  showApplet(token, spaceId, folder)
  useEffect(() => {
    showApplet(token, spaceId, folder)
    return () => hideApplet(token)
  }, [token, spaceId, folder])
  // Someone else's draft runs nowhere but its own space, after DraftGate (lib/drafts.ts).
  const access = appletAccess(folder, spaceId, useCatalog().data, useMe().data?.id)
  const url = access === 'run' ? manifest.data?.modules[`${kind}:${refId}`] : undefined
  const css = manifest.data?.moduleCss?.[`${kind}:${refId}`]
  const [state, setState] = useState<{ url: string; Component?: AppletComponent; error?: Error } | null>(null)

  useEffect(() => {
    if (!url) return
    let alive = true
    loadModule(url, css).then(
      Component => alive && setState({ url, Component }),
      (error: Error) => {
        if (!alive) return
        // This page predates the latest deploy and its view file is gone. Reload to get the new
        // build; if that doesn't help, the error below says so.
        if (isStaleBuildError(error) && reloadOnceForNewBuild()) return
        setState({ url, error })
      }
    )
    return () => {
      alive = false
    }
  }, [url, css])

  if (access === 'others-draft') {
    return (
      <AppletError
        compact={compact}
        noReload
        title={`${name} is from a member's draft`}
        message="Nobody has reviewed its code yet, so it runs only inside its own draft space, once you choose to open it there."
      />
    )
  }
  if (access === 'unknown') {
    return <AppletError compact={compact} noReload title={`${name} isn't available here`} message="It isn't part of a space you can see. Close this tab or pick another view." />
  }
  if (manifest.isError) {
    return <AppletError compact={compact} title={`${name} couldn't load`} message={manifest.error.message} />
  }
  if (manifest.isSuccess && !url && access === 'run') {
    return <AppletError compact={compact} title={`${name} isn't in this build`} message="It was removed or renamed. Close this tab or pick another view." />
  }
  if (!state || state.url !== url) {
    return compact ? <Skeleton className="size-full rounded-none" /> : <div className="p-8"><Skeleton className="h-40 w-full" /></div>
  }
  if (state.error) {
    const message = isStaleBuildError(state.error)
      ? `${APP_NAME} was updated since this page was opened. Reload the page to get the new version.`
      : state.error.message
    return <AppletError compact={compact} title={`${name} couldn't load`} message={message} />
  }
  const Loaded = state.Component!
  return (
    <div data-applet={`${kind}:${refId}`} className="contents">
      <AppletBoundary name={name} compact={compact}>
        <Loaded params={params ?? EMPTY_PARAMS} />
      </AppletBoundary>
    </div>
  )
}

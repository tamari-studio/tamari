import { createClient, type Session } from '@supabase/supabase-js'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ClientConfig } from '../lib/types'
import { App } from './App'
import { LoginScreen } from './components/LoginScreen'
import { WaitingScreen } from './components/WaitingScreen'
import { HttpError } from './lib/http'
import { catalogQuery, keys, manifestQuery, meQuery, workspaceQuery } from './lib/queries'
import { installScrollbars } from './lib/scrollbars'
import { loadBrandFonts } from './lib/theme'
import { CODE_NOT_EXCHANGED, LINK_USED, linkNotice, withoutLinkParams } from './lib/sign-in'
import { Toaster } from './lib/toast'
import { getSupabase, setSupabase } from './runtime/session'
import { TooltipProvider } from './ui/tooltip'
import { APP_NAME } from '../lib/brand'

// No refetch on window focus by default: the workspace opts back in (queries.ts), and every other
// shell query refetches when its page mounts after 30 s.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof HttpError && (error.status === 401 || error.status === 403)) && count < 2
    }
  }
})

// Views stream media through fileUrl() with plain <img>/<video> tags, which
// can't send a Bearer header — so the token also rides in a path-scoped cookie.
function mirrorTokenCookie(session: Session | null): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = session
    ? `miso_token=${session.access_token}; Path=/api/files; SameSite=Lax; Max-Age=3600${secure}`
    : `miso_token=; Path=/api/files; Max-Age=0${secure}`
}

// Everything the first screen waits for, requested together instead of one after another
// (me, then the workspace once App mounts, then the manifest once a view mounts).
function prefetchSignedIn(): void {
  void queryClient.prefetchQuery(meQuery)
  void queryClient.prefetchQuery(workspaceQuery)
  void queryClient.prefetchQuery(catalogQuery)
}

const EXPIRED = 'Your session expired. Sign in again.'

// A session the server no longer accepts is dropped, or every query keeps failing on a blank
// screen. Root keeps the notice, since signing out unmounts this. An account the workspace hasn't
// let in (403: waiting for approval, or suspended) stays signed in on a waiting screen instead.
function Gate({ email, onRefused }: { email: string | undefined; onRefused: (notice: string) => void }) {
  const me = useQuery(meQuery)
  const status = me.error instanceof HttpError ? me.error.status : undefined
  useEffect(() => {
    if (status === 401) onRefused(EXPIRED)
  }, [status, onRefused])
  if (status === 403) {
    // The workspace and catalog were refused too while waiting: drop them, so the app starts from a
    // fresh load once /api/me lets the person in, instead of flashing "Couldn't load the workspace".
    const check = () => {
      for (const queryKey of [keys.workspace, keys.catalog]) queryClient.removeQueries({ queryKey })
      void me.refetch()
    }
    return <WaitingScreen email={email} checking={me.isFetching} onCheck={check} />
  }
  if (me.isPending || status === 401) return null
  return <App />
}

function Root({ linkProblem, hadCode, config }: { linkProblem?: string; hadCode: boolean; config: ClientConfig }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(linkProblem)
  const refuse = useCallback((next: string) => {
    setNotice(next)
    void getSupabase().auth.signOut()
  }, [])

  useEffect(() => {
    const supabase = getSupabase()
    void supabase.auth.getSession().then(({ data }) => {
      // By now Supabase has read the link (detectSessionInUrl); drop its leftovers from the address.
      if (linkProblem || (hadCode && !data.session)) {
        history.replaceState(history.state, '', withoutLinkParams(new URL(location.href), !!data.session))
      }
      if (!data.session && hadCode && !linkProblem) setNotice(CODE_NOT_EXCHANGED)
      mirrorTokenCookie(data.session)
      if (data.session) prefetchSignedIn()
      setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      mirrorTokenCookie(next)
      if (event === 'SIGNED_IN') {
        setNotice(undefined)
        prefetchSignedIn()
      }
      if (!next) queryClient.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [linkProblem, hadCode])

  if (session === undefined) return null
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {session ? <Gate email={session.user.email} onRefused={refuse} /> : <LoginScreen notice={notice} supabaseUrl={config.supabaseUrl} publishableKey={config.supabasePublishableKey} />}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  )
}

// The build writes the config into index.html when it has the environment (Vercel builds do);
// otherwise ask the server for it.
async function loadConfig(): Promise<ClientConfig> {
  const inline = document.getElementById('miso-config')?.textContent
  if (inline) return JSON.parse(inline) as ClientConfig
  const res = await fetch('/api/config')
  if (!res.ok) throw new Error(`The ${APP_NAME} server isn't configured (${res.status}).`)
  return (await res.json()) as ClientConfig
}

installScrollbars()
loadBrandFonts()

async function boot() {
  // The manifest is a public build file: it loads while the config and session resolve. The
  // catalog waits for sign-in (prefetchSignedIn).
  void queryClient.prefetchQuery(manifestQuery)
  // Read before Supabase sees the address: it consumes the link when the client is created.
  let linkProblem = linkNotice(location.search, location.hash)
  const hadCode = new URLSearchParams(location.search).has('code')
  const config = await loadConfig()
  setSupabase(
    createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    })
  )
  // A one-time link the server made, not one a browser asked for (the Compose installer's owner
  // link, cli/selfhost.ts): ?token_hash=…&type=magiclink. It has no PKCE code to exchange.
  const url = new URL(location.href)
  const tokenHash = url.searchParams.get('token_hash')
  if (tokenHash) {
    const { error } = await getSupabase().auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
    if (error) linkProblem = LINK_USED
    url.searchParams.delete('token_hash')
    url.searchParams.delete('type')
    history.replaceState(history.state, '', url)
  }
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Root linkProblem={linkProblem} hadCode={hadCode} config={config} />
    </StrictMode>
  )
}

boot().catch((err: Error) => {
  document.getElementById('root')!.innerHTML =
    `<p style="font:14px system-ui;padding:2rem">${APP_NAME} couldn't start: ${err.message.replace(/</g, '&lt;')}</p>`
})

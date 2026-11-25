// Sign in with an emailed code (or the link in the same email), or with Google when the Supabase project has it on.
import { IconBrandGoogle, IconMail } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { codeError, googleEnabled, sendError, signInCode } from '../lib/sign-in'
import { getSupabase } from '../runtime/session'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Logo } from './Logo'

export function LoginScreen({ notice, supabaseUrl, publishableKey }: { notice?: string; supabaseUrl: string; publishableKey: string }) {
  const [email, setEmail] = useState('')
  // The address the last code went to; null until one is sent.
  const [sent, setSent] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const redirectTo = `${location.origin}${location.pathname}`
  // Hidden while Supabase is asked (a fresh install has no Google client yet), shown unless it says off.
  const google = useQuery({
    queryKey: ['auth-settings', supabaseUrl],
    queryFn: () => googleEnabled(supabaseUrl, publishableKey),
    staleTime: Infinity,
    retry: false
  }).data === true

  // One email carries both a code and a link (the templates in supabase/templates); either signs in.
  async function send(to: string) {
    setError(null)
    setSending(true)
    const { error } = await getSupabase().auth.signInWithOtp({
      email: to,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: true }
    })
    setSending(false)
    if (error) setError(sendError(error))
    else setSent(to)
  }

  return (
    <div className="miso-brand-ground flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-2xl bg-background p-7 shadow-2xl">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg">
            <Logo />
          </h1>
          <p className="text-sm text-muted-foreground">Sign in to continue.</p>
        </div>
        {notice && <p className="rounded-lg bg-muted px-3 py-2 text-sm">{notice}</p>}
        {google && <Button
          size="lg"
          onClick={async () => {
            setError(null)
            const { error } = await getSupabase().auth.signInWithOAuth({
              provider: 'google',
              options: { redirectTo, queryParams: { prompt: 'select_account' } }
            })
            if (error) setError(error.message)
          }}
        >
          <IconBrandGoogle stroke={1.5} />
          Continue with Google
        </Button>}
        <form
          className="flex flex-col gap-2"
          onSubmit={async event => {
            event.preventDefault()
            if (sending) return
            if (sent === null) return send(email)
            const token = signInCode(code)
            if (!token) return setError('Enter the code from the email.')
            setError(null)
            setSending(true)
            const { error } = await getSupabase().auth.verifyOtp({ email: sent, token, type: 'email' })
            setSending(false)
            // On success onAuthStateChange (main.tsx) swaps this screen for the app.
            if (error) setError(codeError(error))
          }}
        >
          {sent === null ? (
            <>
              <Input
                type="email"
                required
                aria-label="Email address"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
              <Button type="submit" variant={google ? 'outline' : 'default'} disabled={sending}>
                <IconMail stroke={1.5} />
                {sending ? 'Sending…' : 'Email me a sign-in code'}
              </Button>
            </>
          ) : (
            <>
              <p className="rounded-lg bg-muted px-3 py-2 text-sm" role="status">
                We emailed a sign-in code to {sent}. Enter it here, or select the link in the email.
              </p>
              <Input
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-label="Sign-in code"
                placeholder="123456"
                maxLength={12}
                value={code}
                onChange={e => setCode(e.target.value)}
              />
              <Button type="submit" disabled={sending}>
                {sending ? 'Signing in…' : 'Sign in'}
              </Button>
              <Button type="button" variant="outline" disabled={sending} onClick={() => send(sent)}>
                <IconMail stroke={1.5} />
                Send a new code
              </Button>
              <Button type="button" variant="ghost" onClick={() => {
                  setSent(null)
                  setCode('')
                  setError(null)
                }}>
                Use another address
              </Button>
            </>
          )}
        </form>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

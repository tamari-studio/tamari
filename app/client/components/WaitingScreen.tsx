// A signed-in account the workspace hasn't let in: waiting for an admin to approve it, or
// suspended. The server can't say which (both are a 403), so the copy fits both. They stay signed
// in, so letting them in needs no new link: "Check again" is enough.
import { getSupabase } from '../runtime/session'
import { Button } from '../ui/button'
import { Logo } from './Logo'

export function WaitingScreen({ email, checking, onCheck }: { email: string | undefined; checking: boolean; onCheck: () => void }) {
  return (
    <div className="miso-brand-ground flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-2xl bg-background p-7 shadow-2xl">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg">
            <Logo />
          </h1>
          <p className="text-sm">
            You're signed in{email ? ` as ${email}` : ''}, but this account can't open the workspace yet.
          </p>
          <p className="text-sm text-muted-foreground">
            An admin needs to let you in. If you had access before, an admin may have paused your account. Ask one of them, then
            check again here.
          </p>
        </div>
        <div className="flex flex-col gap-2" aria-live="polite">
          <Button size="lg" disabled={checking} onClick={onCheck}>
            {checking ? 'Checking…' : 'Check again'}
          </Button>
          <Button variant="outline" onClick={() => void getSupabase().auth.signOut()}>
            Use another account
          </Button>
        </div>
      </div>
    </div>
  )
}

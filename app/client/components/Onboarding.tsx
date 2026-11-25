// What a person meets the first time they open the app: the welcome step (their name, position and
// department, server/welcome.ts; the first owner then picks sample spaces), then the tour
// (Tour.tsx). The sidebar's "Take the tour" row opens the tour again.
import { useEffect, useState, type FormEvent } from 'react'
import type { WelcomeState } from '../../lib/types'
import { hasSeen, markSeen, onStartTour } from '../lib/onboarding'
import { useMe, useSaveWelcome, useWelcome } from '../lib/queries'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { cn } from '../ui/utils'
import { SamplePicker } from './SamplePicker'
import { Tour } from './Tour'
import { APP_NAME } from '../../lib/brand'

const NAME_MAX = 80

// `onDone(saved)`: false when they put it off, which asks again on the next load.
function WelcomeDialog({ state, onDone }: { state: WelcomeState; onDone: (saved: boolean) => void }) {
  const save = useSaveWelcome()
  const [name, setName] = useState(state.name ?? '')
  const [position, setPosition] = useState('')
  const [newTeam, setNewTeam] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  // Saved, and now the first owner picks sample spaces.
  const [samples, setSamples] = useState(false)
  // They picked departments but weren't put in them (the database can't do that yet): an admin does it.
  const [unplaced, setUnplaced] = useState(false)
  const toggle = (id: string) => setPicked(ids => (ids.includes(id) ? ids.filter(d => d !== id) : [...ids, id]))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || save.isPending) return
    save.mutate(
      {
        name: name.trim(),
        departmentIds: picked,
        ...(position.trim() ? { position: position.trim() } : {}),
        ...(newTeam.trim() ? { newTeam: newTeam.trim() } : {})
      },
      {
        // Said in the dialog, not a toast: the tour opens next and would cover it.
        onSuccess: result => ((picked.length || newTeam.trim()) && !result.joined ? setUnplaced(true) : state.samples ? setSamples(true) : onDone(true))
      }
    )
  }

  if (samples) {
    return (
      <Dialog open onOpenChange={open => !open && onDone(true)} disablePointerDismissal>
        <DialogContent showCloseButton={false} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Start with sample spaces</DialogTitle>
            <DialogDescription>Pick the ones that fit your company. Each comes with example rows you can remove later.</DialogDescription>
          </DialogHeader>
          <SamplePicker onDone={() => onDone(true)} skip="Skip for now" />
        </DialogContent>
      </Dialog>
    )
  }

  if (unplaced) {
    return (
      <Dialog open onOpenChange={open => !open && onDone(true)} disablePointerDismissal>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thanks, {name.trim()}</DialogTitle>
            <DialogDescription>
              Your name is saved. An admin will add you to your team, and its spaces show up here once they have.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onDone(true)}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={open => !open && onDone(false)} disablePointerDismissal>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Welcome to {APP_NAME}</DialogTitle>
            <DialogDescription>Tell us who you are, so you get the spaces your team works in.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5">
            <span className="font-medium">Your name</span>
            <Input value={name} onChange={event => setName(event.target.value)} maxLength={NAME_MAX} autoComplete="name" required />
          </label>
          {state.position && (
            <label className="grid gap-1.5">
              <span className="flex items-baseline gap-1.5">
                <span className="font-medium">Your position</span>
                <span className="text-xs text-muted-foreground">Optional</span>
              </span>
              <Input
                value={position}
                onChange={event => setPosition(event.target.value)}
                maxLength={NAME_MAX}
                autoComplete="organization-title"
                placeholder="For example Head of sales"
              />
            </label>
          )}
          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 font-medium">Your team</legend>
            {state.departments.length === 0 ? (
              !state.newTeam && <p className="text-muted-foreground">There are no teams to pick yet. An admin will add you to yours.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {state.departments.map(department => {
                    const on = picked.includes(department.id)
                    return (
                      <button
                        key={department.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(department.id)}
                        className={cn(
                          'h-8 rounded-lg border px-3 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
                          on ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'
                        )}
                      >
                        {department.name}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground">Pick every team you work in. You choose once; after that an admin changes it.</p>
              </>
            )}
            {state.newTeam && (
              <Input
                value={newTeam}
                onChange={event => setNewTeam(event.target.value)}
                maxLength={NAME_MAX}
                placeholder={state.departments.length ? 'Or make a new team' : 'Name your team, for example Sales'}
                aria-label="New team"
              />
            )}
          </fieldset>
          {save.isError && (
            <p role="alert" className="text-destructive">
              {save.error.message}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onDone(false)}>
              Not now
            </Button>
            <Button type="submit" disabled={!name.trim() || save.isPending}>
              {save.isPending ? 'Saving…' : 'Continue'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function Onboarding() {
  const me = useMe().data
  const [welcomeClosed, setWelcomeClosed] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)

  const mayWelcome = !!me && !welcomeClosed && me.tier !== null && me.status === 'active' && !hasSeen('welcomed', me.id)
  const welcome = useWelcome(mayWelcome)
  // A failed check counts as "not needed": the welcome step never stands between a person and the app.
  const showWelcome = mayWelcome && welcome.data?.needed === true
  const waiting = mayWelcome && (welcome.isPending || showWelcome)

  const id = me?.id
  useEffect(() => {
    if (id && !waiting && !hasSeen('tour', id)) setTourOpen(true)
  }, [id, waiting])
  useEffect(() => onStartTour(() => setTourOpen(true)), [])

  return (
    <>
      {showWelcome && welcome.data && (
        <WelcomeDialog
          state={welcome.data}
          onDone={saved => {
            if (saved && id) markSeen('welcomed', id)
            setWelcomeClosed(true)
          }}
        />
      )}
      <Tour
        open={tourOpen}
        onClose={() => {
          setTourOpen(false)
          if (id) markSeen('tour', id)
        }}
      />
    </>
  )
}

// Sample spaces to add to the company (server/samples.ts): one line and a picture per starter
// template. The welcome step shows it to the first owner; admins and owners find it later in the
// sidebar ("Browse templates") and on Settings → Organisation. Added templates show greyed.
import { IconCheck, IconLayoutDashboard } from '@tabler/icons-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { SampleSpace } from '../../lib/types'
import { api } from '../lib/http'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import { Skeleton } from '../ui/skeleton'
import { cn } from '../ui/utils'

export const SAMPLES_KEY = ['samples'] as const

export function useSamples(enabled = true) {
  return useQuery({ queryKey: SAMPLES_KEY, queryFn: () => api<{ available: boolean; spaces: SampleSpace[] }>('/api/samples'), enabled })
}

// When the build this install serves was made (/api/config); never a cached answer.
const builtAt = () =>
  fetch('/api/config', { cache: 'no-store' })
    .then(r => r.json() as Promise<{ builtAt: string }>)
    .then(
      c => c.builtAt,
      () => null
    )

// The added spaces are in a new build, which a restarted server serves, with a new page: wait for it (30 s at most).
async function newBuild(before: string | null): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const now = await builtAt()
    if (now && now !== before) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

// `onDone`: after adding, or on skip. `skip`: the label of the way out, when there is one.
export function SamplePicker({ onDone, skip }: { onDone?: () => void; skip?: string }) {
  const qc = useQueryClient()
  const samples = useSamples()
  const [picked, setPicked] = useState<string[]>([])
  const add = useMutation({
    mutationFn: async (types: string[]) => {
      const before = await builtAt()
      await api<{ added: string[] }>('/api/samples', { method: 'POST', body: { types } })
      await newBuild(before)
    },
    // The page this tab has can't open the new spaces' code: load the new one.
    onSuccess: () => {
      onDone?.()
      location.reload()
    },
    onError: () => qc.invalidateQueries({ queryKey: SAMPLES_KEY })
  })
  const toggle = (type: string) => setPicked(p => (p.includes(type) ? p.filter(t => t !== type) : [...p, type]))

  if (samples.isPending) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        {[0, 1, 2, 3].map(i => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    )
  }
  if (samples.isError) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="text-destructive">Couldn't load the sample spaces. {samples.error.message}</p>
        <Button variant="outline" size="sm" onClick={() => void samples.refetch()}>
          Try again
        </Button>
      </div>
    )
  }
  // Every template, the added ones greyed: an overview, not a list that empties.
  const none = samples.data.spaces.every(s => s.added)

  return (
    <div className="grid gap-4 text-sm">
      <div className="grid max-h-[55vh] gap-2 overflow-y-auto sm:grid-cols-2" role="group" aria-label="Sample spaces">
        {samples.data.spaces.map(s => {
          const on = picked.includes(s.type)
          return (
            <button
              key={s.type}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s.type)}
              disabled={add.isPending || s.added}
              className={cn(
                'relative flex flex-col gap-2 rounded-lg border p-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none',
                s.added ? 'bg-background opacity-60' : on ? 'border-primary bg-primary/5' : 'bg-background hover:bg-accent'
              )}
            >
              {s.image ? (
                <img src={`/api/samples/${s.type}/image`} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-md border bg-muted object-cover" />
              ) : (
                <span className="flex aspect-[4/3] w-full items-center justify-center rounded-md border bg-muted text-muted-foreground">
                  <IconLayoutDashboard size={28} stroke={1.5} />
                </span>
              )}
              <span className="flex flex-col gap-0.5 px-1 pb-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-medium">{s.space}</span>
                  {s.added && <Badge variant="secondary">Added</Badge>}
                </span>
                <span className="text-xs text-muted-foreground">{s.job}</span>
              </span>
              {on && (
                <span className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <IconCheck size={14} stroke={1.75} />
                </span>
              )}
            </button>
          )
        })}
      </div>
      {add.isError && (
        <p role="alert" className="text-destructive">
          {add.error.message}
        </p>
      )}
      {none ? (
        <p className="text-muted-foreground">Every template is in your workspace. Ask your coding agent to build the next space.</p>
      ) : (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {add.isPending && <p className="text-xs text-muted-foreground sm:mr-auto">Adding and building them. This takes up to a minute.</p>}
          {skip && onDone && (
            <Button type="button" variant="ghost" onClick={onDone} disabled={add.isPending}>
              {skip}
            </Button>
          )}
          <Button type="button" onClick={() => add.mutate(picked)} disabled={!picked.length || add.isPending}>
            {add.isPending ? 'Adding…' : picked.length ? `Add ${picked.length} ${picked.length === 1 ? 'space' : 'spaces'}` : 'Add spaces'}
          </Button>
        </div>
      )}
    </div>
  )
}

// The picker on its own, from the sidebar's "Browse templates".
export function SamplesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Templates</DialogTitle>
          <DialogDescription>Starter spaces for common kinds of work, each with example rows. They become your company's own spaces.</DialogDescription>
        </DialogHeader>
        {open && <SamplePicker />}
      </DialogContent>
    </Dialog>
  )
}

/** Whether this person gets "Browse templates": admins and owners, where the app can add spaces. */
export function useBrowseTemplates(admin: boolean): boolean {
  return useSamples(admin).data?.available === true && admin
}

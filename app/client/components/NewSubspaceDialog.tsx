// Names a new subspace under a top-level space, then opens it. Owners only (Sidebar shows the button).
import { useEffect, useState } from 'react'
import type { Space } from '../../lib/types'
import { useCreateSubspace } from '../lib/queries'
import { navigate } from '../lib/router'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'

export function NewSubspaceDialog({ parent, onOpenChange }: { parent: Space | null; onOpenChange: (open: boolean) => void }) {
  const create = useCreateSubspace()
  const [name, setName] = useState('')
  useEffect(() => {
    if (parent) setName('')
  }, [parent])

  return (
    <Dialog open={parent !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New subspace in {parent?.name}</DialogTitle>
          <DialogDescription>
            A subspace has its own tabs and widgets. Open any view in it, including ones already open in {parent?.name}. Only owners see
            subspaces for now.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={event => {
            event.preventDefault()
            if (!parent || !name.trim()) return
            create.mutate(
              { parentId: parent.id, name: name.trim() },
              { onSuccess: space => navigate(`/${(space as Space).slug}`) }
            )
            onOpenChange(false)
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-muted-foreground">Name</span>
            <Input value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="Hiring" required autoFocus />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={!name.trim()}>
              Make subspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

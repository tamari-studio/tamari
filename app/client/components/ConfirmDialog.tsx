// "Are you sure?" for a change that takes effect at once and is hard to take back, or reaches
// everyone: suspending a member, limiting a space, closing a shared tab, hiding a shared widget.
// const [confirm, dialog] = useConfirm(); confirm({ title, description, action, run }); render {dialog}.
import { useState, type ReactNode } from 'react'
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

export type Confirmation = {
  title: string
  description: ReactNode
  // The confirm button's label: what happens, e.g. "Suspend".
  action: string
  destructive?: boolean
  run: () => void
}

export function useConfirm(): [(confirmation: Confirmation) => void, ReactNode] {
  const [open, setOpen] = useState(false)
  // Kept after closing, so the text doesn't vanish during the close animation.
  const [current, setCurrent] = useState<Confirmation | null>(null)
  const ask = (confirmation: Confirmation) => {
    setCurrent(confirmation)
    setOpen(true)
  }
  const dialog = (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{current?.title}</AlertDialogTitle>
          <AlertDialogDescription>{current?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={current?.destructive ? 'destructive' : 'default'}
            onClick={() => {
              setOpen(false)
              current?.run()
            }}
          >
            {current?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return [ask, dialog]
}

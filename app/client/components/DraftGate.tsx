// Shown instead of someone else's draft space (lib/drafts.ts): its code hasn't been reviewed, and
// opening it runs that code as the person looking. Opening is a deliberate second step.
import { IconAlertTriangle } from '@tabler/icons-react'
import { Button } from '../ui/button'

export function DraftGate({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      <IconAlertTriangle size={20} stroke={1.5} className="text-muted-foreground" />
      <div className="flex max-w-md flex-col gap-1">
        <p className="font-medium">{name} is a member's draft</p>
        <p className="text-muted-foreground">
          Nobody has reviewed its code yet. Opening it runs that code in your browser as you, with everything you can do in this workspace, including approving proposals. Read its changes on the Proposals page first.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onOpen}>
        Open the draft
      </Button>
    </div>
  )
}

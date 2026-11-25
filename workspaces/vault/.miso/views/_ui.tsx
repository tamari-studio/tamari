// Small pieces the Vault views share.
import { IconArrowLeft } from '@tabler/icons-react'

const BUTTON = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-50'
export const PRIMARY = `${BUTTON} bg-primary text-primary-foreground hover:bg-primary/90`
export const OUTLINE = `${BUTTON} border bg-background hover:bg-accent`
export const INPUT = 'h-9 rounded-md border bg-background px-3 text-sm'

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function day(iso: string | undefined): string {
  const date = iso ? new Date(iso) : null
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

export function Back({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="-ml-2 inline-flex h-8 items-center gap-1.5 self-start rounded-lg px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
      <IconArrowLeft size={16} stroke={1.75} />
      {label}
    </button>
  )
}

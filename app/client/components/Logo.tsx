// The Tamari mark with a name beside it: the product's name, or the workspace's once it has one.
// The name is set as Tamari's wordmark: M PLUS 1, semibold, slightly tight.
import { MARK_PATHS, WORDMARK } from '../../lib/brand'
import { cn } from '../ui/utils'

export function Logo({ name = WORDMARK, className }: { name?: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-4 shrink-0">
        {MARK_PATHS.map(d => <path key={d} d={d} />)}
      </svg>
      <span className="truncate font-wordmark font-semibold tracking-[-0.01em]">{name}</span>
    </span>
  )
}

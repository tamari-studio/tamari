// The guided tour: one card at a time, pointing at the real thing in the shell where there is one
// (a `data-tour` anchor), with the rest of the screen dimmed. What it says is in lib/onboarding.ts.
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { placeCard, TOUR_STEPS, visibleSteps, type Box, type TourStep } from '../lib/onboarding'
import { Button } from '../ui/button'
import { Dialog, DialogDescription, DialogPortal, DialogTitle } from '../ui/dialog'
import { cn } from '../ui/utils'

// Room between an anchor and the ring around it.
const PAD = 4

function anchor(target: string | undefined): HTMLElement | null {
  const element = target ? document.querySelector<HTMLElement>(`[data-tour="${target}"]`) : null
  // In the page but not drawn (the sidebar on a phone) counts as not there.
  return element && element.getClientRects().length > 0 ? element : null
}

type Layout = { hole: Box | null; card: { top: number; left: number } }

export function Tour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [steps, setSteps] = useState<TourStep[]>([])
  const [index, setIndex] = useState(0)
  const [card, setCard] = useState<HTMLElement | null>(null)
  const [layout, setLayout] = useState<Layout | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = steps[index]

  // Which steps this viewer gets is settled when the tour opens.
  useLayoutEffect(() => {
    if (!open) return
    setSteps(visibleSteps(TOUR_STEPS, target => anchor(target) !== null, window.matchMedia('(pointer: coarse)').matches))
    setIndex(0)
  }, [open])

  const measure = useCallback(() => {
    if (!card || !step) return
    const element = anchor(step.target)
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const rect = element?.getBoundingClientRect()
    const hole = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD } : null
    setLayout({
      hole,
      card: placeCard(hole, { width: card.offsetWidth, height: card.offsetHeight }, { width: window.innerWidth, height: window.innerHeight })
    })
  }, [card, step])

  useLayoutEffect(measure, [measure])
  useEffect(() => {
    if (!open) return
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, measure])

  const last = index === steps.length - 1
  const next = () => (last ? onClose() : setIndex(index + 1))
  const back = () => setIndex(Math.max(0, index - 1))

  return (
    <Dialog open={open && step !== undefined} onOpenChange={isOpen => !isOpen && onClose()} disablePointerDismissal>
      <DialogPortal>
        {/* The dim is this box's shadow, so the anchor inside it stays bright. No anchor: a point, all dim. */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none fixed z-50 rounded-lg shadow-[0_0_0_200vmax_rgb(0_0_0/0.45)] transition-all duration-200 motion-reduce:transition-none',
            layout?.hole && 'ring-2 ring-ring',
            !layout && 'invisible'
          )}
          style={layout?.hole ?? { top: '50%', left: '50%', width: 0, height: 0 }}
        />
        <DialogPrimitive.Popup
          ref={setCard}
          initialFocus={nextRef}
          onKeyDown={event => {
            if (event.key === 'ArrowRight') next()
            if (event.key === 'ArrowLeft') back()
          }}
          className={cn(
            'fixed z-50 flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl outline-none transition-[top,left] duration-200 motion-reduce:transition-none',
            // Not `invisible`: the Next button takes focus before the card has been measured.
            !layout && 'opacity-0'
          )}
          style={layout?.card}
        >
          {step && (
            <>
              <div aria-live="polite" className="flex flex-col gap-1.5">
                <DialogTitle className="text-base">{step.title}</DialogTitle>
                <DialogDescription>{step.body}</DialogDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-xs text-muted-foreground">
                  {index + 1} of {steps.length}
                </span>
                {!last && (
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Skip
                  </Button>
                )}
                {index > 0 && (
                  <Button variant="outline" size="sm" onClick={back}>
                    Back
                  </Button>
                )}
                <Button ref={nextRef} size="sm" onClick={next}>
                  {last ? 'Done' : 'Next'}
                </Button>
              </div>
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  )
}

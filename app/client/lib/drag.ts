// Dragging tabs and widgets between spaces.
import type { DragEvent } from 'react'

export const DRAG_TYPE = 'application/x-miso-item'

export type DragItem =
  | { type: 'tab'; tabId: string; ref: string; fromSpaceId: string }
  | { type: 'widget'; ref: string; fromSpaceId: string }

export function readDragItem(event: DragEvent): DragItem | null {
  const raw = event.dataTransfer.getData(DRAG_TYPE)
  if (!raw) return null
  try {
    return JSON.parse(raw) as DragItem
  } catch {
    return null
  }
}

// Tabs just closed or moved away. A space screen whose URL still names one of
// them sends you to another tab instead of reopening it.
const removed = new Map<string, number>()

export function markTabRemoved(spaceId: string, ref: string): void {
  removed.set(`${spaceId} ${ref}`, Date.now())
}

export function wasTabRemoved(spaceId: string, ref: string): boolean {
  const at = removed.get(`${spaceId} ${ref}`)
  return at !== undefined && Date.now() - at < 10_000
}

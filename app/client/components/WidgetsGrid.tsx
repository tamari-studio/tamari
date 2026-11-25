// A space's widgets on a centred grid of square cells, 6, 10 or 14 columns
// wide (see lib/widget-grid.ts for the frame). Widgets can come from any
// space's folder, start 2×2 (the minimum) and sit exactly where they're put. "Edit widgets" turns on
// edit mode: drag a widget (or a hidden one from the tray) onto any free cell,
// drag its corner to resize it, hide it, or drag it onto a space in the
// sidebar to move it there.
import { IconArrowsExchange, IconCheck, IconDots, IconEyeOff, IconGripVertical, IconLayoutGrid, IconPlus } from '@tabler/icons-react'
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import type { CatalogApplet, Space, Workspace } from '../../lib/types'
import { DRAG_TYPE } from '../lib/drag'
import { folderName as nameOfFolder } from '../lib/labels'
import { useApplets, useCatalog, useMoveWidget, useSaveLayout } from '../lib/queries'
import { toast } from '../lib/toast'
import { homeFolder, inSidebarOrder, spaceLabel } from '../lib/subspaces'
import {
  COLUMN_CHOICES,
  FRAME_COLS,
  MIN_SPAN,
  bringIn,
  clip,
  fitAt,
  place,
  resolveLayout,
  rowsUsed,
  toPlacements,
  visibleRange,
  type Cell,
  type Columns
} from '../lib/widget-grid'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { cn } from '../ui/utils'
import { Applet } from './Applet'
import { useConfirm } from './ConfirmDialog'

const GAP = 8
const PADDING = 32
// A cell never shrinks below this while fewer columns would still fit.
const MIN_CELL = 56
// The 4-column view is the phone one: its cells use the width (about 80px at 390px).
const PHONE_CELL = 88

// How many columns you look at is a per-browser view setting; where widgets
// sit is shared.
const columnsKey = (spaceId: string) => `miso.widget-columns.${spaceId}`
function readColumns(spaceId: string): Columns {
  let saved = 0
  try {
    saved = Number(localStorage.getItem(columnsKey(spaceId)))
  } catch {
    // Private mode or storage blocked: the default width.
  }
  // 3/5/7 were saved before the grid got twice as fine.
  const n = saved === 3 || saved === 5 || saved === 7 ? saved * 2 : saved
  if ((COLUMN_CHOICES as readonly number[]).includes(n)) return n as Columns
  // A phone gets cells it can read and touch.
  return window.innerWidth < 640 ? 4 : 6
}

type Preview = Cell & { ok: boolean }
type Drag = { ref: string; w: number; h: number; offX: number; offY: number }

export function WidgetsGrid({ space, workspace }: { space: Space; workspace: Workspace }) {
  const applets = useApplets()
  const catalog = useCatalog()
  const saveLayout = useSaveLayout()
  const moveWidget = useMoveWidget()
  const [editing, setEditing] = useState(false)
  const [columns, setColumnsState] = useState<Columns>(() => readColumns(space.id))
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const drag = useRef<Drag | null>(null)
  const resizing = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width - PADDING))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const setColumns = (n: Columns) => {
    try {
      localStorage.setItem(columnsKey(space.id), String(n))
    } catch {
      // Storage blocked: the width holds until the page reloads.
    }
    setColumnsState(n)
  }

  // Cells keep the size they'd have at 14 columns, so 6 and 10 are narrower,
  // centred grids rather than bigger widgets — unless that gets too small.
  const fullCell = (width - GAP * (FRAME_COLS - 1)) / FRAME_COLS
  const cell = Math.max(1, Math.min((width - GAP * (columns - 1)) / columns, Math.max(fullCell, MIN_CELL, columns === 4 ? PHONE_CELL : 0)))
  const range = visibleRange(columns)

  const placed = workspace.layouts.find(l => l.spaceId === space.id)?.widgets ?? []
  const otherSpaces = inSidebarOrder(workspace.spaces).filter(s => s.id !== space.id)
  const ownFolder = homeFolder(workspace.spaces, space)
  const folderName = (folder: string) => nameOfFolder(folder, workspace, catalog.data)
  const cells = resolveLayout(placed, range)
  // What this width shows: widgets that only partly fit are trimmed to the
  // visible columns (see clip), so every cell that's taken looks taken.
  const shown = cells.map(c => clip(c, range)).filter((c): c is Cell => c !== null)
  const offGrid = cells.filter(c => !clip(c, range))
  const save = (next: Cell[]) => saveLayout.mutate({ spaceId: space.id, widgets: toPlacements(next) })
  const titleOf = (ref: string) => applets.get(`widget:${ref}`)?.title ?? ref

  const hidden = new Map<string, CatalogApplet[]>()
  for (const applet of catalog.data?.applets ?? []) {
    if (applet.kind !== 'widget' || placed.some(w => w.ref === applet.ref)) continue
    hidden.set(applet.folder, [...(hidden.get(applet.folder) ?? []), applet])
  }
  const ownFirst = [...hidden.keys()].sort((a, b) => (a === ownFolder ? -1 : b === ownFolder ? 1 : folderName(a).localeCompare(folderName(b))))

  const others = (ref: string) => cells.filter(c => c.ref !== ref)
  const show = (ref: string) => save(bringIn(cells, ref, range))
  const [confirm, confirmDialog] = useConfirm()
  // The grid is the whole team's, so hiding a widget hides it for everyone.
  const hide = (ref: string) =>
    confirm({
      title: `Hide ${titleOf(ref)} for everyone?`,
      description: `The widgets grid is shared: ${titleOf(ref)} leaves ${space.name}'s grid for everyone. Anyone can put it back with Edit widgets.`,
      action: 'Hide widget',
      run: () => save(others(ref))
    })

  // Frame cell under a point, unclamped.
  const cellAt = (clientX: number, clientY: number) => {
    const rect = gridRef.current!.getBoundingClientRect()
    return {
      x: range.from + Math.floor((clientX - rect.left) / (cell + GAP)),
      y: Math.floor((clientY - rect.top) / (cell + GAP))
    }
  }
  const showPreview = (next: Cell) => {
    const ok = place(cells, next, range) !== null
    if (preview?.ref !== next.ref || preview.x !== next.x || preview.y !== next.y || preview.w !== next.w || preview.h !== next.h || preview.ok !== ok)
      setPreview({ ...next, ok })
  }
  const commit = (next: Cell) => {
    const layout = place(cells, next, range)
    if (layout) save(layout)
    else toast('That spot overlaps another widget. Pick a free spot.', 'error')
  }

  // Moving: HTML drag and drop, so the sidebar can still take a widget.
  const startDrag = (event: DragEvent, ref: string, from: Cell | null) => {
    if (resizing.current) {
      event.preventDefault()
      return
    }
    let offX = 0
    let offY = 0
    if (from) {
      const tile = event.currentTarget.getBoundingClientRect()
      offX = Math.min(from.w - 1, Math.floor((event.clientX - tile.left) / (cell + GAP)))
      offY = Math.min(from.h - 1, Math.floor((event.clientY - tile.top) / (cell + GAP)))
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ type: 'widget', ref, fromSpaceId: space.id }))
    } else {
      event.dataTransfer.setData('text/plain', ref)
    }
    event.dataTransfer.effectAllowed = 'move'
    drag.current = { ref, w: Math.max(MIN_SPAN, from?.w ?? 0), h: Math.max(MIN_SPAN, from?.h ?? 0), offX, offY }
    setBusy(ref)
  }
  const endDrag = () => {
    drag.current = null
    setBusy(null)
    setPreview(null)
  }
  // Where the dragged widget would land with the pointer here: at its own
  // size, or shrunk to the free gap under it (see fitAt); `ok: false` when
  // not even 2×2 fits.
  const dropTarget = (d: Drag, clientX: number, clientY: number): Preview => {
    const at = cellAt(clientX, clientY)
    // Stay where it was dropped and get narrower at the edge of the view,
    // rather than sliding left onto whatever is there.
    const x = Math.max(range.from, Math.min(range.to - MIN_SPAN, at.x - d.offX))
    const wanted = { ref: d.ref, x, y: Math.max(0, at.y - d.offY), w: Math.min(d.w, range.to - x), h: d.h }
    const fitted = fitAt(cells, wanted, range)
    return fitted ? { ...fitted, ok: true } : { ...wanted, ok: false }
  }
  const onGridDragOver = (event: DragEvent) => {
    const d = drag.current
    if (!d) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const next = dropTarget(d, event.clientX, event.clientY)
    if (preview?.ref !== next.ref || preview.x !== next.x || preview.y !== next.y || preview.w !== next.w || preview.h !== next.h || preview.ok !== next.ok)
      setPreview(next)
  }
  // Worked out again from the drop point itself: the preview in state can be
  // a step behind the pointer when the drop comes fast.
  const onGridDrop = (event: DragEvent) => {
    const d = drag.current
    if (!d) return
    event.preventDefault()
    const target = dropTarget(d, event.clientX, event.clientY)
    if (target.ok) commit(target)
    else toast("There's no free 2×2 space there. Pick an empty spot.", 'error')
    endDrag()
  }

  // Keyboard: arrow keys move the focused widget one cell, Shift+arrows resize it. A blocked or
  // off-view step is refused the way a drop is.
  const onTileKey = (event: KeyboardEvent<HTMLElement>, from: Cell) => {
    if (event.target !== event.currentTarget) return
    const [dx, dy] = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key] ?? []
    if (dx === undefined) return
    event.preventDefault()
    const next = event.shiftKey ? { ...from, w: from.w + dx, h: from.h + dy } : { ...from, x: from.x + dx, y: from.y + dy }
    if (next.x < range.from || next.x + next.w > range.to || next.y < 0 || next.w < MIN_SPAN || next.h < MIN_SPAN) return
    commit(next)
  }

  // Resizing: pointer events on the corner handle.
  const onResizeStart = (event: PointerEvent, from: Cell) => {
    event.preventDefault()
    event.stopPropagation()
    resizing.current = true
    setBusy(from.ref)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const resizeTo = (event: PointerEvent, from: Cell): Cell => {
    const at = cellAt(event.clientX, event.clientY)
    return {
      ...from,
      w: Math.max(MIN_SPAN, Math.min(range.to - from.x, at.x - from.x + 1)),
      h: Math.max(MIN_SPAN, at.y - from.y + 1)
    }
  }
  const onResizeMove = (event: PointerEvent, from: Cell) => {
    if (resizing.current) showPreview(resizeTo(event, from))
  }
  const onResizeEnd = (event: PointerEvent, from: Cell) => {
    if (!resizing.current) return
    resizing.current = false
    const next = resizeTo(event, from)
    if (next.w !== from.w || next.h !== from.h) commit(next)
    setBusy(null)
    setPreview(null)
  }

  const area = (c: Cell): CSSProperties => ({
    gridColumn: `${c.x - range.from + 1} / span ${c.w}`,
    gridRow: `${c.y + 1} / span ${c.h}`
  })

  const columnSwitch = (
    <div role="radiogroup" aria-label="Grid width" className="flex items-center rounded-lg border p-0.5">
      {COLUMN_CHOICES.map(n => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={columns === n}
          title={`${n} columns`}
          onClick={() => setColumns(n)}
          className={cn('h-6 rounded-md px-2 text-xs tabular-nums transition-colors', columns === n ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
        >
          {n}
        </button>
      ))}
    </div>
  )

  const toolbar = (
    <div className="flex items-center gap-2">
      {editing && <p className="text-xs text-muted-foreground max-sm:hidden">Drag a widget onto any free spot (it shrinks to fit a smaller gap); drag its bottom-right corner to resize. Or focus a widget and use the arrow keys to move it, with Shift to resize. Changes save as you go, for everyone on this space.</p>}
      <div className="ml-auto flex items-center gap-2">
        {columnSwitch}
        <Button variant={editing ? 'default' : 'outline'} size="sm" onClick={() => setEditing(e => !e)}>
          {editing ? <IconCheck stroke={1.75} /> : <IconLayoutGrid stroke={1.75} />}
          {editing ? 'Done' : 'Edit widgets'}
        </Button>
      </div>
    </div>
  )

  const trayButton = (ref: string, label: string) => (
    <Button
      key={ref}
      variant="outline"
      size="xs"
      draggable
      onDragStart={event => startDrag(event, ref, null)}
      onDragEnd={endDrag}
      onClick={() => show(ref)}
    >
      <IconPlus stroke={1.75} />
      {label}
    </Button>
  )

  const trays = editing && (
    <div className="flex flex-col gap-3">
      {offGrid.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
          <h2 className="text-sm font-medium">Outside the {columns}-column grid</h2>
          <p className="text-xs text-muted-foreground">Placed in columns this width doesn't show. Click to bring one into the first free cell, or drag it onto a cell.</p>
          <div className="flex flex-wrap gap-1.5">{offGrid.map(c => trayButton(c.ref, titleOf(c.ref)))}</div>
        </section>
      )}
      <section className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
        <h2 className="text-sm font-medium">Not on this space's grid</h2>
        {hidden.size === 0 ? (
          <p className="text-xs text-muted-foreground">Every widget is on this space's grid.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Click to add one in the first free cell, or drag it onto a cell.</p>
            {ownFirst.map(folder => (
              <div key={folder} className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">{folder === ownFolder ? `${folderName(folder)} (this space)` : folderName(folder)}</p>
                <div className="flex flex-wrap gap-1.5">{hidden.get(folder)!.map(widget => trayButton(widget.ref, widget.title))}</div>
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  )

  const tile = (c: Cell) => {
    const { ref } = c
    const widget = applets.get(`widget:${ref}`)
    const title = titleOf(ref)
    return (
      <div
        key={ref}
        draggable={editing}
        tabIndex={editing ? 0 : undefined}
        aria-label={editing ? `${title}. Arrow keys move it, Shift and arrow keys resize it.` : undefined}
        onKeyDown={editing && cells.some(f => f.ref === ref && f.x === c.x && f.w === c.w) ? event => onTileKey(event, c) : undefined}
        onDragStart={editing ? event => startDrag(event, ref, c) : undefined}
        onDragEnd={editing ? endDrag : undefined}
        style={area(c)}
        className={cn(
          'relative isolate overflow-hidden rounded-xl bg-background shadow-sm',
          editing && 'cursor-grab ring-1 ring-border active:cursor-grabbing',
          busy === ref && 'opacity-40'
        )}
      >
        <div className={cn('absolute inset-0 overflow-hidden', editing && 'pointer-events-none opacity-60 select-none')}>
          {widget ? (
            <Applet kind="widget" refId={ref} name={title} spaceId={space.id} compact />
          ) : (
            <p className="p-3 text-xs text-muted-foreground">{ref} isn't in this build.</p>
          )}
        </div>
        {editing && (
          <>
            <div className="absolute inset-x-1.5 top-1.5 z-10 flex items-center gap-1">
              <span className="flex min-w-0 items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-xs shadow-xs">
                <IconGripVertical size={12} stroke={1.75} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{title}</span>
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                <Button variant="outline" size="icon-xs" aria-label={`Hide ${title} for everyone`} title="Hide for everyone" onClick={() => hide(ref)}>
                  <IconEyeOff stroke={1.75} />
                </Button>
                {otherSpaces.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="icon-xs" aria-label={`More options for ${title}`} title="More" />}>
                      <IconDots stroke={1.75} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>
                          {title} · {folderName(ref.split('/')[0])}
                        </DropdownMenuLabel>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <IconArrowsExchange stroke={1.75} />
                            Move to space
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-48">
                            {otherSpaces.map(target => (
                              <DropdownMenuItem
                                key={target.id}
                                onClick={() => {
                                  moveWidget.mutate({ fromSpaceId: space.id, toSpaceId: target.id, ref })
                                  toast(`Moved ${title} to ${spaceLabel(workspace.spaces, target)}`, 'success')
                                }}
                              >
                                {spaceLabel(workspace.spaces, target)}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            {/* A tile trimmed to this view's columns would save its trimmed size for every width. */}
            {cells.some(f => f.ref === ref && f.x === c.x && f.w === c.w) && (
              <div
                role="separator"
                aria-label={`Resize ${title}`}
                title="Drag to resize"
                onPointerDown={event => onResizeStart(event, c)}
                onPointerMove={event => onResizeMove(event, c)}
                onPointerUp={event => onResizeEnd(event, c)}
                onPointerCancel={event => onResizeEnd(event, c)}
                className="absolute right-0 bottom-0 z-10 size-5 cursor-se-resize touch-none"
              >
                <span className="absolute right-1 bottom-1 size-2.5 rounded-br-sm border-r-2 border-b-2 border-muted-foreground/70" />
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  let body
  if (cells.length === 0 && !editing) {
    body = (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <p>No widgets on this space yet. Widgets from every space can go here.</p>
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          <IconLayoutGrid stroke={1.75} />
          Edit widgets
        </Button>
      </div>
    )
  } else {
    // While editing, room to drop or grow below the last widget.
    const rows = Math.max(rowsUsed(shown) + (editing ? 2 * MIN_SPAN : 0), editing ? 3 * MIN_SPAN : 0)
    body = (
      <div className="flex flex-col gap-3 p-4">
        {toolbar}
        {width > 0 && (
          <div
            ref={gridRef}
            onDragOver={onGridDragOver}
            onDragLeave={event => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(null)
            }}
            onDrop={onGridDrop}
            className="mx-auto grid"
            style={{ gap: GAP, gridTemplateColumns: `repeat(${columns}, ${cell}px)`, gridAutoRows: `${cell}px` }}
          >
            {editing &&
              Array.from({ length: rows * columns }, (_, i) => (
                <div
                  key={`cell-${i}`}
                  aria-hidden
                  style={{ gridColumn: (i % columns) + 1, gridRow: Math.floor(i / columns) + 1 }}
                  className="rounded-xl border border-dashed border-border"
                />
              ))}
            {shown.map(tile)}
            {preview && (
              <div
                aria-hidden
                style={area(preview)}
                className={cn('pointer-events-none z-20 rounded-xl ring-2', preview.ok ? 'bg-ring/15 ring-ring' : 'bg-destructive/10 ring-destructive')}
              />
            )}
          </div>
        )}
        {!editing && offGrid.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            {offGrid.length === 1 ? '1 widget sits' : `${offGrid.length} widgets sit`} outside the {columns}-column grid. Switch to a wider grid to see{' '}
            {offGrid.length === 1 ? 'it' : 'them'}.
          </p>
        )}
        {trays}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="min-h-full">
      {body}
      {confirmDialog}
    </div>
  )
}

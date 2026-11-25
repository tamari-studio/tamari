# Floorplan

A floor plan editor for an event or venue: draw stands and areas to scale, place exhibitors on stands, see what is still free, and export the plan.

## Who uses it

Organisers and venue managers who sell or assign stands. Several people may edit the same plan, one save at a time.
Everyone who can open the space can edit; the space has no roles of its own.

## Views

### Floor plan
- Header: plan picker and a New plan button, the save state ("Saved on a date by a name" or "Unsaved changes"), Undo, Redo, History, Export and Save, and layer buttons (All, 1, 2, 3).
- Left panel: the plan's stand sizes (drag one onto the plan, or click to add it at the nearest free spot), an area, a round table and a cover patch that hides the background image. Below them, a "Waiting for a stand" list of confirmed exhibitors with no stand on this plan, with a filter box.
- Canvas: the plan drawn in metres on a half-metre grid, with an optional background image. Zoom with buttons or the wheel, pan with Space or the right mouse button, and a button to show the whole plan. A stand shows its label, size and exhibitor name; text is dropped when zoomed out, never cut off.
- Right panel: for one object, its label, width, depth, colour, shape, layer, lock and exhibitor (searchable), with Rotate and Delete. For several, a count, a layer choice, Copy and Delete. For none, the totals (stands, stands with an exhibitor, area taken, area free) and a short how-it-works.
- A person can drag, nudge with the arrow keys, rotate, copy, paste, box-select, undo, redo, save, open history and export. Locked objects do not move or delete until unlocked. Stands that overlap by more than a few centimetres are outlined; stands that only touch are fine. A stand label used twice gets a warning.
- Export builds a printable PDF in the browser: the plan with its background on one landscape page, then a list of every stand (label, exhibitor or "Available", size in metres and square metres) sorted by label, over as many pages as needed. A CSV of the same list is welcome. Export needs no server call.
- Loading: a skeleton of the toolbar and canvas. Empty (no plan): "No plan yet" with name, width and depth fields and a Create plan button. Error: a message that the plan could not be opened, the reason, and Try again.
- Unsaved changes stay in this browser, come back after a reload with a notice, and leaving the page warns. If someone saved first, a dialog offers "Take theirs" (your changes are dropped) or "Overwrite with mine". A failed save shows the reason, keeps the draft and leaves Save enabled.
- History dialog: every saved version with its number, time and author. Opening a version puts it on screen as an unsaved change: Save makes it the current plan, Undo returns to what was there. Empty: a line saying nothing has been saved yet and the first save starts the list.

### Exhibitors
- A table with name, status, wanted area, its stand labels grouped by plan, and a note, with a filter box and a status filter.
- A person can add, edit and remove one exhibitor, add several by pasting one name per line, and, only when the source connector is set, press Import.
- Loading: skeleton rows. Empty: "No exhibitors yet" with Add exhibitor and Add several. Error: what failed and Try again. Removing an exhibitor that holds a stand is refused with the plan and stand named.

## Widgets

- Stands filled: "placed of total" stands with an exhibitor, as a number and a thin bar. Drop the bar, then the free area, then the label as the box shrinks; at 2x2 only the number and "filled".
- Waiting for a stand: the count of confirmed exhibitors with no stand on that plan, then as many names as fit with "+N more". At 2x2 only the count. Empty: "Everyone has a stand".
- Both read the most recently saved plan. Neither scrolls; both show a plain sentence if the data cannot load.

## Data

Rows live in shared records. A field added later gets a default, and a row read without it uses that default, so old rows still load. A row or object that fails its checks on read is left out and logged, not shown broken. The plan keeps a `schema` number (whole, default 1); when its shape changes, upgrade old plans on read and write the new shape on the next save.

- `floorplan-plans`. Key: the plan name as lower-case letters, digits and hyphens, 1 to 40 characters. At most 20 plans.
  - name: free text, required, 1 to 80. width, depth: numbers in metres, required, 10 to 1000.
  - backgroundFile: optional file name in the space folder (letters, digits, dash, dot, underscore, ending in png, jpg, webp or svg, up to 80), default empty.
  - sizes: up to 12 stand sizes, each width and depth from 0.5 to 200 metres, default a starter list of three.
  - objects: up to 600, each with id (text up to 40, unique in the plan, required), kind (stand, area or cover, required), label (free text up to 80, default empty), x and y (metres, kept inside the plan), w and h (metres, 0.5 to 200), color (six-digit hex, default by kind), shape (rect, round or pentagon, default rect), layer (1, 2 or 3, default 1), locked (true or false, default false), exhibitorKey (stands only, an existing exhibitor key, default none).
  - version (whole number, set by the server, one more per save), updatedAt and updatedBy (set by the server from the caller), schema.
- `floorplan-exhibitors`. Key: a prefix of x- and random text for typed rows, or src- and a safe source id (letters, digits, hyphen, up to 60) for imported rows. At most 500 rows.
  - name: free text, required, 1 to 80. status: prospect, confirmed or withdrawn, default prospect. wantedArea: square metres, 1 to 5000, optional.
  - note: free text up to 500, default empty. source: own or import, default own.
- `floorplan-history`. Key: the plan key, then -v and the version as six digits. The value is the whole plan as saved. Every save adds one; the list shows the newest 50, and after a save the oldest beyond 200 per plan are removed. A failure writing or pruning it never fails the save.

## Server functions

Each starts with `requireCaller()` and validates every argument; messages are plain sentences with no tokens or upstream bodies.
- `listPlans()`: keys, names, versions and save times.
- `createPlan(input)`: name, width, depth checked as above; refuses a taken key and a 21st plan.
- `loadPlan(key)`: key must match the key pattern; returns the plan (upgraded if old), exhibitors, and whether import is available.
- `savePlan(key, draft, baseVersion)`: baseVersion is a whole number; draft objects are checked one by one (kind, bounds, label length, colour, shape, layer, unique id, at most 600). Positions are clamped onto the plan; anything else invalid refuses the save with the first problem named. Every exhibitorKey must exist. If the stored version is not baseVersion, return a conflict with the stored plan and write nothing. The store's put is unconditional, so two saves in the same instant can both pass; checking the version just before writing narrows that window but does not close it. Set version, updatedAt and updatedBy on the server and ignore the browser's values.
- `removePlan(key)`: removes the plan and its history.
- `listVersions(key)`, `getVersion(key, version)`: key pattern and a whole number of zero or more; an unknown version returns nothing.
- `listExhibitors()`, `saveExhibitor(input)`, `addExhibitors(names)`: lengths, status and area as above; at most 100 names per call, blank lines skipped; refuses past 500 rows.
- `removeExhibitor(key)`: refuses while any stand on any plan uses it.
- `importExhibitors()`: refuses when the connector is unset; maps each source row to a checked exhibitor, adds or updates src- rows only, never touches typed rows, and returns counts.

## Connectors

- `FLOORPLAN_EXHIBITOR_SOURCE_URL` and `FLOORPLAN_EXHIBITOR_SOURCE_TOKEN`: where to read an exhibitor list kept elsewhere, for instance a spreadsheet or database service. The coding agent writes a small adapter that returns name, status and wanted area. Without them the Import button is hidden and exhibitors are typed or pasted; nothing else changes.
- No AI key is needed. Writing stand labels back to the source is not part of the first version.

## Acceptance checks

1. Given no plans exist, when the view opens, then the empty state shows with name, width and depth fields.
2. Given a plan is open, when I drop a stand size on it, then the stand snaps to the half-metre grid; when I add one by click, then it takes the nearest free spot.
3. Given two stands overlap by half a metre, when the plan is shown, then both are outlined; given two stands only touch, when it is shown, then neither is.
4. Given a confirmed exhibitor has no stand on the open plan, when the plan opens, then it is in the waiting list; when I place it on a stand, then it leaves the list.
5. Given I have unsaved changes, when I reload the page, then they come back with a notice, and Undo returns to the saved plan.
6. Given I loaded version 7 and someone else saved version 8, when I press Save, then a conflict dialog appears and nothing is overwritten until I choose.
7. Given a save succeeds, when I open History, then the new version is listed, one higher than before; when I open an older one, then it appears as an unsaved change.
8. Given a draft has a label of 81 characters, when I save, then the save is refused with a message that names the label and its limit, and nothing is stored.
9. Given a draft has a stand of width 0, an unknown kind or a missing exhibitor key, when I save, then the save is refused and the message names the problem.
10. Given a stand lies partly off the plan, when I save, then it is stored at the nearest edge and not dropped.
11. Given the store fails, when I press Save, then the reason shows, the draft stays on screen and in the browser, and Save stays enabled.
12. Given the plan cannot be loaded, when the view opens, then the error state shows the reason and Try again; when I press it and the store works, then the plan loads.
13. Given no source connector is set, when I open Exhibitors, then Import is hidden and every other action works.
14. Given a plan with stands, when I press Export, then a PDF holds the plan on one page and a list sorted by label (label, exhibitor or "Available", size); given export fails, when it ends, then a message shows and my edits remain.

## Out of scope

Several floors in one plan, roles or per-person permissions, live co-editing, writing labels back to the exhibitor source, logos on stands, pricing and invoices, a public visitor map, and importing a drawing file as editable objects.

Build it with your coding agent: read README.md ("Rules for space code") and docs/space-design.md first, copy .miso/ui/kit.tsx and use its components.

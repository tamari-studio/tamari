# Designing views and widgets

How a space's views and widgets look and behave, so every space feels like part of one app. Read it
before you write or change a file in `.miso/views/`, `.miso/widgets/` or `.miso/ui/`. The short
version is in `AGENTS.md` under "Design of views and widgets"; this file has the reasons and the
judgement calls. `cli/space-design.test.ts` checks the rules a machine can check.

## The building blocks

- **Tailwind with the app's theme tokens.** No custom CSS files, no `@apply`, and no `dark:`
  colour overrides in code you write: the tokens already switch with the theme (a shadcn component
  copied into `.miso/ui/` keeps its own). Use `style={{}}` only for computed values
  (chart geometry, a progress width, a colour that comes from the data).
- **The kit.** Every starter template has `.miso/ui/kit.tsx` (`Page`, `Button`, `Field`,
  `inputClass`, `Badge`, `Card`, `Empty`, `Problem`, `Tile`, `TileRow`, `useRows`, `cx`). Copy it
  into a new space and use it before you write your own control. Space code can't import the app's
  own components in `app/client/ui/`.
- **Icons: Tabler only** (`@tabler/icons-react`). No other icon pack and no hand-drawn `<svg>`
  icons. Set the stroke: `1.75` at 12 to 16 px, `1.5` at 18 to 24 px. Don't put an icon on every
  label; use one where it names a familiar action or helps people scan.
- **Conditional classes** with `cx()` from the kit, never with template-literal ternaries.
- **Runtime helpers** come from `import { focusTab, fileUrl, apiFetch, canOpen } from 'miso'`.

## Colour and surfaces

| Intent | Classes |
| --- | --- |
| Main content | `text-foreground` |
| Supporting content | `text-muted-foreground` |
| A distinct work region | `bg-card text-card-foreground` |
| Quiet fill (insets, skeletons) | `bg-muted` |
| Hover, active, selected | `bg-accent text-accent-foreground` |
| Main action | `bg-primary text-primary-foreground hover:bg-primary/90` |
| Success, error | `text-success`, `bg-success/10`, `text-destructive`, `bg-destructive/10`, always with words too |
| Outline of an object or control | `ring-1 ring-border` (or `border`) |
| Separator | a one-sided border, `border-b border-border` |
| Focus | `focus-visible:ring-2 focus-visible:ring-ring` |
| Menus, popovers | `bg-popover text-popover-foreground` |

Use more colours only when they mean something: data series, a brand, an image, a status the
reader learns. Keep a mapping the same everywhere it appears. Never let colour carry meaning alone.

Optional texture on a root, never stacked: `texture-checker`, `texture-grid`, `texture-noise`,
`texture-gradient-linear`, `texture-inset-shadow`. Behind dense content, use plain `bg-background`
or one of the last two.

Use the radius scale and the kit's shapes. `rounded-full` is for pills, avatars and status dots,
not for rectangular buttons.

## Typography and spacing

- Inherit the app font. Sentence case everywhere.
- `text-sm` for controls and general UI, `text-base` for focused reading, larger only for a heading
  or one focal value. `text-xs` for metadata only.
- Regular weight for text, `font-medium` for emphasis. No other weights.
- `font-mono` only for code, commands and code-like ids. Numbers, dates and prices use the app
  font, with `tabular-nums` when they line up in columns.
- Spacing on the 4 px scale: small gaps inside a group, larger gaps between groups. Use `gap-*`,
  not margins between siblings. Apply outer padding once.

## Layout

- **Lead with what people came for.** The main information or action is the first thing they see.
- **Group with space and alignment, not boxes.** Headings, summaries, metrics and sections stay
  unboxed. Use a surface only for something interactive, a region that scrolls on its own, a
  distinct state or a work area. No cards inside cards, no rows of decorative cards.
- **Sparse is fine.** Free room is not a reason to add a metric, a chart or an explanation.
- No horizontal page scrolling. Wide content (a table, a board) scrolls inside its own region.

## Widgets

A widget is for a glance or one quick action. Deeper work goes in a view.

- **The tile is the host's.** The grid draws each widget in a tile that is already
  `rounded-xl bg-background shadow-sm overflow-hidden`. The widget's root is `h-full w-full`
  (or `size-full`) with no outer `rounded-*`, `shadow-*` or `border`. It may set its own
  background (`bg-card`, a texture) if it paints the whole tile.
- **People resize widgets freely.** The grid has 14 fine columns (a viewer can narrow it to 10, 6
  or 4), cells of at least 56 px (88 px on a phone) with 8 px gaps, and a widget is at least 2×2
  cells, so the smallest one is roughly 120 px square. A new widget starts at 2×2 wherever there is
  room. `colSpan` and `rowSpan` in `config` don't promise a size.
- **A widget never scrolls and nothing in it is cut off.** No `overflow-auto` or
  `overflow-y-auto` in a widget. When the content doesn't fit, show less or show it differently:
  fewer rows (with a "+N more" line when it helps), secondary text dropped in small boxes, a row of
  stats folded into a list when narrow, a headline number scaled with the box. Truncating one line
  with an ellipsis is fine; text running off the bottom is not.
- **How to fit:** make the root `overflow-hidden` and a size container
  (`[container-type:size]`), then use `@container` queries or `cqw`/`cqh` units in its children
  (put padding on an inner element, because a container's units don't measure itself). For a list,
  `flex flex-col flex-wrap content-start overflow-hidden` with full-width rows shows only the rows
  that fit: the rest wrap into a column that the clip hides
  (`workspaces/miso/.miso/ui/activity-list.tsx`).
- Keep hover feedback on controls; the tile itself doesn't change on hover.

## Views

A view is one screen for sustained work. It owns its layout, padding and scrolling.

- Start from the kit's `Page` (a slim header with a title, a count and actions, then the content).
- One main scroller. Add a second scroll region only when two parts need their own positions.
- Tabs, filters and master-detail inside a view are fine. Moving between screens is the app's job:
  no client-side router; open another tab with `focusTab`.
- Adapt to narrow widths and long content.

## States

Show every state the space can reach, in the same place and size as the content:

- **Loading:** a skeleton in the shape of the content (`bg-muted`), a spinner only for small or
  shapeless work.
- **Empty:** say why it's empty and offer the next step (the kit's `Empty`).
- **Error:** say what went wrong and how to recover, plainly (the kit's `Problem`). Never show a
  token or a raw upstream response.
- **Refreshing:** keep the old content visible; show progress next to the refresh action.
- **Disabled:** keep the control recognisable and make clear why it's unavailable.

Motion is short, explains a change and respects reduced motion. No looping decoration, no
animation on numbers that change often.

## Words

- Write for the person using it, not for how the system is built. Plain, specific, active.
- A button says what happens ("Save changes", not "Submit"), and the confirmation uses the same
  word ("Published" after "Publish").
- Errors don't apologise and are never vague. An empty state invites the next step.
- Sentence case. No full stop after headings, labels or short single lines.

## Design slop to avoid

Habits that make a screen look generic or agent-made:

- Short coloured lines or a single coloured edge beside a heading or value as decoration.
- The SaaS card kit: unrelated sections turned into identical rounded boxes with the same border
  and shadow.
- Template chrome: all-caps eyebrows, middle-dot metadata, `LABEL — fragment` headings, monospace
  labels, an arrow on every action.

## Before you call it done

1. **Focus:** what do people notice first, and what can they do next? Remove competing emphasis.
2. **Subtract:** take away secondary groups, helper text, badges, icons and wrappers one by one.
   Put back only what leaves a real gap.
3. **Deduplicate:** read all the visible words together; when two say the same thing, keep the one
   closest to its action.
4. **Unify:** the same role gets the same text style and control variant everywhere.
5. **Check it running** under `bun run dev`: real content, a narrow width, every state, keyboard
   use, and for a widget the smallest size (2×2) and how it sits next to other widgets.

# Tamari

Instructions for coding agents that build spaces or change the shell. `README.md` explains what
Tamari is; `docs/spaces.md` explains how spaces, views, widgets and server functions work. Read it
before you build a space.

The product is called Tamari; it was called miso. The `miso` command, the `.miso/` folders, the
`@miso/*` packages, `MISO_*` variables, the `miso` schema and the `miso` space folder keep the old
name.

## Rules

- Build features as spaces: views, widgets and `*.server.ts` files in `workspaces/<space>/.miso/`.
  Change `app/` only for the shell itself (sidebar, tabs, grid, pages, build, API).
- Put data access in server functions, never in view code, so the browser never sees secrets.
  Validate every argument a server function gets, because it comes from the browser.
- Never commit a `.env`. Secrets for space code go on the Connectors page.
- A schema change is a new file in `supabase/migrations/`. Never edit a migration that has run on a
  database. Every table gets row level security. A migration only adds (no drops or renames),
  because an org's database doesn't roll back with the shell (`docs/org-repos.md`).
- New logic gets a small `*.test.ts` next to it.
- Before you say something works, run `bun run typecheck`, `bun run test` and `bun run build`. For
  UI changes, also open it under `bun run dev`.

## Design of views and widgets

Before you write or change a view, widget or `.miso/ui/` file, read `docs/space-design.md`. It has
the reasons, the colour table, states, words and the review to do before you call it done. The
rules that always apply:

- Tailwind with the theme tokens (`bg-background`, `text-muted-foreground`, `bg-primary`, …). No
  custom CSS, no `@apply`, no `dark:` overrides in your own code. `style={{}}` only for computed
  values.
- Start from the kit in `.miso/ui/kit.tsx` (copy it from `template/spaces/<any>/.miso/ui/`):
  `Page`, `Button`, `Field`, `Badge`, `Empty`, `Problem`, `Tile`. Space code can't import `app/`.
- Icons from `@tabler/icons-react` only, with `stroke={1.75}` at 12 to 16 px and `1.5` above.
- Sentence case. `text-sm` for UI, `font-medium` for emphasis, no other weights. `font-mono` only
  for code. Spacing on the 4 px scale with `gap-*`.
- Group with space and alignment, not boxes: no cards inside cards, no decorative rows of cards.
- A widget's root is `h-full w-full` with no outer `rounded-*`, `shadow-*` or `border`: the grid's
  tile already has them. People resize widgets freely down to about 120 px square.
- A widget never scrolls and nothing in it is cut off: no `overflow-auto` in a widget. Show fewer
  rows or less detail when the box is small.
- A view owns its padding and its one main scroller, and has no router of its own.
- Every reachable state is designed: loading (a skeleton), empty (with the next step), error (what
  went wrong and how to recover).
- Check it under `bun run dev` at a narrow width and, for a widget, at 2×2.

`cli/space-design.test.ts` fails on another icon pack or a scrolling widget.


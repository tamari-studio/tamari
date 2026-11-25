# Templates

Starting points for a new Tamari team. Nothing here is in the app until you add it.

Tamari was called miso. The `miso` command, the `.miso/` folders, the `@miso/*` packages and the
database schema keep that name.

| Folder | What it is |
|--------|------------|
| `spaces/<type>/` | A starter space for one kind of team: one page, one widget, example rows |
| `vault-starters/<type>/` | Five notes for that team's vault: how we work, glossary, decision log, a note template and a map |
| `vault/` | A blank vault (see `vault/README.md`) |

## The starter templates

| Type | Space | The job it does |
|------|-------|-----------------|
| `agency` | **Clients** | A client list with status, owner and next step. Overdue steps are marked. Widget: **Next steps** |
| `startup` | **Monthly update** | Revenue, customers, cash and spend per month, and the investor update written from them, ready to copy into an email. Widget: **Latest month** |
| `events` | **Run of show** | The plan for the event day: what happens when, where and who is on it, ticked off as it happens. Widget: **Up next** |
| `gtm` | **Pipeline** | A sales board: every deal in its stage with a value, an owner and a next step. Widget: **Open deals** |
| `product` | **Roadmap** | What customers and colleagues ask for, counted, and what becomes of it: new, planned, in progress, shipped. Widget: **New requests** |
| `writer` | **Writer** | Style guides (the voices you write in) and drafts. With `WRITER_AI_KEY` set on the **Connectors** page it drafts an article from your notes; without it you write and keep drafts by hand. Widget: **Latest drafts** |
| `email-check` | **Email check** | A contact list where every address is checked (syntax, throwaway domains, shared inboxes, mail server): safe to send to, check first, or don't send. Widget: **List health** |

## Add one

In a clone of this repo:

```sh
bun cli/miso.ts template list
bun cli/miso.ts template add agency
```

In an org repo (`docs/org-repos.md`), with the `miso` command:

```sh
miso template add agency
```

`add` does two things: it copies `template/spaces/<type>/` next to your other spaces
(`workspaces/<type>/` in a clone, `.miso/spaces/<type>/` in an org repo) and adds one entry to
`spaces.json`. Its address comes from the space's name (`startup` opens at `/monthly-update`), or
from `--as`. It does not touch a database: a template keeps its rows in shared records
(`@miso/store`), so there is no migration.

- `--as <folder>` adds it under another folder name, for example
  `miso template add agency --as key-accounts`. The folder name is also the id and the address
  (`/key-accounts`).
- `--vault <folder>` also copies the vault notes into that vault folder, for example
  `miso template add agency --vault ../my-vault`.
- It never overwrites. If the space folder exists, it stops and changes nothing. A vault note
  that is already there is kept and listed.

Then:

1. In a clone under `bun run dev`, reload the page. In an org repo, commit `.miso/spaces` and run
   `miso install` (or push, when the app is deployed from the repo).
2. The space is last in the sidebar. Open it and select **Try it with examples**.
3. Add its widget on the **Widgets** tab with **Edit widgets**.
4. When you have added rows of your own, select **Remove examples**.

You can add more than one template. Each keeps its rows in its own collection. More spaces, some of them blueprints your coding agent builds, are in `community/`
(`community/README.md`).

## After you add it, the space is yours

The copy has no link back to this folder. Change the fields, the wording and the look to fit
your team. Each space has the same parts:

```
.miso/
  views/<page>.tsx          the page
  widgets/<widget>.tsx      the widget
  lib/<rows>.ts             what a row holds, the check on every field, the sums, the examples
  lib/<rows>.server.ts      server functions: every one needs a signed-in member and checks its arguments
  lib/rows.ts, lib/check.ts shared-records list and the field checks (the same in every template)
  ui/kit.tsx                page, buttons, fields, badges, empty state, widget tile (the same in every template)
  lib/*.test.ts             tests: run them with `bun test ./workspaces/<folder>/.miso/lib/`
```

To add a field: add it to the type and the `parse…` function in `lib/<rows>.ts`, then to the form
and the row in the view. Rows saved before the change are checked again when they are read, and a
row that does not pass is left out of the list, so give a new field a default in `parse…`.

Everyone who can see the space can read and change its rows. To limit who sees it, use the
**Space access** page.

## The vault notes

Each starter has five notes in the vault's own folders and note schema
(`vault/00-Inbox/frontmatter.md`):

- `03-Areas/how-we-work.md`: the team's rhythm and who decides what.
- `04-Resources/<...>-template.md`: a note to copy for each client, event, deal or feature.
- `06-Wiki/glossary.md` and `06-Wiki/decision-log.md`.
- `07-Maps/Team.md`: the map that links them. Link it from `07-Maps/Home.md`.

Every line in them is an invented starting point. Change each one until it is true for your team.

## Add a template to this folder

1. Make `spaces/<type>/` with a `template.json` (`title`, `space`, `job`) and a `.miso/` folder in
   the shape above. Copy `lib/check.ts`, `lib/rows.ts`, their tests and `ui/kit.tsx` from another
   template without changes. Name the collection `<type>-…`. `job` is the one line the app's
   sample-space picker shows. `image` names a picture next to `template.json` (`preview.webp` or
   `preview.png`, 4:3, at most about 100 KB): the picker shows it, and it is never copied into the
   space. Without one the picker shows an icon.
2. Make `vault-starters/<type>/` with three to five notes and a `07-Maps/` map that links them.
3. Add the type to `TYPES` in `cli/template.test.ts`. `bun run test` then runs the template's own
   tests, type-checks it (`template/tsconfig.json`) and installs it into a temporary folder to
   check its shape.

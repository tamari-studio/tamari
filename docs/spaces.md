# Build a space

How spaces, views, widgets and server functions work, and the spaces Tamari ships. Read
[space-design.md](space-design.md) before you build a view or widget.

## Add a space

1. Make the folder `workspaces/<folder>/.miso/views/`.
2. Add a file `<name>.tsx` in that folder. The file must have a default export: a React component.
3. Add `{ "folder": "<folder>", "id": "<folder>", "slug": "<url-name>" }` to `spaces.json`.
4. Optional: add `workspaces/<folder>/.miso/.workspace.json` with `{ "name": "Display name" }`.
   The sidebar icon is a Tabler line icon: add `<folder>: Icon<Name>` to `SPACE_ICONS` in
   `app/client/lib/icons.tsx`. Without an entry, the space gets a folder icon.
5. Reload the page. The app rebuilds in about one second, and the space shows in the sidebar.

Do not change the `id` of a space after you add it. Tabs and dashboards use the `id`.

```
workspaces/<folder>/.miso/
  .workspace.json        the name of the space (and a theme, which the app no longer uses)
  views/<name>.tsx       a view: a full page in a tab
  widgets/<name>.tsx     a widget: a card on the Widgets tab
  lib/<name>.server.ts   server functions: they read and write data
  package.json           optional: packages that only this space uses
```

### A space without code

An admin or owner can also add a space in the app: in **Settings → Organisation**, type a name
below the list of spaces, pick an icon if you like, then select **Add space**. The space shows in
the sidebar at the end, with no tabs. Open views from any space in it with the **+** button, and add
subspaces under it like under any space. It has no folder and no code of its own, so views in it
run as this space: they use its connectors and save shared data on it. Everyone sees it until you
set a rule on the **Space access** page. Its address comes from its name (`/design`). The app
can't delete it yet. If a later `spaces.json` entry takes the same slug, the space gets a new
address (`/freed-…`); rename the entry or pick another slug to avoid that.

### Subspaces (owners only, for now)

A space can hold subspaces: a second level for a big team, such as **Data / Hiring** and
**Data / Reporting**. A subspace is not a folder in `workspaces/`. An owner makes it in the app:
select the arrow next to a space in the sidebar, then **New subspace**. Each subspace has its own
tabs and widgets. It can open any view, also a view that is already a tab in its parent or in
another subspace. Its address is the parent's slug and its name (`/data-hiring`). Rename it,
give it an icon or delete it in **Settings → Organisation**. Views in a subspace run as the parent: they use the
parent's connectors and save shared data on the parent. When you delete a subspace, only its tabs
and widget layout go.

Only owners see subspaces. The database enforces this (`miso.sees_space`), so a Space access
rule does not open a subspace to other people yet.

### Rules for space code

- **View**: a `.tsx` file directly in `views/` with a default export. The file name is the id:
  `views/items.tsx` is `view:<folder>/items`. Optional: `export const config = { title, icon, minTier }`.
- **Widget**: the same in `widgets/`, with an optional `export const config = { title, icon }`.
  A new widget starts at 2×2 grid cells and people resize it, so it must fill its tile
  (`h-full w-full`) and fit at any size without scrolling.
- **Helper file**: a file name that starts with `_` (`views/_table.tsx`) is not a view.
- **Server function**: an exported `async` function in a `*.server.ts` file. A view imports it
  (`import { listItems } from '../lib/items.server'`), and the call runs on the server. The
  arguments come from the browser, so check them. The message of an error it throws is shown to
  the person (up to 500 characters), so never put a token or an upstream response body in it.
- **In server code**:
  - `import { requireCaller } from '@miso/caller'` gives the person who uses the app.
  - `import { collection } from '@miso/store'` gives shared records
    (`collection('name').put(key, data)`, `.list()`). The **Data map** page shows what the workspace holds and which spaces use it.
  - `process.env.X` reads a key. Add keys on the **Connectors** page. Read it inside the
    function, not at the top of the file: the file loads once, so a top-level read keeps the
    values of the first call.
- **In a view**: `import { focusTab, fileUrl } from 'miso'` opens another tab or links a file in
  the space folder.
- **Styling**: Tailwind with the theme tokens of the app (`bg-card`, `text-muted-foreground`,
  `bg-primary`), Tabler icons and the kit in `.miso/ui/kit.tsx`. Read
  [space-design.md](space-design.md) before you build a view or widget.

## Version history and activity

The database keeps every change to a shared record, so a space needs no code of its own for
history. A trigger on `miso.records` writes one row per change to `miso.change_history`: when, who,
which space, a version number per record, and the record's data after the change. Saving the same
data again writes nothing.

In a `*.server.ts` file:

```ts
const plans = collection<Plan>('floor-plans')
const versions = await plans.history('2027', { limit: 20 }) // newest first: version, at, who, action, data
await plans.restore('2027', versions[1].version)             // writes that data back as a new version
```

- `who` is the member who used the app (`{ id, name, automatic }`). `automatic` is true for a
  change with no member behind it, such as a scheduled job. Space code never gets an email.
- `action` is `insert`, `update`, `delete` or `snapshot`. A `delete` version holds the data that
  was removed, so restoring it brings the record back. A `snapshot` is what a record held before
  history started.
- History is as global as records are: check who may see or restore a record in your server
  function.

The **Activity** page and the **Recent activity** widget in the Tamari space (folder `miso`) show the same rows as a
feed: who changed what, in which space, grouped by day. The feed also holds views opened, closed or
moved as tabs, and spaces added, renamed or deleted. It does not hold dashboard changes, tab order,
connectors, space access or roles. Everyone sees only the spaces they have access to, and names but
no emails. The feed is `GET /api/history` (`?space=<id>`, `?before=<id>` for the next page,
`?limit=` up to 100); a view reads it with `apiFetch` from `miso`.

The app keeps history for 400 days and at most the newest 200 versions of one record. A big record
that is saved often still takes space: each version is a full copy.

## The Vault space

The **vault** space shows a notes vault: a git repo of Markdown notes, with Claude Code skills in
`.claude/skills/`. Its **Vault overview** page lists the folders and notes, and **Skills** lists the
skills and their `/commands`. People read notes in Tamari and propose changes there; see
[Reading and changing notes without git](#reading-and-changing-notes-without-git).

To connect a vault, open the **Connectors** page and add a Custom connector with `VAULT_REPO`
(`owner/name`) and `VAULT_TOKEN` (a GitHub token that can read that repo's contents; for
proposals it also needs to write contents and pull requests). Optional: `VAULT_REF` for a branch
other than the default. The space is off by default: to turn it on, add
`{ "folder": "vault", "id": "vault", "slug": "vault" }` to `spaces.json`.

No vault yet? `template/vault/` is a blank one: PARA folders, Maps of Content, a note schema and
three Claude Code skills. Copy it into a new private repo (steps in `template/vault/README.md`),
then connect that repo as above.

### Reading and changing notes without git

A member needs no GitHub account and no access to the repo: the space reads the vault with
`VAULT_TOKEN` on the server.

- **Read.** Selecting a note in **Vault overview** opens it in Tamari as formatted text, with its
  frontmatter as a short list of properties. HTML in a note is shown as text and never runs, images
  become links, and a link to another note opens that note.
- **Find.** The **Find a note** box filters by name and folder as you type. **Search inside
  notes** also looks in the text, through GitHub's code search. That search only covers the
  repo's default branch, so with `VAULT_REF` set only names are searched.
- **Propose.** **Suggest a change** on a note, or **New note**, opens a plain Markdown editor.
  The member adds one line on why and sends it. The proposal becomes a **pull request** on the
  vault repo: a branch `miso/<member id>/<proposal id>` with one commit, into the vault's branch.
  The title and body name the member who proposed it (the signed-in caller, as the server knows
  them) and give the reason. If the note changed on GitHub after the member opened it, nothing is
  proposed and Tamari says so; GitHub itself also refuses to save over another version.
- **Review.** Developers review and merge proposals on GitHub, like code. Tamari has no approve
  button and no admin step. The **Proposals** view lists them with their state on GitHub (open,
  merged, closed), a link to the pull request and a line-by-line comparison of the old and the new
  text. The member who made a proposal can **withdraw** it while it is open, which closes the pull
  request and deletes its branch.

GitHub is the only place a proposal is kept. Its state and its proposer are read from the pull
request each time; the proposer comes from the branch name and a marker the server writes on the
first line of the body, which members cannot change. Pull requests that Tamari did not open, or
that come from a fork, are not listed.

Proposals need a token that can write contents and open pull requests: "Contents: Read and write"
and "Pull requests: Read and write" for a fine-grained token, or the `repo` scope for a classic
one. With a read-only token, reading works and proposing says which access is missing.

Limits: a note path is a relative `.md` path with no dot folders, a note is at most 200 kB, and
one member has at most 20 open proposals. The list shows the newest 100 open and the newest 100
merged or closed.

Server functions for an assistant or another space, in `workspaces/vault/.miso/lib/notes.server.ts`:
`listNotes()`, `readNote(path)`, `searchNotes(query)` and `proposeChange({ path, content, reason, baseSha })`.

## Starter templates

A new install has one space. `template/spaces/` holds a first space for seven kinds of team, each
with one page, one widget and example rows you can load and remove:

| Type | Space | What it does |
|------|-------|--------------|
| `agency` | Clients | A client list with status, owner and next step |
| `startup` | Monthly update | The month's numbers and the investor update written from them |
| `events` | Run of show | The plan for the event day, ticked off as it happens |
| `gtm` | Pipeline | A sales board with a value and a next step per deal |
| `product` | Roadmap | What people ask for, and what becomes of it |
| `writer` | Writer | Style guides and drafts, and an AI draft from your notes once you add `WRITER_AI_KEY` |
| `email-check` | Email check | A contact list where every address is checked: safe to send to, check first, or don't send |

```sh
bun cli/miso.ts template list
bun cli/miso.ts template add agency          # in an org repo: miso template add agency
```

`add` copies the space into `workspaces/` and adds it to `spaces.json`. It never overwrites a
folder, and it needs no migration: the rows are shared records. Use `--as <folder>` for another
folder name and `--vault <folder>` to also copy five starter notes (how we work, glossary,
decision log) into a vault. After that the space is yours to change. Details are in
[template/README.md](../template/README.md).

### Community spaces

`community/` holds more spaces, cleaned of everything that belonged to the team they came from:
three that work (`email-checker`, `pr-writer`, `newsletter`) and eight blueprints, an empty draft
plus a `SPACE.md` spec that your own coding agent builds over MCP (`floorplan`, `my-day`,
`roadmap`, `outreach`, `kpi-board`, `budget`, `handbook`, `funding`).

```sh
bun cli/miso.ts template list --community
bun cli/miso.ts template add email-checker --community
```

See [community/README.md](../community/README.md).

## Connect your AI

A member can let their own AI tool read the workspace as themselves. The app is a
[Model Context Protocol](https://modelcontextprotocol.io) (MCP) server at `/api/mcp`, so any tool
that speaks MCP over HTTP and can send a header connects to it.

1. Open **Settings**, the **Personal** tab, and find **Connect your AI**.
2. Type a name for the tool and select **Make token**. Copy the token now: the app shows it once
   and keeps only a hash of it.
3. Give your tool the address and the token. For Claude Code, with the address you open Tamari
   at (`http://localhost:13390` for a Docker install with the default address,
   `http://localhost:13380` under `bun run dev`):

   ```sh
   claude mcp add --transport http tamari http://localhost:13390/api/mcp \
     --header "Authorization: Bearer <your token>"
   ```

   Then type `/mcp` in Claude Code to check that `tamari` is connected.

The tool sees what that member sees and nothing more: a token carries the member's role and space
access, and it stops working when the token is deleted on **Settings**, or when the member is
suspended or removed. A token only opens `/api/mcp`. It does not sign anyone in to the app.

| Tool | What it does |
| --- | --- |
| `list_spaces`, `get_space` | The spaces the member sees, with their views, widgets, open tabs and subspaces. |
| `list_collections`, `list_records`, `get_record`, `search_records` | Shared records (the **Data** page), under the same row level security as the app. `search_records` is full-text over every collection. |
| `list_notes`, `read_note`, `search_notes` | The notes of the vault, through the Vault space's own server functions. |
| `propose_note_change` | Proposes new text for a note as a pull request on the vault's repo, in the member's name. Nothing changes until a developer merges it. |

### Changing spaces (the Compose install only)

On a self-hosted Tamari (`selfhost/`), the spaces are a volume with git inside, and the AI can also
build spaces. These tools exist only there:

| Tool | What it does |
| --- | --- |
| `list_space_files`, `read_space_file` | A space's code: the files in its `.miso/` folder, without dot files or `node_modules`. Any member, in a space they see. |
| `get_design_rules` | `docs/space-design.md`, the design guide for views and widgets. The server's MCP instructions also carry the short rules from `AGENTS.md`. |
| `change_space_files` | Writes and deletes files of one space in one change. The app builds it and keeps it (one commit, with the summary as its message and the member as its author) only when the build passes; otherwise every file goes back and the tool returns the build's errors. A member who changes a space that isn't their own draft changes their own draft copy of it (below). |
| `create_space` | A new space: its folder with its name and the UI kit, and its place in the sidebar. A member's new space is a draft (below). |
| `delete_draft_space` | Deletes one of your own draft spaces or draft copies, and withdraws its proposal. |
| `submit_proposal` | Sends one of your drafts to the admins: a draft copy as a change to its space, a draft space to be shared with your teams or everyone. |
| `edit_tabs`, `edit_layout` | A space's tabs and its widget grid, through the same checks as in the app. |

The tools that change something need a token made with **May change spaces** on (any member can
make one; it can't be turned on later). What the token's member may change is checked on every call:

- **An admin or owner** changes any of the company's spaces, live.
- **A member** makes **draft spaces** and changes only their own drafts, at most 3. A draft is
  listed in its author's sidebar only. Admins and owners may reach it by its address, and the app
  shows them a warning first, because opening it runs code nobody has reviewed. A draft's views and
  widgets work at once; its server functions (`*.server.ts`) run only once it is approved (the
  build decides which modules are unchanged, `app/server/drafts.ts`).
- **A member's change to a Team or Everyone space** they see goes into their own **draft copy** of
  it: a folder `<space>--draft-<6 hex>` with the space's code as its last commit had it, shown in
  their sidebar under the space. Its unchanged server functions run as the space's; changed ones
  don't. `submit_proposal` sends it; from then on it stays as it was sent. A draft space of their
  own is sent the same way, to be shared with their teams (an access rule with their teams, them and
  admins is written when it is approved) or everyone.
- **Proposals** (a page in the app): admins and owners read each proposal's changes as text,
  compared with the commit the copy started from, and approve or reject it with a reason. Approving
  copies the draft over the space in one change (one build, one commit with the member as its
  author) and removes the copy; if the space changed since the copy was made, the proposal is out of
  date and nothing is copied; if it doesn't build, nothing changes. "Open the draft" runs the
  member's code in the admin's browser, after the warning. Members see their own proposals and can
  withdraw one. A member has at most 3 drafts, copies included, so at most 3 open proposals
  (`app/server/proposals.ts`, `proposal-flow.ts`).

Tamari's own spaces can't be changed (each start puts them back as Tamari ships them), a path must
stay inside the space's `.miso/` folder, and every file must pass the design checks (Tabler icons
only, no scrolling widget). `selfhost/README.md`, "Spaces", has the history and how to undo.

**Packages.** A space may list npm packages in `.miso/package.json`. The app installs them before the
build, so a change that adds one is one build and one commit like any other, and an install that
fails puts the change back. The file has only `name`, `version`, `private`, `description` and
`dependencies`, each dependency a registry name with an exact version such as `1.2.3`, written as
`JSON.stringify(value, null, 2)` writes it. No ranges, `file:`, `link:`, `workspace:`, git or web
addresses, no scripts, `overrides`, `trustedDependencies` or `devDependencies`. Install scripts never
run, the packages' own dependencies resolve only to releases at least 3 days old, and the app keeps
the lockfile so a reinstall gets the same versions. A
member's draft gets nothing installed: a draft copy uses what its space has installed, and a package
the draft adds is installed when an admin approves the proposal (the review shows the
`package.json` change); until then, importing it builds but throws when the view loads
(`app/server/space-packages.ts`, `app/build/package-guard.ts`).

Every other tool reads, except `propose_note_change`, and that one only makes a proposal. Results are cut
to a bounded size, and a long note comes in pages. The note tools need a Vault space that has them;
on an older one they answer that the Vault space does not support this yet.

What does not work yet:

- **Claude on the web, desktop and phone, and ChatGPT** add a connector through a sign-in page
  (OAuth), and they connect from the internet. Tamari has tokens only, and is often not reachable from the
  internet. Both need a public address plus Supabase Auth's OAuth 2.1 server (`[auth.oauth_server]` in
  `supabase/config.toml`, off for now) and a consent page in the app.
- **A sign-in email can stop working.** The first tool call after the app starts opens a session for
  the token's member, which cancels a sign-in link that member was just sent and has not opened.
  They ask for a new link and it works.

The tokens live in `miso.ai_tokens` (migrations `20261123000300_ai_tokens.sql`, and `20261124000000_ai_token_edits_spaces.sql` for the switch). On a database
without that migration the Settings section says so, and `/api/mcp` answers 503.

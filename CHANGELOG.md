# Changelog

## v1.0.0 (2026-11-25)

v0.6.0 was never tagged: an org on v0.5.0 gets v0.6.0's changes and these with v1.0.0.

Nineteen migrations since v0.5.0; `miso update` applies them. None drops, renames or changes a
column's type. What isn't purely additive is named here:

- Function bodies replaced, same signatures: `app.app_user_guard_last_owner()`
  (`20261116000000_last_owner_lock`), `miso.welcome_self()` (`20261116000100_welcome_once`),
  `miso.sees_space()` (`20261116000200_subspaces`, then `20261124000100_draft_spaces`),
  `app.app_user_bootstrap()` (`20261123000000_invitations`, a new invite branch; the others are
  unchanged) and `miso.sync_spaces()` (`20261124000100_draft_spaces`, then
  `20261124000200_space_proposals`).
- A backfill: `20261116000100_welcome_once` marks every account that isn't waiting for approval as
  welcomed (see v0.6.0).
- A revoke: `20261116000400_space_rename_admins` takes the member grant to update
  `miso.spaces.name` and `.theme` away. Only admins and owners rename a space, through
  `miso.rename_space()`. A shell older than v1.0.0 can no longer rename spaces from its Space
  settings dialog.
- Two policies altered, nothing dropped: `20261123000100_invitations_revoke_only` (a revoked invite
  can't be reopened) and `20261124000100_draft_spaces` (any member may make a connection token that
  may change spaces; their changes stay in their own drafts).

The others only add:

- `20261116000200_subspaces`: `miso.spaces.parent_id`, `miso.create_subspace()` and
  `miso.delete_subspace()`; a subspace is seen only by owners and the service accounts.
- `20261116000300_org_settings`: `miso.org_settings`, one row with the app's look, seeded with the
  look most spaces have.
- `20261117000000_space_symbol`: `miso.spaces.symbol` (a space's icon) and `miso.edit_space()`.
- `20261117000100_manual_spaces`: `miso.create_space()`, a top-level space with no folder (id
  `space-<hex>`) that `miso.sync_spaces()` never deletes.
- `20261122000000_allowed_domains_admins`: policies so active admins and owners (app tier) read, add
  and remove `miso.allowed_domains`; the old `miso.is_admin()` ones stay.
- `20261122000100_org_name`: `miso.org_settings.name` (the workspace name, 1 to 60 characters or
  null) and the grant to update it.
- `20261123000000_invitations`: the table `miso.invitations` (admins and owners read, make and revoke
  invites).
- `20261123000200_change_history`: `miso.change_history`, eight functions, three triggers (on
  records, tabs and spaces) and a nightly pg_cron job that trims it.
- `20261123000300_ai_tokens`: `miso.ai_tokens` (only each token's SHA-256) and
  `miso.ai_token_owner()` for the API.
- `20261123000400_record_search`: the generated column `miso.records.search` and its GIN index
  `records_search_idx`.
- `20261124000000_ai_token_edits_spaces`: `miso.ai_tokens.edits_spaces` (default false), a policy
  and `miso.ai_token_edits_spaces()`.
- `20261124000100_draft_spaces`: `miso.spaces.created_by` and `.visibility` (every existing space is
  `everyone`) and `miso.delete_draft_space()`.
- `20261124000200_space_proposals`: `miso.space_proposals` and `miso.publish_space()`.
- `20261124000300_setup_repair_grants`: `select` and `delete` on `app.app_user` for the secret key,
  so `scripts/supabase-setup.ts` can repair a half-made service account.
- `20261125000000_member_position`: adds a column and a function: `app.app_user.position` (1 to 80
  characters or null) and `miso.set_own_position()`, which sets only the caller's own.

- Onboarding: the welcome step asks a new person's name, position and team. Email comes from
  sign-in and the company is the install. Admins and owners now see it too, on their own first
  sign-in, and only they can type a new team, which is made and joined. The position shows in
  People & access. On the self-hosted (Compose) install the first owner then picks sample spaces,
  each with one line and a picture, and admins and owners add more later from Settings →
  Organisation → Add sample spaces. Each pick is one build and one commit, and the page reloads with
  the new spaces in the sidebar. Elsewhere the picker doesn't show.
- Connect your coding agent: a banner leads to Settings → Connect your AI until one of your tokens
  has been used; **Later** hides it for a week. **Copy setup prompt** makes a token that may change
  spaces and copies a prompt for Claude Code: what Tamari is, the `claude mcp add` command, and
  "call whoami and tell me the result". A second tab gives the address and token for other agents.
  The token isn't shown again after the dialog closes. The new MCP tool `whoami` returns who you
  are, your company and the spaces you see.
- Connect your AI: a member makes named tokens on Settings → Personal and pastes one into their own
  AI tool (Claude Code or another MCP client). The tool reads the workspace as that member (spaces,
  shared records, vault notes) and can propose a vault note change. On the Compose install, a token
  with **May change spaces** also lets it create spaces and change their code, tabs and widgets.
  A token stops working when its member is suspended or removed.
- Draft spaces and proposals: on the Compose install a member's coding agent builds draft spaces
  that only they (and admins and owners) see; their server functions run once approved. A member's
  change to a shared space goes into their own draft copy. Either one is sent as a proposal, and
  admins and owners approve or reject it on the new Proposals page.
- Change history: every change to a shared record, and tabs and spaces made, renamed or deleted,
  are kept. Spaces get version history with no code of their own (`history()` and `restore()` in
  `@miso/store`), and the Activity tab shows who changed what.
- Self-hosted install: `selfhost/install.sh` runs Tamari with its own database on one machine
  (Docker Compose). The spaces live in a volume with git history, and every start applies the
  migrations. tamari-sample starts a company this way with example spaces.
- Community spaces: `community/` holds spaces from a real team's workspace, cleaned of its data, names
  and secrets. Three work (`email-checker`, `pr-writer`, `newsletter`) and eight are blueprints, an
  empty page plus a `SPACE.md` spec for your own coding agent to build from (`floorplan`, `my-day`,
  `roadmap`, `outreach`, `kpi-board`, `budget`, `handbook`, `funding`). `miso template list --community`
  and `miso template add <name> --community` install one. `cli/community.test.ts` keeps secrets, a
  `.env` file and the source team's name out. No migration.
- Two more starter templates: `writer` (style guides and drafts, and an AI draft from your notes once
  `WRITER_AI_KEY` is set on the Connectors page) and `email-check` (a contact list whose addresses are
  checked by DNS only). Each has a picture for the sample-space picker.
- The default look is Tamari's, from the landing page: ink-tinted neutrals instead of pure grey,
  darker supporting text (it now passes WCAG AA), a periwinkle focus ring, softer tinted shadows
  on menus and dialogs, the wordmark in M PLUS 1 and shell page titles in Zen Kaku Gothic New. The
  sign-in and waiting screens sit on the landing page's periwinkle sky. A colour preset in
  Settings → Organisation still sets the colours, and the shadows' lift follows it; a font preset
  also replaces the wordmark and title faces. The sign-in and waiting screens show before the
  theme loads, so every org sees them in Tamari's colours. Spaces need no code change, but they
  pick up the new neutrals, muted text and shadows.
- The product is now called Tamari in what people see: the tour, Settings, Connectors, sign-in
  and server messages, the AI connector's text, and the docs. Shell text takes the name from
  `APP_NAME` in `app/lib/brand.ts`, so a twin that sets its own name keeps it. The Claude Code
  command on **Connect your AI** uses the alias `tamari`. A new install's example space is called
  **Tamari** and its guide **How Tamari works**; an existing install keeps its space's name, because
  syncing never renames a space. Nothing else changes name: the `miso` command, `.miso/` folders,
  `@miso/*` packages, `MISO_*` variables, the `miso` schema, storage keys, headers, the `miso` space
  id and folder, and the MCP server's `name` stay as they were. No migration.
- Search shared records: the AI connector has a `search_records` tool, and views can call
  `GET /api/search/records?q=` (1 to 200 characters, `limit` 1 to 50, default 20). Both search the
  text and numbers of every record the member can see, in all collections, newest first, and return
  each hit's collection, key, space and a short excerpt. Words match whole; "a phrase", `or` and
  `-word` work.
- Invite people: on People & access, admins and owners invite an email address at a role, from any
  domain. When that person signs in with it they get in at that role instead of waiting. Nothing is
  emailed: the card gives a link to send. Open invites are listed with their expiry (14 days) and
  can be revoked; inviting an address again replaces its invite.
- Email sign-in with a one-time code: after **Email me a sign-in code** the sign-in page asks for the
  6-digit code from the email (`verifyOtp`). The same email still has the link, which works as
  before. New local projects get the templates in `supabase/templates/`; `miso provision` sends them
  to hosted projects that have SMTP (6-digit codes). An existing hosted project keeps its own
  template until someone adds `{{ .Token }}` to its Magic Link and Confirm signup templates.
- Subspaces: an owner unfolds a space in the sidebar and adds subspaces under it, one level deep.
  Each has its own tabs and widgets, and can open any view, also one that its parent already has.
  Only owners see them for now. Views in a subspace run as its parent (connectors, shared data).
- Settings page (`/settings`): Personal shows your name, email and picture; Organisation (admins
  and owners) sets one font, color and corners for the whole app and renames spaces. The per-space
  settings dialog is gone, and members can no longer rename a space.
- Space icons: on Settings → Organisation each space has an icon button that opens a grid of
  symbols; Save stores the name, the icon or both. The sidebar and tab search show the pick.
- Workspace name: on Settings → Organisation, admins and owners name the workspace. The sidebar
  shows it at the top for everyone instead of the product name; empty brings the product name back.
- Add a space: below the list on Settings → Organisation, admins and owners name a new space, pick
  an icon and select Add space. It has no folder or code: its tabs open views from any space, it
  gets subspaces like the others, and Space access rules apply to it. It can't be deleted yet.
- `miso provision`: sets up a new org's twin in one command: the Supabase project, migrations, API
  and auth settings, sign-in mail (SMTP), service accounts, the owner's account, the workspace name,
  an allowed domain, and the Vercel project. Hosted is a dry run unless `--yes`. See
  `docs/org-repos.md`. No real hosted run has been made yet.
- Sign-in: "Continue with Google" shows only when the Supabase project has Google turned on. A fresh
  install shows the email link alone, instead of a button that ends on a raw error.
- Starter templates: `miso template list` and `miso template add <type>` copy a first space for an
  agency, startup, events, go-to-market or product team into the app and add it to `spaces.json`,
  with `--vault <folder>` for five starter notes. They store their data as shared records; no migration.
- Vault: notes open inside miso as formatted text, with a name filter and a search inside notes.
  Any member suggests an edit or a new note; it becomes a pull request on the vault repo in their
  name, which developers review and merge on GitHub. miso shows each one as open, merged or closed,
  and the proposer can withdraw it. `VAULT_TOKEN` now also needs write access to contents and pull
  requests. The build keeps a space's own packages (Markdown, diff) in the browser bundle.
- Your name: Settings → Personal has a name field with Save, so nobody has to show as their email.
  The sidebar shows the name. A member who saves a
  name there before the welcome step can no longer pick their own departments; an admin does.
- People waiting: for admins and owners, the People & access row in the sidebar shows how many
  people wait to be let in (a dot when the sidebar is collapsed). It updates every minute.
- Let people in by email domain: on People & access → Members, admins and owners add and remove
  the domains whose people get in as active members, without the CLI. Public mail providers such as
  gmail.com are refused. Removing a domain asks first; people already let in keep their access.
- The "How miso works" guide now speaks to the people using the app. Admins and owners see a Get
  started checklist on top: connect a service, let your team in, set up departments, add a space.
- New installs start with only the miso space. Vault and Factory stay in the repo and come back
  with one line in `spaces.json` (see the README); existing org repos keep what they have.
- No more pointers to the desktop miso app: a space that asks for chat or the scratchpad gets a
  toast that they aren't part of this app yet, and the Gmail connector's help says how to get its
  three values from Google.
- The sheet's left edge is no longer cut off, and the + button lines up with the tabs.
- Usage page: "Tier" is now "Role" and "Pending" is now "Waiting".
- A view whose space package isn't installed in the hosted app now fails only where it uses that
  package, with "<package> is not installed in the hosted app", instead of taking every server
  function down (an EROFS crash on Vercel).
- Renaming or editing a space that no longer exists returns 404 instead of a 500.
- Installing spaces retries without `--frozen-lockfile`, so a space lockfile that drifted from its
  `package.json` no longer blocks a deploy.
- Landing page: a static site under the name Tamari, now in its own repo; `site/` is gone from
  this repo. The app, the CLI and the repos stay miso.
- Space server code now sees only a short list of the deployment's environment variables:
  `NODE_ENV`, `TZ`, `VERCEL_ENV`, `MISO_DEPLOY_ENV`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and
  `MISO_SPACES_EMAIL`. Every other key a space reads must come from Connectors. A key set both as a
  connector and as a deployment variable now reads as undefined in spaces, so move it to Connectors.

## v0.6.0 (2026-11-16)

Two migrations. Nothing is dropped or renamed; two function bodies are replaced and one column is
backfilled:

- `20261116000000_last_owner_lock` replaces the body of `app.app_user_guard_last_owner()` so it
  takes a lock before it checks.
- `20261116000100_welcome_once` adds `app.app_user.welcomed_at` and a trigger on
  `miso.department_members`, and replaces the body of `miso.welcome_self()`. Every account that
  exists when it runs counts as welcomed, except those still waiting for approval, so only admins
  place active or suspended people who are in no department today. Finishing the welcome step uses
  up the self-join even when no department was picked.

`miso update` applies them. The update to this release still checks the app with the old CLI's
`GET /`; the `/api/health` check applies from the next update.

- CI runs typecheck, tests and build on pull requests and pushes to `main`.
- A 500 from a shell route returns a generic sentence and logs the detail. A space function's own
  error message still reaches the person (cut to 500 characters).
- Bad request bodies are 400s; a tab reorder is validated and touches only the tabs that move.
- Two owners demoting each other at once can't leave the workspace without an owner.
- A person picks their departments once, at first sign-in; after that only an admin changes them.
- The catalog is served by `GET /api/catalog` after sign-in, filtered to what the person sees.
  `/catalog.json` is gone. `manifest.json` and `/assets` stay public.
- A failed background refresh keeps the app on screen and shows a toast.
- Sign-in: a message for an expired or failed link, a waiting screen instead of a sign-out for an
  account not let in yet, and "Send it again" after a link is sent.
- Suspending a member, limiting a space, closing a tab and hiding a widget ask first; the tour and
  the widgets tray say that tabs and the grid are shared.
- `miso update` waits for `GET /api/health` (keys and schema), not for the static page. The Docker
  template's `HEALTHCHECK` calls it too; an existing org `Dockerfile` keeps `/api/config` until
  edited.
- A Content-Security-Policy (scripts from the shell only, no framing) comes with `vercel.json` and
  `app/serve.ts`, so Docker and local runs have it too. A view that loads a script, style or font
  from another host is blocked now.
- Reorder tabs from a tab's menu (Move left, Move right). In Edit widgets, focus a widget and use the
  arrow keys to move it, Shift and arrows to resize it.
- A 4-column widgets grid, the default on a phone.
- A person with no space open sees a message, not a blank page.
- `/api/me` is read again when the tab regains focus after five minutes, so a promoted, moved or
  suspended person doesn't need a reload.
- README: keep Confirm email on in a hosted Supabase project.

## v0.5.0 (2026-11-10)

No migrations. Org repos that run on the Mac need no step: run `miso update` and commit the new pin.

- `runtime: docker` in `.miso/miso.yaml`: the org repo is built into one container image by any host
  that builds a Dockerfile, such as Dokploy or plain `docker build`. Like `vercel`, `miso update` then
  only moves the pin.
- `miso init --runtime docker` and `miso docker init` write a `Dockerfile` and `.dockerignore` into
  the org repo, and never overwrite them. The image builds the pinned shell with the org's spaces,
  serves with bun on port 13380 as the `bun` user, and has a health check on `/api/config`.
- No app key is in the image: the Supabase keys are runtime variables. A private shell repo is read
  with the build secret `MISO_SHELL_TOKEN`, never a build argument.
- `docs/org-repos.md`: "Running in a container (Dokploy)".

## v0.4.0 (2026-11-10)

No migrations. Org repos that run on the Mac need no step: run `miso update` and commit the new pin.

- `runtime: local | vercel` in `.miso/miso.yaml`. `local` stays the default and the line is left
  out, so existing org repos don't change. `miso init --runtime vercel` writes it.
- `miso vercel prepare [--build]` puts the pinned shell and the org's spaces in `.miso/vercel/` and,
  with `--build`, checks that the build wrote `dist/index.html` and `api/_generated/server-entry.js`.
- With `runtime: vercel`, `miso update` only moves the pin; CI builds and deploys it. `miso status`
  says so.
- Workflow template `cli/templates/vercel-deploy.yml`: build, typecheck, deploy without the live
  address, a check of `/api/config`, then promote. Pull requests get a preview. A private shell repo
  needs the `MISO_SHELL_TOKEN` secret (fine-grained, read-only Contents on the shell repo only).
- `docs/org-repos.md`: "Running on Vercel". Not covered yet: pinning a spaces repo, cron jobs,
  domains and auth URLs.

## v0.3.0 (2026-11-10)

**This release has 2 migrations and one function change that is not add-only.** `miso update` runs
them on an org's own Supabase project. An org whose `miso.yaml` has `supabase:` empty, like one on a
shared database, runs nothing; its schema owner copies the change by hand (see
`docs/org-repos.md`).

- Migrations: `20261110000000_departments` (departments, department members, space access by
  department or person) and `20261110000100_department_self_join` (`miso.welcome_self`).
- Not add-only: `miso.space_access_rules()` is dropped and created again, because its result gains
  the `departments`, `people` and `members` columns. `space_id` and `tiers` stay first, so code that
  reads only those keeps working. See `docs/releasing.md`.
- People & access: members, departments and space access on one page, with three tabs. A space can
  be opened to departments or to named people as well as by role.
- Welcome step: on first sign-in a person enters their name and picks their departments once.
  After that only admins change departments. Departments that open a space admins don't see are
  not offered. The tour follows the welcome step.
- Only an owner changes who sees a space that admins don't see, or a department that opens one.
- "Role" replaces "tier" in what people read.

## v0.2.0 (2026-11-10)

No migrations and no steps for the org: run `miso update` and commit the new pin.

- Data map replaces Shared data: it shows which spaces use which tables, functions, collections and
  connector variables, filtered to what the viewer may see. The `/shared-data` route still works.
- Connectors page redesign: a gallery, a guided connect flow and a manage panel.
- Feedback dialog: one text box, the page it was sent from, and a reply after sending.
- Links between spaces open the view in its own space.
- A menu on phones, a regrouped sidebar, a "Take the tour" row and a guided tour, plainer error
  messages, and dialog fixes.
- Sidebar: line icons per space instead of image icons.
- Factory space: a read-only board of `/factory` jobs and backlog, from the repos in `FACTORY_REPOS`.

## v0.1.0 (2026-10-30)

First release for org repos.

- `miso init | install | update | migrate | status` (`cli/`): an org repo installs this shell into
  `.miso/shell/`, runs its own spaces from `.miso/spaces/`, and moves to a new tag with
  `miso update`, which rolls back when the app doesn't come up. See `docs/org-repos.md`.
- Migrations: the shell's `supabase/migrations` and the org's `.miso/migrations` run through one
  ledger, `public.miso_migrations`, and only after a yes for a hosted database.
- Shell features at this tag: the sidebar with ⌘S and ⌘K tab search, usage analytics, the Vault
  space and the starter vault template. Migrations: 8 (`20261020000000_shell` to
  `20261023000000_usage_events`).

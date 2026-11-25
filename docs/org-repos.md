# Running Tamari in an org repo

An org doesn't fork or clone this repo. It keeps its own repo, usually its
PARA vault, and installs a tagged release of this shell into a gitignored folder inside it. Shell
updates arrive with `miso update` (the command keeps Tamari's old name).

```
<org repo>/
  .env                  the app's keys (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY)
  .miso/miso.yaml       org config and the shell version pin
  .miso/spaces/         the org's spaces: spaces.json and one folder per space
  .miso/migrations/     the org's own database migrations, run after the shell's
  .miso/shell/          the installed shell (gitignored), with shell.prev/ for rollback
  .miso/vercel/         runtime: vercel only. The folder CI deploys: the pinned shell plus the spaces (gitignored)
  .github/workflows/miso-deploy.yml   runtime: vercel only. Builds and deploys it
  Dockerfile, .dockerignore           runtime: docker (or any twin that wants a container). Builds the pin into an image
```

`.miso/shell/workspaces` and `.miso/shell/spaces.json` are links to `.miso/spaces/`, and
`.miso/shell/.env` links to the org's `.env`, so the shell builds and runs the org's spaces with
the org's keys. Keep `.env` out of git; with the env repo, `envlink add .env` stores it.

## Design rules for the org's agents

`miso init`, `install` and `update` add a section "Designing miso spaces" to the org repo's
`AGENTS.md` once (to `CLAUDE.md` when only that exists; with neither, they make `AGENTS.md` and link
`CLAUDE.md` to it). It points agents at `.miso/shell/docs/space-design.md`, the design rules of the
pinned shell, and lists the rules that always apply. It is added only when the heading is missing,
so edit or move it freely; delete the heading and the next install adds it again.

## miso.yaml

```yaml
name: acme               # LaunchAgent com.miso.<name>
title: Acme
shell: tamari-studio/tamari
version: v0.1.0          # the shell tag; `miso update` moves it
port: 13400
supabase: muvxvwkjcnpxxiwgojag   # hosted project ref; empty for no database
runtime: local           # local (the default; leave the line out), vercel or docker
```

`runtime` says where the pin runs. `local` is a LaunchAgent on a Mac. `vercel` is built and deployed
by CI; see "Running on Vercel" below. `docker` is built from the Dockerfile in the repo by a
container host such as Dokploy; see "Running in a container (Dokploy)". With `vercel` or `docker`
nothing runs on the Mac and `miso update` only moves the pin. A twin has one runtime; a `local` twin
can still have a Dockerfile.

## Commands

| Command | What it does |
|---|---|
| `miso init --name <n> --port <p> [--title <t>] [--supabase <ref>] [--runtime local\|vercel\|docker]` | Writes `.miso/miso.yaml`, `.miso/.gitignore` and `.miso/migrations/` in the current repo, and adds "Designing miso spaces" to its `AGENTS.md` ("Design rules for the org's agents"). With `--runtime vercel` it also writes the deploy workflow, with `--runtime docker` the Dockerfile and `.dockerignore` (`--port` is then optional) |
| `miso install [--to <tag>] [--yes]` | Installs the pinned tag (or the newest), migrates, builds, starts the LaunchAgent. If `.miso/spaces/` is empty, starts it from the shell's own spaces |
| `miso update [--to <tag>] [--yes]` | Moves to the newest tag (or `--to`). If the app on its port doesn't pass `/api/health` (its keys work and the database has the schema), the previous shell comes back. With `runtime: vercel` or `docker` it only moves the pin, after the migration step: CI or the container host builds and deploys it |
| `miso migrate [--apply] [--yes]` | Lists pending shell and org migrations; `--apply` runs them |
| `miso status` | Pin, running version, newest tag, service and migrations |
| `miso template list`, `miso template add <type> [--as <folder>] [--vault <folder>]` | Lists the starter spaces (agency, startup, events, gtm, product, writer, email-check) or copies one into `.miso/spaces/` and adds it to `spaces.json`. Never overwrites a folder; `--vault` also copies the starter notes. With `--community` it lists or copies a space from `community/` instead (`miso template add email-checker --community`) |
| `miso docker init` | Writes the `Dockerfile` and `.dockerignore` into an existing twin, whatever its runtime. Never overwrites |
| `miso vercel prepare [--build]` | `runtime: vercel` only. Makes `.miso/vercel` (the pinned shell with the org's spaces copied in) ready to deploy. `--build` also installs and builds it, which is what CI runs first and what to run on a Mac to try the path |
| `miso provision --slug <s> --owner-email <e> [--target local\|hosted] …` | Sets up a new twin's database, accounts and hosting in one go. See "miso provision" below |

An install or update:

1. Clones the tag into `.miso/shell.next`, links the org's spaces and `.env`, installs packages and
   builds. A failure stops here and the running shell is untouched.
2. Lists pending migrations (the shell's `supabase/migrations`, then the org's `.miso/migrations`)
   and **asks before applying them to the hosted database**. `--yes` answers in advance.
3. Moves `shell` to `shell.prev` and `shell.next` to `shell`, rebuilds, restarts the LaunchAgent and
   waits for the app to answer 200. If it doesn't, `shell.prev` goes back.
4. Writes the new tag into `miso.yaml`. Commit that change, so every machine runs the same shell.

Migrations go through the Supabase Management API as `SUPABASE_ACCESS_TOKEN`, or the Supabase CLI's
own login (`supabase login`). The ledger is `public.miso_migrations` (source, filename, checksum).
For now this needs a hosted project; for a local Supabase use `supabase db push`.

## First install in an org repo

The `miso` command arrives with the first install, so run that one from a clone of the tag:

```sh
# The newest tag: git ls-remote --tags --sort=-v:refname https://github.com/tamari-studio/tamari.git | head -1
git clone --quiet --depth 1 --branch <newest tag> https://github.com/tamari-studio/tamari.git /tmp/miso-boot
cd <org repo>
bun /tmp/miso-boot/cli/miso.ts init --name acme --title Acme --port 13400 --supabase <ref>
bun /tmp/miso-boot/cli/miso.ts install
```

The install adds `~/.local/bin/miso`, which runs the shell installed in the nearest org repo.

A new hosted Supabase project also needs, once: the `miso` and `app` schemas added under
**Settings → API → Exposed schemas**, then `bun run supabase:setup` inside `.miso/shell`.
`miso provision` does both, and the rest of a new twin's setup.

## miso provision

One command for a new org's twin, in place of the manual steps in this file: the Supabase project,
the shell's migrations, the API and auth settings, the service accounts, **the owner's account**, an
allowed sign-in domain, the Vercel project with its variables and domain, and the twin's `miso.yaml`.

```sh
# The local Supabase from `supabase start`, for real (keys from .env):
miso provision --slug acme --title Acme --owner-email boss@acme.com --domain acme.com

# Hosted. Without --yes this is a dry run: it prints every API call and sends nothing.
miso provision --target hosted --slug acme --title Acme --owner-email boss@acme.com --domain acme.com \
  --base-domain miso.example.com --supabase-org <organization slug> [--region eu-central-1]

# Hosted, for real. It creates a paid Supabase project and a Vercel project.
SUPABASE_ACCESS_TOKEN=… VERCEL_TOKEN=… \
  SMTP_HOST=… SMTP_PORT=587 SMTP_USER=… SMTP_PASS=… SMTP_FROM=login@acme.com \
  miso provision --target hosted … --yes
```

A real hosted run needs the `SMTP_*` variables (`SMTP_SENDER_NAME` is optional and defaults to the
title). Supabase's own mail only reaches the members of your Supabase organization, so without SMTP
the owner never gets a sign-in code. With SMTP, provision also sets the sign-in mail to carry a
6-digit code and the link (`supabase/templates/`); Supabase's free tier allows that only with custom SMTP. If the owner signs in another way (Google, set up by hand),
pass `--without-smtp`.

Run it from a checkout or an install of the shell (it needs the shell's packages and migrations),
before the twin's address goes to anyone.

Why the owner step matters: on a database with no people, the first person to sign in becomes the
owner (`app.app_user_bootstrap()`). The command makes the account for `--owner-email`, with the email
confirmed and the tier `owner`, before there is an address to share. That person then signs in with
that address (a mail link or Google) and lands in their account. Anyone after them is `pending` until
an admin lets them in, or a member if their email domain is the `--domain`.

### The steps

| # | Step | local | hosted |
|---|---|---|---|
| 1 | `supabase-project` | skipped | Finds the project `miso-<slug>` in the organization, or creates it with a random database password that is not kept |
| 2 | `supabase-healthy` | skipped | Waits until auth, db and rest answer healthy (up to 5 minutes) |
| 3 | `migrations` | The shell's `supabase/migrations`, through the ledger `public.miso_migrations` | The same, through the Management API |
| 4 | `api-and-auth-config` | skipped (`supabase/config.toml` has it) | Adds `miso` and `app` to the exposed schemas; sets the Site URL to `https://<slug>.<base-domain>`, adds that address with `/**` to the redirect URLs, keeps "Confirm email" on; with `SMTP_*`, sends sign-in mail through that server |
| 5 | `service-accounts` | The spaces and vault accounts (the code of `bun run supabase:setup`) | The same |
| 6 | `owner` | Creates the `--owner-email` account, confirmed, with tier `owner` | The same |
| 7 | `workspace-name` | With `--title`: the workspace name at the top of the sidebar, unless one is set already | The same |
| 8 | `allowed-domain` | With `--domain`: anyone at that email domain signs in as a member | The same |
| 9 | `vercel-project` | skipped | Finds or creates the Vercel project `miso-<slug>`, with no framework preset and no Git connection |
| 10 | `vercel-env` | skipped | Sets `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (sensitive) for production and preview |
| 11 | `vercel-domain` | skipped | Attaches `<slug>.<base-domain>` |
| 12 | `miso-yaml` | Prints the twin's `.miso/miso.yaml` | The same, with the project ref and `runtime: vercel` |

Nothing is kept on disk between steps. Each step first looks at what is there and does only what is
missing, so after a failure you run the same command again: it continues, and it never makes a second
project, account or domain. A second owner is not refused, but the `owner` step prints a warning that
names every other owner it finds.

Migrations: if the database already has the shell's tables but the ledger doesn't know them (a local
Supabase built by `supabase start`, or a database another tool built), step 3 leaves the schema as it
is. See "A database that already has the shell's objects".

Secrets: the tokens come from the environment (`SUPABASE_ACCESS_TOKEN` or `supabase login`,
`VERCEL_TOKEN`, and `VERCEL_ORG_ID` when it is a team id). The command never prints a token, the
database password, the secret key or the SMTP password, not in a dry run and not in an error. The secret key goes from
Supabase straight to the Vercel project; to put it in the twin's `.env` as well, copy it from the
Supabase dashboard.

`--target local` refuses any `SUPABASE_URL` that is not on localhost. For a second local stack on
other ports, set `SUPABASE_DB_URL` to its Postgres address.

### What miso provision leaves to you

- **The twin's repo.** Make the repo, run `miso init` with the values the last step prints, then
  `miso update` to pin a release, and add the GitHub secrets ("Running on Vercel", steps 1, 2, 5 and
  6). The command makes no GitHub repo and no deployment: the first deployment comes from the twin's CI.
- **DNS.** Point `<slug>.<base-domain>` at Vercel. Until then step 11 reports the domain as not verified.
- **Google sign-in.** Each Supabase project has its own callback address,
  `https://<ref>.supabase.co/auth/v1/callback`. Add it to the Google OAuth client as an authorised
  redirect URI, and put the client id and secret under Authentication → Sign In / Providers → Google.
- **The SMTP account itself.** The command sets the server up in Supabase from `SMTP_*`; the
  account, and the DNS records (SPF, DKIM) that let its mail reach inboxes, come from your mail provider.
- **Connector keys** (Airtable, Tito and so on): on the Connectors page, as the owner.
- **The org's own migrations** in `.miso/migrations`: `miso migrate --apply` in the twin's repo.

### What it costs

A hosted run creates a Supabase project in the organization you name. On the Pro plan each project
is about **$10 a month** for the smallest compute size, on top of the plan's own fee. This is an
estimate from [Supabase's pricing page](https://supabase.com/pricing) (read 2026-11-22), not a quote:
check the page before you provision many. The Vercel project adds no fixed cost by itself; usage is
billed on the team's plan. A dry run and a `--target local` run cost nothing.

### What is tested

The local target ran against a real, empty local Supabase. The hosted steps are tested only against
a fake of the two APIs (`cli/provision.test.ts`), built from their published specs. **No real hosted
run has been made yet**, so treat the first one as a test: read the dry run, then watch each step.

## A database that already has the shell's objects

A database built by another tool already has tables and functions with the shell's names. The
runner doesn't know that. `miso migrate` would list every shell migration as pending and try to
create them again. A file that replaces a function (`sees_space()`, `space_access_rules()`) would
overwrite that database's version with the shell's, and the two can differ.

For such a database, **leave `supabase:` empty.**

- **Recommended: leave `supabase:` empty.** The CLI then runs no migrations, and the other tool
  stays the only one that changes the schema. Mirror each new shell migration that the org needs
  there by hand, as a new numbered file in that tool's own folder. The shell's code uses the same
  object names, so it runs against that database as it is. A release that adds migrations
  therefore comes with a step for the org: mirror them first, then `miso update`.
- **Not recommended: record the shell's migrations as applied** (one row per file in
  `public.miso_migrations` with `source = 'shell'`, the file name and the sha256 of the file's raw
  bytes) **and let the CLI run the later ones.** It is riskier: a later shell file that replaces a
  function, `sees_space()` for example, would overwrite that database's version with the shell's,
  which lacks the org's own clauses. It is safe only if every shell migration up to the tag is
  already in the database in a form the shell's code can use, and that has to be compared function
  by function again for every release.

Choose before you point `supabase:` at such a database.

## Running on Vercel

With `runtime: vercel` nothing runs on a Mac. CI builds one exact thing, the shell release pinned in
`.miso/miso.yaml` plus the spaces in `.miso/spaces/`, and deploys it. The hosting itself (`vercel.json`,
`api/server.ts`, the headers and the rewrites) comes from the shell, so the org repo holds only its
config, its spaces and one workflow file.

```
push to main    → production: built, answers a request, and only then gets the live address
pull request    → preview (it uses the real database; teammates need a Vercel login)
run by hand     → production again for a commit on main (a re-run or a rollback)
```

### What CI does

The workflow `miso init --runtime vercel` writes (`.github/workflows/miso-deploy.yml`; the org owns
the copy) does this, in order:

1. Checks out the org repo, then clones the pinned tag of the shell into `.miso/vercel`, because the
   `miso` command is part of the shell.
2. `miso vercel prepare --build`: replaces `workspaces/` and `spaces.json` in that clone with real
   copies of `.miso/spaces/` (links to folders outside it would not upload; links inside a space are
   followed; `node_modules` and `.env` files stay behind), then `bun install --frozen-lockfile` and
   `bun run build`. The build writes `dist/` (the client) and `api/_generated/` (the API and every
   space's server functions), and the step fails if either is missing.
3. `bun run typecheck` in that folder.
4. Deploys the folder without giving it the live address, calls `/api/config` on it, and only when
   that answers promotes it. A pull request gets a preview instead, with its address as a comment.

Vercel builds again from the uploaded source with the shell's own `vercel.json`
(`bun install --frozen-lockfile`, then `bun run build`); each space's own packages are installed by
the shell's `postinstall`. The first build in CI is the gate and the same build is the dry run.

### Environment variables of the Vercel project

Set them on the Vercel project (Settings, Environment Variables). They are not GitHub secrets.

| Variable | Needed | What |
|---|---|---|
| `SUPABASE_URL` | yes | The project URL, `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | yes | The publishable key. It reaches the browser by design |
| `SUPABASE_SECRET_KEY` | yes | The secret key. Server only: it mints the two service accounts' sessions |
| `MISO_SPACES_EMAIL`, `MISO_VAULT_EMAIL` | no | The service accounts' addresses, if not the defaults in `.env.example` |

Keys for what a space reads (Airtable, Tito and so on) are not variables: they go on the Connectors
page. A new hosted Supabase project also needs, once, what "First install in an org repo" says: the
`miso` and `app` schemas exposed, and `bun run supabase:setup` (run it inside `.miso/vercel` after
`miso vercel prepare`, with the project's keys in the shell's environment).

### GitHub secrets and variables

Repository settings, Secrets and variables, Actions:

| Name | Kind | What it is, and the least it needs |
|---|---|---|
| `MISO_SHELL_TOKEN` | secret | Read access to the shell repo, which is private. The workflow's own `GITHUB_TOKEN` can't read another private repo, and an org may switch deploy keys off. A **fine-grained personal access token**: *Resource owner* the owner of the shell repo, *Repository access* only that repo, *Repository permissions* → **Contents: Read-only** (Metadata: Read-only is added for you). Nothing else. Give it an expiry and put the renewal in a calendar: a failed run says "The secret MISO_SHELL_TOKEN is not set" only when it is missing, and a clone error when it has expired. A classic token would need the whole `repo` scope, which is wider |
| `VERCEL_TOKEN` | secret | A Vercel token for the account or team that owns the project |
| `VERCEL_ORG_ID` | secret | The team or account id (`orgId` in `.vercel/project.json` after a `vercel link`) |
| `VERCEL_PROJECT_ID` | secret | The project id (`projectId` in the same file) |
| `VERCEL_SCOPE` | variable, optional | The team slug, if a command asks for a scope |

`miso` reads `MISO_SHELL_TOKEN` too, so `miso update` works on a machine with no GitHub login. The
token is sent only to `https://github.com/`, and an error never prints it.

### First deploy

1. In the org repo: `miso init --runtime vercel --name <n> --title <t> --supabase <ref>`, or add
   `runtime: vercel` to an existing `.miso/miso.yaml` and copy the workflow from
   `cli/templates/vercel-deploy.yml` in the shell to `.github/workflows/miso-deploy.yml`.
2. `miso update` pins a release (the newest tag, or `--to <tag>`). It asks before it applies any
   migration to the hosted database, and it seeds `.miso/spaces/` from the shell's starter spaces if
   the org has none yet.
3. Try the build on your Mac: `miso vercel prepare --build`. It prints
   `built: dist/index.html, api/_generated/server-entry.js` when both exist.
4. In Vercel: create a project for the org repo's deploy folder with no framework preset, and set
   the environment variables above. The deployment comes from CI, so the project needs no Git
   connection.
5. In GitHub: add the secrets and variable above.
6. Commit `.miso/` and `.github/workflows/miso-deploy.yml` on a branch and open a pull request. The
   preview is the first deploy. Merge when it looks right: production follows.
7. In Supabase, add the production address to **Authentication → URL Configuration** (Site URL and a
   redirect URL), as in the README.

### Updating

`miso update` (newest tag) or `miso update --to <tag>`. It lists the release's migrations and asks
before it applies them to the hosted database; that happens on your Mac, never in CI. Then commit
`.miso/miso.yaml`, open a pull request (the preview is built with the new shell), and merge. To roll
back, revert the commit that moved the pin, or run the workflow by hand for an older commit on main.
A database that already has the shell's objects follows the section above this one.

### Not covered yet

- **Pinning a spaces repo.** Spaces come from `.miso/spaces/` in the org repo only. Pinning a
  commit of a separate spaces repo (`spaces.lock`) would release spaces on every push there. The next
  step for a twin: a `spaces:` line in `miso.yaml` naming the repo, a `.miso/spaces.lock` with the
  commit, `miso spaces pin [ref]` to move it, and a workflow step that checks that commit out with a
  read-only `SPACES_TOKEN` into `.miso/spaces/` before `prepare`.
- **Cron jobs.** The shell's `vercel.json` has none. An org that needs one has no
  place for it until the shell has a hook for it.
- **The domain, and the Supabase auth settings.** By hand (step 7), or with `miso provision`.

## Running in a container (Dokploy)

A twin can run as one container image on any host that builds a Dockerfile: `docker build`,
[Dokploy](https://github.com/dokploy/dokploy), and the like. `miso init --runtime docker` (a new
twin) or `miso docker init` (an existing one) writes a `Dockerfile` and a `.dockerignore` at the root
of the org repo. The org owns them.

The image is the shell release pinned in `.miso/miso.yaml` plus the spaces in `.miso/spaces/`, copied
in as real files and built, then served with bun on **port 13380**:

- The Dockerfile does the whole assembly itself (clone the pinned tag, put the spaces in, `bun install
  --frozen-lockfile`, `bun run build`, drop `.git`), so it works with any shell tag that has a
  `vercel.json`, not only the release that introduced it. Nothing but the pin and the spaces comes
  from the org repo.
- The final stage runs as the `bun` user with `PORT=13380` and `HOST=0.0.0.0` (the shell listens on
  127.0.0.1 unless told otherwise).
- **No key is in the image.** The three app settings are environment variables of the container (the
  same ones as for Vercel: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`).
- `HEALTHCHECK` calls `/api/health`, which answers 200 only when those keys work and the database
  has the shell's schema, so "healthy" means configured, connected and serving. A container started
  without them, or against an empty database, reports `unhealthy`. A Dockerfile written by an older
  `miso docker init` keeps calling `/api/config` until you change that line.
- The private shell repo is read with a **build secret**, `MISO_SHELL_TOKEN`: the same read-only token as
  for Vercel (fine-grained, Contents: Read-only on the shell repo). A build secret is not an image
  layer and not a build argument, so it is not in the image or its history.

### Which Dokploy build type

An **Application** with the **Dockerfile** build type. Compared with the others, from Dokploy's docs
(docs.dokploy.com, read 2026-11-10):

- *Nixpacks, Railpack and the buildpacks* detect the app from the repo. The twin repo holds no app
  code: the shell is fetched at build time, from a private repo, so they have nothing to detect and
  no secret to do the fetch with.
- *Docker Compose* is for several services. A twin is one. Compose "Stack" mode does not support
  `build` at all, so the image would have to be built somewhere else first.
- *Dockerfile* has the three fields this needs (Dockerfile Path, Docker Context Path, Docker Build
  Stage), "Build-time Secrets" for the token, and runtime environment variables in the same tab. The
  image's own `HEALTHCHECK` applies unless a Swarm Health Check is set under Advanced (that is
  Docker's default; Dokploy's docs name no default of their own).

### Dokploy steps

1. In the Dokploy dashboard, create a project and an **Application**. Source: GitHub, through a GitHub
   App that is installed on the twin repo (the twin repo is private). Branch: `main`.
2. Build Type: **Dockerfile**. Dockerfile Path: `Dockerfile`. Docker Context Path: `.`. Docker Build
   Stage: empty.
3. Environment tab, runtime variables: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SECRET_KEY` (the secret key only here, never as a Build Time Argument). Build-time
   Secrets: `MISO_SHELL_TOKEN`.
4. Domains: the host name, **Container Port `13380`**, HTTPS. Dokploy's Traefik routes to it; a plain
   Application needs no labels.
5. Deploy. Watch the build log for `miso: cloning tamari-studio/tamari v…`, then the health check.
6. In Supabase, add the domain to **Authentication → URL Configuration** (Site URL and a redirect URL).
7. Turn on **Auto Deploy** (General tab) so a push to `main` rebuilds.

The Dokploy docs don't say how an application reaches a service on the Dokploy machine itself
(`host.docker.internal` and `extra_hosts` aren't mentioned), so point `SUPABASE_URL` at a hosted
Supabase project, not at a database on the same host.

Updating is the usual flow: `miso update` on your Mac (it asks before it touches a hosted database),
commit `.miso/miso.yaml`, push, and Auto Deploy builds the new image. To roll back, revert the commit
that moved the pin. Dokploy's own Swarm rollback follows the health check, and its registry rollback
needs a registry set up in the Deployments tab. A database that already has the shell's objects
follows the section "A database that already has the shell's objects".

### Try it on a Mac with plain Docker

```sh
docker build -t miso-twin .
docker run --rm -p 13420:13380 \
  -e SUPABASE_URL=http://host.docker.internal:54321 \
  -e SUPABASE_PUBLISHABLE_KEY=<publishable key of the local Supabase> \
  -e SUPABASE_SECRET_KEY=<secret key of the local Supabase> miso-twin
```

`supabase start` prints the local keys. The container reaches the local Supabase on the Mac as
`host.docker.internal:54321`. The same address goes to the browser in `/api/config`, so a browser
sign-in needs an address the browser can reach as well; the calls the server makes work either way.

- **The shell isn't on GitHub yet** (a tag you haven't pushed), or you build offline: add
  `--build-context shell-source=/path/to/tamari`, a git checkout or a bare clone that has the pinned
  tag. Docker may reuse layers built from a local source when you build again without it, so add
  `--no-cache` when you switch between the two.
- **The private repo without a token** stops at once with `could not clone … pass the build secret
  MISO_SHELL_TOKEN`: `MISO_SHELL_TOKEN=<token> docker build --secret id=MISO_SHELL_TOKEN,env=MISO_SHELL_TOKEN .`
- Don't install Dokploy on a laptop to try this: it turns on Docker Swarm and takes ports 80, 443
  and 3000. Plain Docker runs the same image.

### Not covered

Pinning a spaces repo and cron jobs, as for Vercel. The token path against GitHub is not tested here
(only the header is, in the CLI tests); the clone from a local shell source and the failure without a
token are.

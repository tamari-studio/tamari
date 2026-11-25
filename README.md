# Tamari

Tamari is a workspace app for a team. It has a shell (sidebar, tabs, dashboards, sign-in,
members) and spaces. You add a space for each area of your work. A space has pages (views),
dashboard cards (widgets) and server code that reads your data.

Tamari runs on your own machine or server, with its own database (Supabase), in Docker.

## Run it with Docker

You need Docker with Docker Compose v2, `git` and `openssl`. Give Docker at least 2 GB of memory.

```sh
git clone https://github.com/tamari-studio/tamari.git
cd tamari
./selfhost/install.sh
```

The script asks for two things:

1. **The address** people open Tamari at. The default is `http://localhost:13390`. On a server,
   give the public address (for example `https://tamari.example.com`) and point your reverse
   proxy with TLS at port 13390.
2. **The owner's email address.**

It writes `selfhost/.env` with new random keys, builds and starts everything, and prints a
**sign-in link** for the owner. The link works once, within an hour. Run the script again at any
time for a new link: it keeps the keys and the data.

To let other people sign in with a code by email, fill in the `SMTP_*` values in `selfhost/.env`,
then run `docker compose up -d` in `selfhost/`.

[selfhost/README.md](selfhost/README.md) has the rest: email, where the data is, spaces, upgrades
and what to do when something is wrong.

## Build a space

A new install has one space, **Tamari**, with the page **How Tamari works**. A space is a folder
with views, widgets and server functions in `.miso/`. You can build one three ways:

- **With your AI tool.** On a Docker install, connect Claude Code or another MCP tool to Tamari
  (**Settings → Personal → Connect your AI**) and ask it to build the space. Tamari builds and keeps
  each change only when it passes the checks.
- **From a starter.** `template/` has a first space for seven kinds of team, and `community/` has
  more.
- **By hand.** Write the files in `workspaces/<folder>/.miso/` and add the space to `spaces.json`.

[docs/spaces.md](docs/spaces.md) explains how spaces, views, widgets and server functions work.
Read [docs/space-design.md](docs/space-design.md) before you build a view or widget.

## Run it from source

For work on the shell itself you need [Bun](https://bun.sh), Docker and the
[Supabase CLI](https://supabase.com/docs/guides/cli):

```sh
bun install
supabase start
supabase status -o env | sed -n 's/^API_URL=/SUPABASE_URL=/p; s/^PUBLISHABLE_KEY=/SUPABASE_PUBLISHABLE_KEY=/p; s/^SECRET_KEY=/SUPABASE_SECRET_KEY=/p' > .env
bun run supabase:setup
bun run dev
```

Open http://localhost:13380 and select **Email me a sign-in code**. The email arrives in Mailpit at
http://127.0.0.1:54324.

Before you send a change, run `bun run typecheck`, `bun run test` and `bun run build`.

## Run it for an organisation

An organisation can also keep its spaces in its own repo and install a tagged release of Tamari
into it with the `miso` command (`miso init`, `miso install`, `miso update`). See
[docs/org-repos.md](docs/org-repos.md).

## Names

Tamari was called miso. The `miso` command, the `.miso/` folders, the `@miso/*` packages, the
`MISO_*` variables and the `miso` database schema keep that name.

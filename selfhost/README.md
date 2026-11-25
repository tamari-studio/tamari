# Run Tamari with Docker Compose

This folder runs Tamari and its own Supabase on one machine: the database, sign-in (Auth), the data
API (PostgREST), live updates (Realtime) and a gateway (Kong) in front of them and the app. One
address serves all of it: Supabase is under `/auth/v1`, `/rest/v1` and `/realtime/v1`, and every
other path is the app.

You need Docker with Docker Compose v2, and `openssl`.

What the machine needs (measured with `docker stats` on 2026-11-23): Tamari uses about 1 GB of
memory at rest (the gateway 250 to 370 MB, Realtime 220 MB, the app 120 MB, the database 110 MB,
the rest under 40 MB each). A rebuild after a change to a space takes the app to about 300 MB for a
few seconds, and building the image (install and upgrade) needs about 0.5 GB more. Give Docker at
least 2 GB of memory, and about 3 GB of disk for the images and the build. With less memory, the
machine swaps and every container stalls.

## Install

In a clone of this repo:

```sh
./selfhost/install.sh
```

It asks for two things:

1. **The address** people open Tamari at. The default is `http://localhost:13390`. On a server, give
   the public address (for example `https://tamari.example.com`) and point your reverse proxy with
   TLS at port 13390 on the machine.
2. **The owner's email address.**

Then it writes `selfhost/.env` with new random keys, builds the app image from this checkout, starts
everything and waits until it is healthy. On every start the app applies the shell's migrations
(`supabase/migrations`) before it serves. A migration that fails stops the start, and the app
doesn't serve.

At the end it makes the owner account and prints a **sign-in link**. It works once, within an hour.

You can run `install.sh` again at any time. It keeps the `.env` it wrote and makes no new keys,
because the database already uses them. It starts what isn't running and prints a new sign-in link.
If the database is there but `.env` is gone, it stops and says so: new keys would not fit that
database.

## Email

Sign-in goes by email. The mail is the repo's own (`supabase/templates`, subject "Your sign-in code"):
a 6-digit code to type on the sign-in screen, and a link that signs in too when it is opened in
the browser that asked for it. Someone who signs in for the first time then waits until an owner
or admin gives them a role on People & access. While `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and
`SMTP_FROM` in `selfhost/.env` are empty, no mail goes out. The owner signs in with the printed link,
and other people can't sign in. Fill in your mail provider's SMTP settings, then run
`docker compose up -d` in this folder.

## Where the data is

Two Docker volumes: `tamari_db-data` holds the database, and `tamari_spaces` the spaces (see
"Spaces"). `docker compose down` stops Tamari and keeps both. `docker compose down -v` **deletes
the database, the spaces and all their data.**

Keep `selfhost/.env` private and keep a copy of it. It holds the keys the database uses, and it is
never committed.

## Spaces

The spaces' code is in the volume `tamari_spaces`, which the app sees as `workspaces/`: one folder per
space, `spaces.json` (the sidebar's list) and a git repo with their history.

- **Tamari's own spaces** are the folders this repo ships in `workspaces/` (the image keeps a copy).
  They belong to Tamari: every start copies them over the same folders in the volume, adds any of
  their `spaces.json` entries the volume lacks, and commits that as "Shell update …". An edit inside
  one of these folders is overwritten. To hide one, hide it in the app; removed from `spaces.json`,
  it comes back at the next start.
- **Every other folder is yours.** Starts and upgrades never touch it.
- A change to a file in the volume rebuilds the app. When the build passes, the new version starts
  before the old one stops, so no request is dropped. When it fails, the old version keeps serving,
  and the errors are in `.build-status.json`:
  `docker compose exec app cat .build-status.json`.
- If the spaces don't build when the app starts, it serves the last build that passed, which after
  an upgrade is Tamari with only its own spaces. The log says so in capitals.
- The history: `docker compose exec app git -C workspaces log`. To undo a change, use git in the same
  way (`git -C workspaces checkout -- <folder>`, or `revert`); the app rebuilds by itself.
- **Packages.** A space may list npm packages in its `.miso/package.json` (`dependencies` only,
  exact registry versions such as `4.1.0`). Before each build the app installs what changed into the
  space's `.miso/node_modules`, from the npm registry, without install scripts and without any keys
  in the install's environment. The packages' own dependencies resolve only to releases at least 3
  days old, and the lockfile is kept in the volume's `.git/` for the next install of the same list. It refuses `file:`, `link:`, git and web addresses (also among the
  packages' own dependencies), scripts, `overrides`, `trustedDependencies`, a `.npmrc` or
  `bunfig.toml` in a space, and a package that would make the build read a file outside its
  packages. A package that can't be installed fails the build, so the change is put back.
  `node_modules` is never in the history; the app keeps the previous install in the volume's `.git/`
  so a put-back needs no network. A member's draft gets no install of its own (README.md, "Connect
  your AI"). Tamari's own spaces keep the packages their image came with. The install needs the app
  container to reach registry.npmjs.org; an unchanged `package.json` needs nothing at a start.
- A space's packages are code that runs in members' browsers (with their session) and, imported by a
  server function, in the app next to the database's keys. The build checks what package code makes
  the bundler read, and runs without the keys in its environment, but nothing checks what a package
  does when it runs. Approve a `package.json` change only for packages you trust, and look at what a
  new package depends on.

## A sample repo

A sample install with example spaces is coming. A sample repo starts a company with spaces
and example rows. Before it runs `install.sh`, it puts them in `selfhost/seed/` (ignored by
git): `spaces.json` and `workspaces/<folder>` in the layout of this repo, and `records.json`, a
list of `{ "collection", "key", "data" }` shared records. A date in `data` can be written as an
offset from the install day: `"@today+3"` (a day, `YYYY-MM-DD`) or `"@month-1"` (a month, `YYYY-MM`).

Only the first start on a new spaces volume uses the seed. Its folders become the company's own
(not Tamari's), and its records are added with the secret key, skipping any record that exists. If
the records can't go in on that start, the log says so and each next start tries again, until they
went in once. After that, later starts and upgrades never touch the spaces or the records, so edits
and removals stay. Without `selfhost/seed/` the
install is the same as without a sample.

## Upgrade

Take a backup of the database first. In this folder:

```sh
docker compose exec -T db pg_dump -U postgres -h localhost postgres > ~/tamari-backup-$(date +%F).sql
```

Then:

```sh
git pull
cd selfhost
docker compose up -d --build
```

The app applies any new migrations when it starts.

## When something is wrong

In this folder: `docker compose ps` shows what runs and what is healthy, and
`docker compose logs app` shows the app's start, the migrations included.

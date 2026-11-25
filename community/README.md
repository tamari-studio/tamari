# Community spaces

Spaces that grew inside real teams, cleaned of everything that belonged to one company. Nothing
here is in Tamari until you add it. The `miso` command, the `.miso/` folders and the `@miso/*`
packages keep their old name.

There are two kinds:

- **Ready to use**: working code. Add it, set the keys it needs, and it runs.
- **Blueprints**: an empty draft. The space has one page and a `SPACE.md` that says what to build:
  the views, the data, the connectors it needs and how to check it. Your own coding agent builds
  it over MCP.

## Add one

In a clone of this repo:

```sh
bun cli/miso.ts template list --community
bun cli/miso.ts template add email-checker --community
```

In an org repo (`docs/org-repos.md`), with the `miso` command:

```sh
miso template add email-checker --community
```

It copies `community/<name>/` next to your other spaces (`workspaces/<name>/` in a clone,
`.miso/spaces/<name>/` in an org repo) and lists it in `spaces.json`. It never overwrites and it
does not touch a database. `--as <folder>` picks another folder name. After that, follow
[`template/README.md`](../template/README.md) ("Add one", the steps after the command): the space is
yours to change.

## Ready to use

- `email-checker`: upload a contacts file and check every address: syntax, throwaway domains,
  shared inboxes and mail servers. Only DNS is asked; nothing is stored.
- `pr-writer`: turn notes into an article in the voice of a style guide you add. Needs the setting
  `PR_WRITER_ANTHROPIC_KEY` on the **Connectors** page.
- `newsletter`: reads news feeds, rates the articles and drafts posts for you to approve. Needs the
  setting `NEWSLETTER_ANTHROPIC_KEY` and your feeds in `views/_sources.ts`; describe your channel in
  `views/_channel.ts`.

`pr-writer` and `newsletter` have packages of their own. Tamari installs them when it builds the
space; to run their tests, run `bun install` in their `.miso/` folder first.

## Blueprints: your agent builds them

Add one, open **Settings → Connect your AI**, connect your coding agent, then ask it to build the
space from `SPACE.md` in the space's folder.

- `floorplan`: an event or venue floor plan with stands, who is placed where, and an export.
- `my-day`: one person's day: calendar and tasks side by side.
- `roadmap`: a roadmap over quarters and an idea board, with decisions that block phases.
- `outreach`: contacts, a pipeline and outreach drafts, sent one click at a time.
- `kpi-board`: targets and actual values for event or team KPIs, from connected sources.
- `budget`: budget against actuals, from a bank export you upload.
- `handbook`: company handbook pages in sections, with search.
- `funding`: find the grants and funders that fit the company, and keep a shortlist.

## What is checked

`cli/community.test.ts` fails when anything in `community/` has a `.env` file, a key-like string
(an API key, a token, a private key), or the name of the company the spaces came from. It also
installs every space into a temporary folder, type-checks them, and runs the tests of the working
ones.

## Add a space here

1. Make `community/<name>/` with `template.json` (`title`, `space`, `job`) and a `.miso/` folder
   like [`template/spaces/<type>/`](../template/README.md). A blueprint also has a `SPACE.md`.
2. Add one line to the right list above. The test checks that every space has one.
3. A named setting goes on the **Connectors** page with no value; never put a value in a file.

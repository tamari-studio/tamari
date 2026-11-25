# Handbook

A company handbook in the app: pages grouped into sections, found by search, read in a clean page view, brought in from markdown files or a docs site, and each showing when it was last updated.

## Who uses it

- Everyone in the company reads pages and searches.
- Page owners (for instance the head of people for the leave policy) edit pages and keep the contents in order.
- An admin or owner runs imports and adds the Connectors. The space has no roles of its own; limit who can open it on the Space access page.

## Views

**Handbook**
- Shows a contents list (sections with their pages, the open page marked), a search field, and the page: title, summary, "Updated" with the day and who, the rendered text, previous and next page links, and an "Edit" button. A page not updated for over a year also says "May be out of date". On a narrow screen the contents fold into a "Contents" button above the page.
- A person can open a page, follow links between pages (the page opens in place and scrolls to the top), search, and open Edit. `focusTab` can open a given page or a search.
- Search starts at two characters. Results show title, section and a short snippet; Enter opens the first result; Escape clears.
- Text is shown from markdown with raw HTML switched off: tags appear as text and nothing in a page can run. Links work only for https, mailto, in-page anchors and other pages; any other kind is dropped. Images load only from https addresses.
- Loading: a skeleton of contents lines and a title. Empty: "The handbook has no pages yet" with "Add a page", "Import pages" and "Load examples". No search result: says no page matches and suggests fewer words. Page gone: "That page is gone" with a link to the first page. Error: what failed and "Try again".

**Edit page**
- Shows title, summary, section, and the markdown text with a preview toggle and a character count. A person can save, or delete the page after a confirmation that names it.
- Opened for a new page, or for a page key. Loading and error states as above. A refused save shows its sentence beside the field and keeps the text. If someone saved the page after it was opened, the save is refused with "Someone changed this page. Copy your text, reload and apply it again."

**Organise**
- Shows sections with their pages in order. A person can add, rename and delete sections (only empty ones), move a page up or down or to another section, and reorder sections.
- Empty: "Add a section to start". Errors as above.

**Import**
- Two tabs. "Markdown files": choose files or a folder, or paste one page, then read a preview that lists each page as create, update, unchanged or skipped with the reason. "Import N pages" saves; a result line gives the counts and the problems. "Docs site": lists the site's pages to tick, then imports them.
- Pages edited in the handbook since their last import are skipped unless "Overwrite edited pages" is ticked. The last import (time, counts, problems) stays visible.
- Without the connectors the "Docs site" tab names the settings to add on the Connectors page; file import still works. Errors say what failed and what to change, never show a token.

## Widgets

- **Recently updated**: the latest pages as title and day. At 2x2 show two titles only; when larger add the day, then the section. Show only the rows that fit, with "+N more" when it helps.
- **Find in handbook**: a search field that opens the Handbook view on the query, with the page count under it. At 2x2 show the field only; drop the count first.

## Data

Rows are shared records. Rows are checked on save and again on read; a row that fails is left out, so every field added later must be optional with a default (empty text, null, false or the first allowed value), and old rows keep working. All text is free text.
- `handbook-sections` (40 rows): key `s-` and a random id. `name` text, required, 60 characters; `summary` text, 160; `order` whole number 0 to 999 (default 0).
- `handbook-pages` (300 rows): the key is the page's address name, 1 to 64 of a-z, 0-9 and "-". It comes from the title for a page made in the app (a taken name gets "-2", "-3"; a title with no letters or digits gives "page"), or from the source path for an imported page, and never changes after. `title` text, required, 120; `summary` text, 200; `section` a section key or empty (shown under "Other pages"); `order` whole number 0 to 9999; `updated` date and time set by the server; `updatedBy` set by the server, empty for imports; `source` one of app, file, docs (default app); `sourcePath` text, 200; `editedHere` true or false; `searchText` set by the server only, 3000 characters: the headings, then the text without markup, never sent to the browser.
- `handbook-bodies` (300 rows): same key as the page; `body` markdown text, 50000 characters. Read one at a time by key, never listed.
- `handbook-imports`: one row, key `last`: `at`, `kind` (file or docs), counts `created`, `updated`, `unchanged`, `skipped`, and `problems`, up to 20 texts of 200 characters.
- "Updated" changes when title, summary or body changes in the app, never when a page is only moved. An import sets it to the source's own modified time when the source gives one, else the time of the import, and only for pages that changed.
- Search covers title, summary and the first 3000 characters of text, so it never reads every body.

## Server functions

Every function starts with `requireCaller()`. Every argument comes from the browser: check type, length, allowed values and that each key matches `[a-z0-9][a-z0-9-]{0,63}` and exists. Thrown messages are plain sentences, with no token or upstream response in them.
- `listContents()`: sections and pages, without bodies or `searchText`, in order.
- `getPage(key)`: the page and its body; an unknown key gives "That page is gone."
- `searchPages(query)`: trimmed text of 2 to 80 characters; every word must appear (ignoring case); 20 results at most, title matches first, snippets of 160 characters in plain text.
- `savePage(input)`: applies the field rules; `section` must exist; body at most 50000 characters; `expectedUpdated` (empty for a new page) must equal the stored value; refuses a new page when 300 exist; sets `editedHere` on an imported page.
- `removePage(key)`, `saveSection(input)`, `removeSection(key)` (refused while it holds pages).
- `arrangeSections(keys)` and `arrangePages(section, keys)`: a list of 300 keys at most, no repeats, all existing.
- `previewImport(files)` and `runImport(files, options)`: `files` is a list of 100 at most, each with a `path` (200 characters, no `..`, not absolute, ending in .md, .markdown or .txt) and `text` (50000 characters), 1000000 characters in all; `options.overwriteEdited` is true or false. `runImport` checks everything again and does not rely on the preview. A bad file is skipped with a reason; the rest go in.
- `docsStatus()`: only whether each connector is set, never a value. `listDocsPages()` and `importDocs(paths, options)`: the paths must be in the list the site just returned (the browser never sends an address); 100 at most; each fetch has a timeout and a size limit.
- `lastImport()`, `loadExamples()`, `removeExamples()` (example keys start with `example-`).
- Import rules: the title is the first top-level heading, else the file name in words; front matter is read only for `title` and `description`; an optional contents file (a nested list of links) sets sections and order, else folders do; nesting deeper than two levels is flattened into its section and counted in the result; links to other imported files become page links, links to unknown files become plain text; relative images become their description text; raw HTML, scripts, frames and forms are dropped; callouts, tabs and embeds from docs sites become plain markdown and unknown blocks keep their inner text. Two files that give one key: the second is skipped. A body equal to the stored one counts as unchanged and touches nothing.

## Connectors

- `HANDBOOK_DOCS_BASE_URL`: the address of a docs site to import from, for instance a GitBook space, or any site that gives a contents list and each page as markdown. Only an https address that is not private or loopback is accepted. Without it the Docs site tab says it is not set up.
- `HANDBOOK_DOCS_TOKEN`: an access token for that site, needed only when it asks for sign-in. Without it only public pages import; a refusal shows as "The docs site did not accept the access token."
- The adapter for the chosen site lives in one server file. No AI key is needed. With no connector set, the space works fully on its own shared records.

## Acceptance checks

1. Given no pages, when a person opens Handbook, then they see the empty state with "Add a page", "Import pages" and "Load examples".
2. Given a page saved in the app, when it is opened, then "Updated" shows today's day and the contents list shows it in its section.
3. Given two people open one page and the first saves, when the second saves, then it is refused with "Someone changed this page" and the first text stays.
4. Given a body with a script tag, an image tag with an onerror attribute and a link that starts with "javascript:", when the page is read, then nothing runs and the link is not clickable.
5. Given a title of 121 characters or empty, or a body over 50000 characters, when saved, then it is refused naming the limit and nothing is saved.
6. Given a search for two words that both occur in one page's summary, when run, then that page is listed with a snippet; for a word found nowhere, then "no page matches" shows.
7. Given a search of one character, when typed, then no search runs and the field asks for at least two characters.
8. Given three markdown files in two folders, when imported, then the preview shows "create" for each, sections are named after the folders, and links between the files open the right pages.
9. Given the same files imported again unchanged, when the import runs, then every page is "unchanged" and no "Updated" value moves.
10. Given a page edited in the app after an import, when the files are imported again, then it is skipped unless "Overwrite edited pages" is ticked.
11. Given a file path that contains `..` or ends in .exe, when `runImport` is called without a preview, then that file is skipped with a reason and the others import.
12. Given a section that holds pages, when it is deleted, then it is refused and the pages stay.
13. Given the store cannot be reached, when Handbook opens, then it shows what failed and "Try again", with no half-drawn contents.
14. Given no docs connector, when the Docs site tab opens, then it names the settings to add; given a wrong token, the message does not show it.

## Out of scope

Drafts and approval flows, comments, access rules per section, a screen for earlier versions of a page (shared records already keep them), uploading or hosting images, scheduled sync, export, translations, sections nested deeper than two levels, full-text search beyond the first 3000 characters, showing a docs site in a frame, and printing.

Build it with your coding agent: read README.md ("Rules for space code") and docs/space-design.md first, copy .miso/ui/kit.tsx and use its components.

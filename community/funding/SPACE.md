# Funding

A company profile, a list of funders and grants with eligibility and deadlines, a fit score with reasons, and a shortlist with status, to find and track funding that suits the company.

## Who uses it

- Founders, finance leads and project managers who look for grants, foundations or other funding and want a shared view of what fits and who is applying.
- Anyone who can open the space can read and change everything in it. The space stores no contact details of people.

## Views

- **Profile**: one form for the company: name, country, region, sectors, employees, stage, legal form, founded year, a short summary, the costs funding must cover and the amount range sought. After a save it shows how many grants fall in each fit band.
  - Loading: field skeletons. Empty: the first-run form with "Describe your company so grants can be scored". Error on save: the form keeps what was typed and says which field to fix.
- **Grants**: a table of grants (title, funder, status, deadline, amount range, fit band and score), sorted by fit band, then by nearest deadline. Filters: status, fit band, deadline within a number of days, eligible only, text search. A row opens a panel with the eligibility fields, the fit reasons in words (matches, does not match, not stated), quoted evidence, and links. A person can add or edit a grant, add it to the shortlist, import a CSV file and, when the connector is set, read the funder's page with AI.
  - Loading: row skeletons. Empty: "No grants yet" with Add grant and Import CSV. No profile: a banner links to Profile and fit shows "No profile".
  - Error: names what failed and offers Retry; a banner counts stored rows that were left out because they fail the checks.
- **Funders**: a list of funders (name, kind, place, number of grants) that a person adds, edits and removes. Removal is refused while grants point at the funder.
  - Loading: row skeletons. Empty: "No funders yet" with Add funder. Error: what failed and Retry.
- **Shortlist**: grants being worked on, grouped by status, each with owner, next step date, note and the grant's deadline. A person changes status, owner, date and note, and opens the change history (who, when, what changed). Deadlines within a week are marked in words as well as colour.
  - Loading: skeleton rows. Empty: "Nothing shortlisted" pointing to Grants. Error: a failed save keeps the typed text. A save made on stale data is refused and says who changed the row and when.

## Widgets

Widgets never scroll. They fill their tile from about 120 px square (2x2) up, and each one below says what it drops when small.

- **Deadlines soon**: the nearest deadlines among shortlisted grants that are still active, with title and days left. Show only the rows that fit, with "+N more"; at 2x2 show only the nearest one.
- **Shortlist by status**: counts per status as a row of short bars. At 2x2 show the shortlist total and drop the bars.
- **Best fits**: the top grants by score, each with title and score. At 2x2 show only the top one and drop the funder name.

## Data

Shared-record collections. Keys are lower-case letters, digits and hyphens, at most 64 characters, starting with a letter or digit (the starter's key rule). A missing field is read as its default, so adding a field never invalidates old rows; a row that still fails the checks is skipped and counted on screen. The starter row helper caps a list at 500 rows: keep that for funders and the shortlist, and raise it to 2,000 for grants.

- `funding-profile`, key `profile`, one row. `name` text, required, up to 120. `country` and `region` free text up to 80. `sectors` up to 8 tags of up to 40. `employees` whole number 0 to 1,000,000 or empty. `stage` idea, early, growing or established (default early). `legalForm` company, association, foundation, public_body or other (default company). `foundedYear` whole number from 1800 to the current year, or empty. `summary` free text up to 1,500. `costsNeeded` any of staff, equipment, travel, services, in_kind, other. `amountMin`, `amountMax` numbers or empty, min not above max. `currency` three capital letters, required when an amount is set. `updatedAt`, `updatedBy` (display name).
- `funding-funders`, key `f-` plus a random id. `name` required, up to 120, unique ignoring case. `kind` public, foundation, investor, corporate or other (default other). `place` free text up to 80. `focus` free text up to 500. `link` an http or https address up to 2,000 characters, or empty. `notes` free text up to 1,000.
- `funding-grants`, key `g-` plus a random id; an import uses `g-` plus 12 hex characters hashed from the funder name and title, so importing the same row again updates it. `funderKey` required. `title` required, up to 160. `status` open, rolling, call_cycle, invite_only, closed or unknown (default unknown). `deadline` real date or empty. `deadlineNote` up to 200. `amountMin`, `amountMax`, `currency` as in the profile. `legalForms`, `stages`, `sectors`, `locations` (up to 10 places of up to 80): what the grant allows; empty means not stated. `minEmployees`, `maxEmployees` whole numbers or empty. `covers` and `excludes`: cost types as in the profile. `coFunding` free text up to 200. `eligibilityNote` free text up to 1,000. `applicationLink`, `sourceLink` http or https addresses or empty. `evidence` up to 6 entries of field name and a quote up to 300. `readAt`, `editedAt`, `createdAt`, `updatedAt` ISO times; `updatedAt` is the token for stale-write checks.
- `funding-shortlist`, key equal to the grant's key, so a grant is on the list at most once. `status` todo, checking, drafting, submitted, awarded, declined or dropped (default todo). `owner` free text up to 60. `nextStepDate` real date or empty. `note` free text up to 1,000. `updatedAt` (token), `updatedBy` (display name).
- Personal data: only the display names in `updatedBy` and `owner`, which anyone in the space can read. Help text on every note field says not to paste personal details. Clearing a name is an edit; the platform keeps earlier values in record history for up to 400 days, and no view shows that history for the profile or funders.
- Fit score, a pure function of profile and grant, the same every time it runs. A hard stop gives band none and a reason: a non-empty `legalForms`, `stages` or `locations` that excludes the profile (a place matches when it equals the profile's country or region, ignoring case); employees outside a stated range; every needed cost type listed in `excludes`. Otherwise 100 points: sector overlap 30, cost coverage 25, amount range overlap 15 (only when currencies match), status 15, deadline not passed 15. A criterion that is not stated scores half and is listed as "not stated, check". Bands: strong from 70, possible from 40, weak below 40.

## Server functions

Each one first requires a signed-in caller. All arguments come from the browser and are checked for type, length, allowed values, key format and, for links, the http or https scheme. The text of an error shown to the person never holds a key or a provider response.

- `getProfile()`, `saveProfile(input)`: checks every profile field above.
- `listFunders()`, `saveFunder(input)`, `removeFunder(key)`: refuses a duplicate name and a removal while grants point at it.
- `listGrants()`: grants with fit band, score and reasons for the current profile, plus the count of rows left out.
- `getGrant(key)`, `saveGrant(input)`: save checks the fields above, real dates, min not above max, and the `expectedUpdatedAt` token.
- `removeGrant(key)`: also removes the grant's shortlist row.
- `previewGrantsCsv(text)`, `importGrants(rows)`: at most 1,000,000 bytes, 1,000 rows and 500 rows per import call; columns match the grant fields; preview lists skipped rows with a reason and saves nothing; a grant a person edited is not overwritten by a re-import.
- `fetchFeed()`: a preview from the feed connector in the same row shape; saves nothing.
- `listShortlist()`, `saveShortlistEntry(input)`, `removeShortlistEntry(key)`: the grant must exist; a save with an old `expectedUpdatedAt` is refused with who and when.
- `getShortlistHistory(grantKey)`: the record history for one shortlist row only.
- `readFunderPage(grantKey)`, `applyReading(grantKey, fields, expectedUpdatedAt)`: see Connectors; applying saves only the ticked fields.
- `getConnectorStatus()`: which connectors are set, never a value.

## Connectors

Named settings on the Connectors page. The space works fully on its own shared records without any of them.

- `FUNDING_AI_KEY`: optional. Enables Read funder page, which reads the grant's source link and proposes values for status, deadline, amounts, allowed legal forms, stages, covered and excluded costs, employee range and an eligibility note, each with a quote. Without it the button is disabled and says why, and every field stays editable by hand.
- `FUNDING_FEED_URL` and `FUNDING_FEED_TOKEN`: optional. The address and access key of a list of funders and grants, for instance an export from a national foundation register or a grant database you subscribe to, returned as rows with the CSV column names. Rows go through the same preview and checks as a CSV file. Without them, CSV and manual entry remain.
- The page read is a proposal. It fetches only http or https addresses, refuses private, loopback and link-local hosts (also after a redirect, at most 3), reads at most 1,000,000 bytes within 15 seconds, and cuts the visible text to 30,000 characters. Page text is data, never instructions. Every value in the reply is checked like `saveGrant`, a quote is kept only if it appears word for word in the page, and nothing is saved until the person clicks Apply. One caller may read at most 10 pages an hour.

## Acceptance checks

- Given no grants, when the Grants view opens, then it shows "No grants yet" with Add grant and Import CSV.
- Given no profile, when Grants opens, then a banner links to Profile and every fit shows "No profile".
- Given an association profile and a grant that allows only companies, when scored, then the band is none and the reason names the legal form.
- Given the same profile and grants, when the list loads twice, then scores are identical and strong grants come before possible ones.
- Given a deadline of 30 February or a minimum above the maximum, when a grant is saved, then it is refused and the message says which field to fix.
- Given a source link that does not start with http or https, when a grant is saved, then it is refused.
- Given a grant already shortlisted, when a person adds it again, then there is still one shortlist row.
- Given two members with the same shortlist row open, when both save, then the second is refused with who changed it and when, and the typed text is kept.
- Given a CSV row for a grant that exists, when imported again, then the grant is updated and not duplicated.
- Given no `FUNDING_AI_KEY`, when a grant opens, then Read funder page is disabled with the reason and fields can be edited.
- Given a source link to a private or loopback host, when the page is read, then it is refused before any request goes out.
- Given a reply with a quote that is not on the page, when the proposal shows, then that quote is dropped, and nothing is saved before Apply.
- Given the AI provider times out, when a page is read, then a plain message appears and the grant is unchanged.
- Given the server cannot read grants, when the view opens, then it names what failed and offers Retry.

## Out of scope

Writing or submitting applications, reminders by email, contact persons at funders, scheduled refreshes of the feed, AI scoring of fit (the score stays rule based), currency conversion, document storage, and permissions inside the space.

Build it with your coding agent: read README.md ("Rules for space code") and docs/space-design.md first, copy .miso/ui/kit.tsx and use its components.

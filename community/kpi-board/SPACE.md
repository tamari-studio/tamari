# KPI board

A space where a team keeps its key numbers, each with a target, a period and an owner, and sees at a glance which ones are on track.

## Who uses it

- Managers and team leads who report on a handful of numbers every period and need to see what is slipping.
- KPI owners, who type in or confirm the latest value for their numbers.
- Anyone who asks where a number came from and who changed it.

## Views

Every view shows its own loading state (a skeleton in the shape of the content). On an error it keeps the last good content on screen, says what went wrong and how to recover, and never shows a token or a raw reply from another service.

### Overview
- On it: a one-sentence summary ("5 of 8 KPIs on track, 2 behind, 1 without a target"), then KPIs grouped by team. Each row has the name, owner, actual value, target, a status word with a marker (on track, watch, behind, no data, no target), and a bar with a mark at where the calendar says the value should be by now.
- Can do: type in a value for a KPI whose source is typed, step back to earlier periods, refresh from the connector when one is set, open a KPI in the ledger or in Insights.
- Empty: "No KPIs yet" with a button to the KPIs and targets view. Error: "Could not load the board", the cause in plain words, and Try again.

### Insights
- On it: a ranked "needs attention" list (behind, watch, stale, set-up gaps), then one line per KPI with value, target, expected value by now, value in the previous period and change over the last 7 days. Selecting a KPI opens its detail: a bar chart of its entries by month and the entries behind the number.
- Can do: filter by team, open a KPI's detail, jump to the view that fixes an item (set a target, add an owner, record a value).
- Empty: with nothing to flag it says everything is on track; with no KPIs it links to KPIs and targets. Error: "Could not build the insights", the cause in plain words, and Try again.

### KPIs and targets
- On it: a table of KPIs with team, owner, unit, measure, direction, cadence, source and the target for the chosen period; a form to add or edit a KPI.
- Can do: add, edit and archive a KPI; set or clear a target for a period; copy the previous period's targets into periods that have none; mark KPIs as headline KPIs (the Headline KPI widget shows the first one in order).
- Empty: "Add your first KPI" with the form open. Error: a message beside the field that failed, saved rows stay as they were.

### KPI ledger
- On it: every change as one line, newest first: when, who, which KPI, what changed (value entered, target set or cleared, KPI edited, value pulled from the connector), before and after, and a note. Choosing a KPI also shows its dated value entries, which add up to the number on the Overview.
- Can do: filter by KPI, team and kind of change, go to the previous month, add a note when entering a value, correct or remove an entry (which adds a ledger line).
- Empty: "No changes yet. Record a value on the Overview." Error: "Could not load the ledger", the cause in plain words, and Try again.

## Widgets

A widget never scrolls and must work from about 120 px square (2x2 cells) up.
- Headline KPI: the first headline KPI with its actual value, status word and target, with a progress bar. Small: the value and status word only. Drop the owner, the bar and the target text first.
- Board status: counts of on track, watch and behind with a stacked bar. Small: the three counts only; the summary sentence and the bar go.
- Needs attention: the top items of the Insights list. Show as many rows as fit, then "+N more"; when small, show the count only.
Each widget has a skeleton while loading, "Open the KPI board to add KPIs" when empty, and "Could not load" with the last values kept when it fails.

## Data

Shared records, read through `collection('<name>')`. Keys use lowercase letters, digits and hyphens, 64 characters at most. A read returns at most 1,000 rows, so collections that grow are keyed by month and read one month at a time by key prefix. Whitespace in text is trimmed and collapsed; text is shown as plain text, never as markup. A field is required unless it says optional or has a default; dates are `YYYY-MM-DD`; `at` is an ISO 8601 time set by the server; `kpi` is the key of an existing KPI.
- `kpi-board-kpis`: key is a slug of the name, 40 characters at most (`signups-per-month`). Fields: name (free text, required, 1 to 80, unique among active KPIs), team (free text, 40, optional), owner (free text, 60, optional, a name as typed), unit (`count`, `money`, `percent`; required), currency (3-letter code, required for money), measure (`cumulative` adds entries within the period, `level` uses the latest reading; default `cumulative`), direction (`up` or `down`; default `up`), cadence (`month`, `quarter`, `year`; default `year`), source (`typed` or `connector`; default `typed`), sourceRef (free text, 120, optional, a hint for the connector such as a query name, never a secret), outlook (whole number or empty: a leading number such as open pipeline that may still turn into actuals), headline (yes/no, default no), order (whole number, default 0), archived (yes/no, default no). At most 200 active KPIs.
- `kpi-board-targets`: key is the KPI key, a hyphen and the period (`signups-per-month-2027-q3`). Fields: kpi (required), period (required: `2027`, `2027-q3` or `2027-07`, matching the cadence), target (whole number above zero, required), currency (for money). Clearing a target deletes the row. At most 2,000 rows.
- `kpi-board-values`: one row per entry. Key is the entry date, the KPI key and a counter (`2027-07-14-signups-per-month-1`). Fields: kpi, date (required, real date, not after tomorrow), value (whole number, required; count and percent not negative), currency (for money), source (`typed` or `connector`), note (free text, 200, optional). A connector reading uses the counter `src`, so a second pull on the same day replaces the first. At most 800 rows per month.
- `kpi-board-ledger`: append-only. Key is date, hours and minutes, and a random suffix (`2027-07-14-0930-x7k2`). Fields: kpi, kind (`value`, `target`, `kpi`, `pull`), before and after (whole numbers or empty), currency (for money), at (required), by (display name set on the server, never an email), note (free text, 200).
- `kpi-board-settings`: key `settings`. Fields: currency (3-letter code, default EUR), decimals (0 to 3, default 2), yearStartMonth (1 to 12, default 1), staleAfterDays (1 to 90, default 14), lastPullAt, lastPullError (short, no secrets).

Money and percentages are whole numbers: money in minor units of the currency (cents for EUR), percent in hundredths of a percent (12.5% is 1250). Never floating point. A year period is named by the calendar year in which it ends: with a year start in April, `2028` runs 1 April 2027 to 31 March 2028; quarters count from the year start. When a field is added later, rows saved without it get its default on read; a row that fails the check is left out of lists, not a crash. Revenue and other targets can be sensitive: after installing, limit who can open the space on the Space access page. Server functions check only that someone is signed in, so anyone who can open the space can change values and targets; every change is in the ledger.

## Server functions

Each calls `requireCaller()` first. Every argument comes from the browser, so each is checked on the server. An error message is a plain sentence the person can act on, with no token and no reply from another service.
- `getBoard(today, back)` and `getInsights(today, back)`: today must be a real date within one day of the server's date; back is a whole number from 0 to 12. They compute status on the server.
- `getKpiDetail(kpi, today, back)`: the KPI key must exist.
- `listKpis()`, `saveKpi(input)`, `archiveKpi(key)`: check lengths, allowed values, name uniqueness, the 200 limit, and that a money KPI has a currency.
- `listTargets(today, back)`, `saveTarget(kpi, period, target)`, `copyTargets(today)`: period must match the KPI's cadence; target must be a whole number above zero, or empty to clear.
- `recordValue(kpi, date, value, note)`, `editValue(key, value, note)`, `removeValue(key)`, `setOutlook(kpi, value)`: whole numbers only, the KPI's source must be `typed`, the monthly limit applies.
- `listLedger(filter, month)`: filter fields are optional but checked; month is `YYYY-MM`.
- `refreshFromSource(today)`: needs the connector settings; one refresh at a time; a refresh within 10 minutes of the last returns the stored result; one failing KPI does not stop the others.
- `getSettings()`, `saveSettings(input)`: ranges as in Data.

Status: for `cumulative` KPIs the expected value is the target times the share of the period that has passed; for `level` KPIs it is the target. With direction `up`, a KPI is on track at 95% of expected or more, watch when below that but actual plus outlook reaches the target, behind otherwise. Direction `down` mirrors the comparison and has no watch state. No value gives no data; no target gives no target.

## Connectors

Named settings on the Connectors page. The space works without any of them: every value is then typed in.
- `KPI_BOARD_SOURCE_BASE`: the address of a service that holds actual numbers, for example a spreadsheet or ticketing service. Without it, KPIs with source `connector` show "No data" and the refresh button is hidden.
- `KPI_BOARD_SOURCE_TOKEN`: the access key for that service. Without it, refresh explains that a key is missing.
The build agent writes one small adapter for the person's service: given a KPI's `sourceRef` and a date range, it returns whole numbers in the KPI's stored unit. No AI key is needed.

## Acceptance checks

1. Given no KPIs, when the Overview opens, then it shows the empty state with a button to KPIs and targets.
2. Given a cumulative KPI with a year target of 1,200 halfway through the year, when the actual is 580, then it reads on track; with actual 500 and outlook 800 it reads watch; with outlook 100 it reads behind.
3. Given a KPI with direction `down` and level measure, target 10, when the latest reading is 8, then it reads on track.
4. Given a KPI without a target for the period, when the Overview opens, then it reads no target and Insights lists "set a target".
5. Given a target of 0, -5 or "abc", when saved, then the server refuses it with a plain message and the old target stays.
6. Given a KPI name already used by an active KPI, or a period `2027-q3` on a monthly KPI, when saved, then it is refused.
7. Given a typed value is saved, when the ledger opens, then a line shows who, when, before, after and the note, and the Overview shows the new value without a reload.
8. Given any ledger line, when someone tries to edit or delete it, then no view or server function allows it.
9. Given the connector token is wrong, when refresh runs, then stored values stay, the board says the refresh failed and when it last worked, and no token or raw reply is shown.
10. Given no connector settings, when the Overview opens, then typed values work and the refresh button is hidden.
11. Given a typed KPI with no new value for the stale period, when Insights opens, then it is listed as stale.
12. Given a row saved before a field existed, when the board loads, then the default is used and the row shows.
13. Given the store fails, when a view loads, then it shows the error state with Try again and keeps earlier content.
14. Given a widget at 2x2 cells, when it renders, then nothing scrolls or is cut off.

## Out of scope

Weekly periods, role-based permissions beyond Space access, alerts by email or chat, forecasting, several currencies, targets that change inside a period, an AI summary, and importing many KPIs from a file.

Build it with your coding agent: read README.md ("Rules for space code") and docs/space-design.md first, copy .miso/ui/kit.tsx and use its components.

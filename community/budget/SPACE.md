# Budget

A space that compares what a team planned to spend with what actually left its bank account, using a statement file the person exports and uploads.

## Who uses it

- Finance leads and founders who set a yearly budget per category and want to see what is left.
- Team members who check a planned payment against the budget before they commit to it.
- Anyone who reviews the company's budget against actuals at the end of a month.

## Views

Every view shows its own loading state (a skeleton in the shape of the content). On an error it keeps the last good content on screen, says what went wrong and how to recover, and never shows a token or a raw reply from another service.

### Import
- On it: a file chooser (CSV, tab-separated text or a workbook; with several sheets the person picks one), a field for an account label, a mapping panel, a preview of the first 20 rows, and a list of earlier imports.
- Statement formats differ by bank, so the importer only suggests a mapping and the person confirms it: the date column and its order (day first, month first, year first), the text column (one or more, joined), the amount (one signed column, or separate money-out and money-in columns), the decimal mark and thousands separator, which sign means money out, and an optional category and currency column. A header row is looked for in the first 10 lines; lines above it are listed as skipped. A mapping used before is offered again when the header row matches, still for confirmation.
- Can do: confirm the mapping, import, undo an import (removes the rows it added).
- The preview shows counts of rows to add, duplicates and skipped rows (line number and reason, first 50). Import stays disabled until the mapping is confirmed.
- Empty: "No statement yet. Export one from your bank and choose the file here." Error: says which step failed (file unreadable, no date or amount column, no valid rows, too large) and what to change. A failed save says how many rows were saved and offers Undo or Retry (retry skips duplicates).

### Transactions
- On it: one month at a time (default: the latest month with data), a table of date, text, amount and category with how it was set (rule, file, manual, none), filters (category, uncategorised only, text), and a rules panel.
- Can do: change a row's category (it becomes manual and is never overwritten), create a rule from a row, add, edit, reorder and remove rules, run "Apply rules" (reports how many rows changed), add and rename categories.
- Empty: "Nothing for this month" with a link to Import. Error: "Could not load this month" or "Could not save the change", the cause in plain words, the row left as it was, and Try again.

### Budget
- On it: a year picker and one line per category: planned amount for the year, optional revised amount, the monthly equivalent, group, and approval limit; planned income, planned spending and the planned surplus.
- Can do: add, edit and remove lines; "Fill from actuals" proposes empty lines from the spending of the last 12 months (or the span imported, scaled to a year, with a warning when under 60 days), rounded to the nearest 100 whole currency units.
- Empty: "No budget for this year" with the Fill from actuals button, or a plain form when nothing is imported. Error: a message beside the field that failed.

### Pay check
- On it: a form (category, amount, due date, description) and the answer: allow, needs approval or block, shown as a word and a marker, with each check on its own line (fits the budget, approval limit, pace, planned surplus), what is left before and after, and the list of planned payments.
- Can do: save the checked payment as planned (it counts as reserved), mark it paid or cancelled, remove it.
- Empty: "No planned payments". Error: the check could not run, with the reason and Try again.

### Summary
- On it: month or year to date, rows grouped by group, then category: planned, spent, reserved, left, share used, a word "over budget" where it applies, totals, planned and actual income, and notes (uncategorised share above a quarter of spending, spending in categories with no budget line, no import in the last 35 days).
- Can do: switch between a month and the year to date, pick the month, open a category's rows in Transactions.
- Empty: "Import a statement and set a budget to see this", with both links. Error: "Could not build the summary", the cause in plain words, the last figures kept on screen, and Try again.

## Widgets

A widget never scrolls and must work from about 120 px square (2x2 cells) up.
- Budget left: total left in the year across spending lines, a bar of the share used with a mark for the share of the year that has passed. Small: the number and a short label; drop the bar, then the label.
- Top categories: categories by share used, with bars. Show as many rows as fit and then "+N more"; when small, show only the fullest one.
- Needs a category: count of uncategorised rows this month and the next step (open Transactions). Small: the count only.
Each has a skeleton while loading, "Import a statement to start" when empty, and "Could not load" with the last numbers kept on failure.

## Data

Shared records, read through `collection('<name>')`. Keys use lowercase letters, digits and hyphens, 64 characters at most. A read returns at most 1,000 rows, so transactions are keyed by month and read one month at a time by key prefix. Whitespace in text is trimmed and collapsed. Statement text is untrusted: it is shown as plain text and used only for plain "contains" matching, never as markup or a pattern. A field is required unless it says optional or has a default; dates are `YYYY-MM-DD`; `at` is an ISO 8601 time set by the server; `category` is the key of an existing category; `order` is a whole number, default 0.
- `budget-settings`: key `settings`. Fields: currency (3-letter code, default EUR), decimals (0 to 3, default 2), yearStartMonth (1 to 12, default 1). One currency per space in this version.
- `budget-categories`: key is a slug of the name (`software-and-subscriptions`). Fields: name (free text, 40, required, unique), kind (`income`, `spending`, `excluded`; default `spending`), order. First open creates a neutral set: Income, Payroll, Rent and utilities, Software and subscriptions, Travel, Marketing, Office and supplies, Fees and taxes, Transfers (excluded). `uncategorised` always exists and cannot be renamed or removed. At most 60. Removing a category moves its rows to uncategorised, and is refused while it has budget lines.
- `budget-rules`: key `rule-` and a random suffix. Fields: match (free text, 80, required; case-insensitive "contains"; no wildcard or pattern language), category (required), direction (`any`, `in`, `out`; default `any`), order (whole number; lowest first wins). Starts empty. At most 300.
- `budget-transactions`: key is the month and a fingerprint of account label, date, amount, text and the row's position among identical rows of that day (`2027-07-` and the fingerprint), so importing an overlapping file adds only new rows. Fields: date (real date), text (free text, cut at 200), amount (whole number, not zero, negative means money out), currency (must equal the settings currency), account (free text label, 40, never an account number), category (default `uncategorised`), categorySource (`none`, `rule`, `file`, `manual`; default `none`), importId. At most 900 per month.
- `budget-imports`: key is date, time and a random suffix. Fields: fileName (free text, 120), account, at, added, duplicates, skipped (whole numbers), mapping (column numbers and formats, plus the lowercase header row, 300), status (`done`, `partial`, `undone`).
- `budget-lines`: key is the year and the category key (`2027-travel`). Fields: year (named by the calendar year the budget year ends in), category (not `excluded`), planned (whole number, zero or more), revised (whole number or empty; when set, checks and the summary use it and show planned beside it), currency, group (free text, 40, optional, a team or cost centre), approvalLimit (whole number above zero or empty), note (free text, 200). At most 100 per year.
- `budget-planned`: key `plan-` and a random suffix. Fields: description (free text, 120, required), category, amount (whole number above zero), currency, dueOn (real date), status (`planned`, `paid`, `cancelled`; default `planned`), decision (`allow`, `needs-approval`, `block`, as shown when saved). At most 500.

Money is whole minor units of the currency (cents for EUR) with its currency code on every row that holds money, never floating point. Typed amounts allow digits, one decimal mark (dot or comma) and at most `decimals` places, no thousands separators; the server receives integers only. When a field is added later, rows saved without it get its default on read; a row that fails the check is left out of lists, not a crash. Only the mapped columns are stored, so drop sensitive columns from the file first. This is financial data: after installing, limit who can open the space on the Space access page. Server functions check only that someone is signed in, so anyone who can open the space can change the budget.

## Server functions

Each calls `requireCaller()` first. Every argument comes from the browser, so each is checked on the server. An error message is a plain sentence the person can act on, with no token and no pasted statement text.
- `getSettings()`, `saveSettings(input)`: currency code is three letters, decimals 0 to 3, start month 1 to 12.
- `listCategories()`, `saveCategory(input)`, `removeCategory(key)`; `listRules()`, `saveRule(input)`, `removeRule(key)`: lengths, allowed values, uniqueness, limits, and that the category exists.
- `checkImport(rows)` and `importTransactions(rows, details)`: at most 1,000 rows per call (the browser sends batches, parsed from the file in the browser); each row needs a real date, a non-zero whole-number amount, the settings currency, and text of at most 200 characters; `details` is checked too (file name at most 120 characters, account label at most 40, mapping a small object of column numbers and known formats, header row at most 300 characters); the 900-per-month limit applies.
- `listImports()`, `undoImport(key)`: the key must exist and not be undone already.
- `listTransactions(month, filter)`: month is `YYYY-MM`; `setCategory(key, category)`: the row and the category must exist; `applyRules()` leaves manual rows alone.
- `listBudgetLines(year)`, `saveBudgetLine(input)`, `removeBudgetLine(key)`, `fillFromActuals(year, today)`: year is a whole number from 2000 to 2100; amounts are whole numbers.
- `checkPayment(input, today)`, `savePlanned(input, today)`, `setPlannedStatus(key, status)`, `removePlanned(key)`, `listPlanned()`: `today` must be a real date within a day of the server's.
- `getSummary(period, today)` and `getWidgetData(today)`: period is `month` with a `YYYY-MM` month, or `year` with a whole year.

Spent is money out minus money in for the category since the budget year started, up to today, so a refund lowers it; `excluded` categories never count. Reserved is the sum of planned payments not settled. A payment marked paid stays reserved until an imported transaction in the same category, within one currency unit of its amount and dated no earlier than a week before its due date, appears; each transaction settles one payment. Left is planned (or revised) minus spent minus reserved. Pay check blocks when the category has no line or the amount is above what is left. Otherwise it needs approval when the amount is above the line's approval limit (default a quarter of what is left), when spent plus reserved plus the amount is more than 10% ahead of an even spread of the plan over the days of the year, or when committed spending would exceed planned income (skipped when no income is planned). Otherwise it allows.

## Connectors

None is needed. The space only takes a file the person exports and uploads. It never asks for a bank login, a bank connection key or an account number, and the build must not add them. A later version may add a connector only if it reads a file or report the person chooses to share.

## Acceptance checks

1. Given a file with a few lines above the header, when it is opened, then the header row is found and those lines are listed as skipped.
2. Given a mapping the person has not confirmed, when they look at Import, then the Import button is disabled and nothing is stored.
3. Given dates such as 03/04/2027, when previewing, then the person must pick day first or month first, and the preview shows the resulting dates.
4. Given the amounts "1.234,50" and "1,234.50" with the matching marks chosen, in EUR with 2 decimals, when imported, then both are stored as the same whole number, 123,450 minor units.
5. Given a row with an unreal date or an amount that is not a number, when importing, then that row is skipped with its line number and reason and the others are saved.
6. Given the same file imported twice, when the second import runs, then it adds no rows and reports the duplicates; two identical rows on one day in the file are both kept.
7. Given a file with more than 5,000 rows, or one that would take a month past 900 rows, when it is chosen, then it is refused with advice to split it by date range and nothing is stored.
8. Given two rules that match one row, when rules are applied, then the lower order wins, and a row whose category was set by hand is unchanged.
9. Given a line planned at 1,200.00 with 400.00 spent and 300.00 reserved, when a payment of 600.00 is checked, then the answer is block with 500.00 left before; a payment of 150.00 above the line's approval limit of 100.00 is needs approval and names that check.
10. Given a file that cannot be read, or has no date or amount column, when it is chosen, then the view names the step that failed, says what to change, and stores nothing.
11. Given an amount of 12.5, -3 or "abc" sent straight to a server function, when saved, then it is refused and nothing changes.
12. Given the store fails during a save, when the person looks at the view, then it shows the error with Try again, and an import says how many rows were saved and offers Undo or Retry.
13. Given nothing imported and no budget, when Summary opens, then it shows the empty state with links to Import and Budget.
14. Given a widget at 2x2 cells, when it renders, then nothing scrolls or is cut off.

## Out of scope

Several currencies, bank connections or bank login, automatic imports, splitting one transaction across categories, recurring-payment detection, regular-expression rules, approval workflows with named approvers, forecasting, and more than 900 transactions a month.

Build it with your coding agent: read README.md ("Rules for space code") and docs/space-design.md first, copy .miso/ui/kit.tsx and use its components.

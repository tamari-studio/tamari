# Roadmap

A shared idea board and delivery roadmap: people propose and vote on ideas, the team lays out phases over quarters with gates, and an open decision can block a phase until someone settles it.

## Who uses it

- Team members add ideas and vote on them.
- Leads and phase owners lay out phases, tick gates and settle decisions.
- Everyone who can open the space can change everything in it. The space has no roles of its own; limit who can open it on the Space access page.

## Views

**Ideas**
- Shows a list of ideas with title, vote count, status, linked phase and who added it. Sort by votes or newest; filter by status.
- A person can add and edit an idea, vote or take their vote back, change the status, link a planned idea to a phase, and delete an idea.
- Loading: a skeleton of list rows. Empty: says there are no ideas and offers "Add an idea" and "Load examples". Error: says the ideas could not be loaded and offers "Try again". A refused vote or save shows its sentence beside the control and keeps what the person typed.

**Roadmap**
- Shows a timeline of phases as bars over quarters, with milestone markers above and a "now" marker. The range runs from the earliest start to the latest end (at most 20 quarters) and scrolls sideways inside its own region. Below it, the selected phase shows its objective, owner, window, headcount and budget when set, gates with tick boxes, linked ideas, the decisions that block it, and its stop condition.
- A person can select a phase, add, edit and delete phases and milestones, tick a gate, and change a phase's state. A phase shows one of: not started, in progress, complete, and the word "Blocked" when an open decision blocks it.
- Loading: a skeleton timeline. Empty: "No phases yet. Add the first phase". Error: what failed and "Try again"; no half-drawn timeline.

**Decisions**
- Shows open decisions first, then settled and dropped ones: title, owner, due day, critical mark, and the phases each one blocks. An open decision past its due day says "Overdue" in words.
- A person can add and edit a decision, settle it with an outcome, drop it, reopen it and delete it.
- Loading, empty ("No decisions. Add one when a phase cannot start without an answer") and error states as above.

**Present**
- Shows one full-page step at a time, built from the roadmap data: a title step, one step per phase (name, window, objective, gates, open blocking decisions, stop condition) and a last step listing open decisions.
- Arrow keys, Home and End move between steps; "n" shows the phase's notes; Escape goes back to the first step. It has no data of its own.
- Empty: "Add a phase on the Roadmap view first", with a button that opens it. Error: as above.

## Widgets

- **Roadmap status**: the current phase name, a bar of gates met with the count ("3 of 5 gates"), and how many open decisions block it. Current phase = the earliest in-progress phase, else the earliest not started, else "All phases complete". At 2x2 keep the name and the bar. When larger, add the window, the blocked line and a button that opens Roadmap. Drop in this order: button, blocked line, window, label.
- **Top ideas**: the ideas with the most votes that are new or planned, as title and vote count. Show only the rows that fit, with "+N more" when it helps; drop the status first, then the counts' label. At 2x2 show two rows.

## Data

Rows are shared records. Keys are made by the server (`r-` and a random id), except example rows (`example-1` and so on, which "Remove examples" deletes). Rows are checked on save and again on read; a row that fails is left out, so every field added later must be optional with a default (empty text, empty list, null, false or the first allowed value), and old rows keep working. All text is free text shown as plain text, never as HTML.
- `roadmap-ideas` (500 rows at most): `title` text, required, 120 characters; `detail` text, 1000; `status` one of new, planned, building, shipped, declined (default new); `reason` text, 200, required when declined; `phase` a phase key or empty, allowed only for planned, building or shipped; `voters` list of member ids, 500 at most, set by the server and never sent to the browser; `addedBy` and `added` (day) set by the server.
- `roadmap-phases` (30 rows): `name` text, required, 80; `objective` text, 600; `start` and `end` quarters written as the year, a dash, Q and 1 to 4, both required, end not before start, 20 quarters at most; `state` one of not-started, in-progress, complete (default not-started); `owner` text, 60; `headcount` whole number 0 to 100000 or null; `budget` number 0 to a trillion or null, in whatever unit the team uses; `gates` up to 10 of {`criterion` text, required, 120; `measure` text, 200; `met` true or false, default false}; `stop` text, 300; `notes` text, 1000. Phases are ordered by start, then end, then name; no order is stored.
- `roadmap-decisions` (200 rows): `title` text, required, 120; `detail` text, 600; `owner` text, 60; `due` a day (YYYY-MM-DD) or empty; `critical` true or false; `status` one of open, settled, dropped (default open); `outcome` text, 400, required when settled; `settled` day set by the server; `blocks` list of phase keys, 10 at most, no repeats, each must exist. A decision blocks a phase only while it is open.
- `roadmap-milestones` (60 rows): `label` text, required, 60; `quarter` a quarter as above, required; `kind` one of release, approval, funding, other (default other).
- Votes live in the idea's `voters` list. Two people voting in the same second can lose one vote; the first version accepts that.

## Server functions

Every function starts with `requireCaller()`. Every argument comes from the browser: check type, length, allowed values and that each key matches `[a-z0-9][a-z0-9-]{0,63}` and exists. Thrown messages are plain sentences with no stored data in them.
- `listIdeas()`: ideas with `votes` (a count) and `voted` (whether the caller voted) in place of `voters`.
- `saveIdea(input)`: new or existing; applies the field rules; `phase` must exist; refuses a new idea when 500 exist.
- `setIdeaStatus(key, status, reason)`: status must be allowed; a reason is needed for declined; moving to new or declined clears `phase`.
- `toggleVote(key)`: refused for shipped and declined ideas; adds or removes the caller's id.
- `removeIdea(key)`.
- `listPhases()`: phases with derived `blockedBy` (open decisions) and a linked-idea count.
- `savePhase(input)`: applies the field rules, including quarter format, end not before start and the 20-quarter span.
- `setPhaseState(key, state)`: refused for in-progress or complete while an open decision blocks the phase (the message names it), and refused for complete while any gate is unmet (names the first).
- `setGate(phaseKey, index, met)`: index a whole number inside the list, `met` true or false; unticking a gate on a complete phase moves it to in-progress.
- `removePhase(key)`: first clears `phase` on its ideas and removes the key from every decision's `blocks`, then deletes it.
- `listDecisions()`, `saveDecision(input)`, `settleDecision(key, status, outcome)` (status settled or dropped; settled needs an outcome), `reopenDecision(key)`, `removeDecision(key)`.
- `listMilestones()`, `saveMilestone(input)`, `removeMilestone(key)`.
- `getStatus()` and `topIdeas(limit)` for the widgets; `limit` a whole number from 1 to 10.
- `loadExamples(today)` and `removeExamples()`; `today` must be a real day.

## Connectors

- `ROADMAP_CHAT_WEBHOOK`: the incoming-webhook address of a team chat channel (for instance a Slack channel). When set, the server posts one plain line when a phase changes state, a decision is settled or an idea becomes planned. Only an https address is accepted. A failed post never fails the save and is logged without the address. Without it, nothing is posted; every view works.
- No other connector. The space runs on its own shared records.

## Acceptance checks

1. Given no ideas, when a person opens Ideas, then they see the empty state with "Add an idea" and "Load examples".
2. Given a new idea, when a person votes, then its count goes up by one and the button shows the vote; when they vote again, the vote is taken back.
3. Given two members voted, when the list loads, then the count is two and the response holds no member ids.
4. Given a shipped idea, when someone votes, then the call is refused with a sentence and the count is unchanged.
5. Given a title of 121 characters, an empty title, or a declined status with no reason, when an idea is saved, then it is refused with a sentence naming the problem and nothing is saved.
6. Given an end quarter before the start quarter, or a quarter such as "Q5", when a phase is saved, then it is refused.
7. Given an open decision that blocks a phase, when someone sets the phase to in progress, then it is refused naming the decision; after the decision is settled with an outcome, it succeeds.
8. Given a phase with one unmet gate, when it is set to complete, then it is refused naming the gate; once every gate is ticked it succeeds, and unticking one returns it to in progress.
9. Given a phase with linked ideas and blocking decisions, when it is deleted, then the ideas show no phase and no decision lists it.
10. Given an idea someone else deleted, when a person votes on it, then they see "That row is gone" with a reload hint, and nothing is written.
11. Given the store cannot be reached, when Roadmap opens, then it shows what failed and "Try again", with no half-drawn timeline.
12. Given a key such as "../x" passed to any remove call, then it is refused and nothing is deleted.
13. Given rows saved before a field existed, when listed, then they appear with that field's default.
14. Given a widget at 2x2, then nothing scrolls and no text is cut off.

## Out of scope

Roles per person, comments on ideas, a vote limit per person, resourcing charts (headcount by function, spend by phase), a critical-path chain, dependencies between phases, fiscal calendars (quarters are plain calendar quarters), printing or slide export, scheduled reminders, importing from other trackers, and a screen for earlier versions of a row (shared records already keep them).

Build it with your coding agent: read README.md ("Rules for space code") and docs/space-design.md first, copy .miso/ui/kit.tsx and use its components.

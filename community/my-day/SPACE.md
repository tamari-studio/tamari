# My day

A personal day planner: your own calendar and your own task list on one page, with meetings sorted into internal and external.

## Who uses it

Any team member who wants to see their day: what is on the calendar, what is due, and which meetings involve people outside the team.
Each person sees only their own events and tasks. Rows are private in the views, not hidden from admins or from the Data map page.

## Views

### Calendar
- Header: Today, back and forward arrows, the range title, a Day, Week and Month switch, an All, Internal and External filter, a New event button and a Contacts button.
- Day shows a time grid for 24 hours with a current-time line, an all-day strip, and, under the strip, the tasks due that day (for today, the overdue ones too). Week is seven days from Monday. Month is a six-week grid; a day with more events than fit shows "+N more" and opens that day.
- Overlapping events sit side by side. External events carry an External mark, and the side panel names the kind. Click an event for a side panel: title, time, place, video link, organiser, guests with their replies, and notes shown as plain text with links, never as HTML.
- A person can add, edit and delete their own events, and tick a due task in the Day view. Events from the team feed (see Connectors) are read-only and labelled "Team".
- Contacts panel: a list of exact addresses and domains marked Internal or External, shared by everyone, plus one field for the team's own mail domain. Anything on that domain counts as internal unless a rule says otherwise.
- Loading: a skeleton grid. Empty: "Nothing on this day" with Add event. Error: a "Calendar unavailable" message with the reason and Try again; Tasks stays usable. If only the team feed fails, own events show with a one-line notice.

### Tasks
- Groups: Overdue, Today, Upcoming, No date, and Done (collapsed). Each row has a tick box, the title, the due day and a linked event if any.
- A person can add a task with one line of text, edit title, due day, note and linked event, tick or untick, delete, and clear all done tasks.
- Loading: skeleton rows. Empty: "No tasks. Add the first one above." Error: what failed and Try again. A failed save keeps what the person typed.

## Widgets

- Next up: the next event today that has not ended: title and start time. Drop the place, then the "+N later" line, as the box shrinks; at 2x2 only title and time. Empty: "Nothing more today".
- Due today: the number of open tasks due today or overdue, large; below it as many titles as fit with "+N more". At 2x2 only the number. Empty: "All clear". Neither widget scrolls.

## Data

Rows live in shared records. Because records are shared, every row stores its owner and every server function filters by it. A field added later gets a default and rows read without it use that default; a row that fails its checks on read is left out and logged.

- `my-day-events`. Key: the caller's id, a hyphen and random text (never an address). At most 1000 per person.
  - ownerId: the caller's id, set by the server, required. title: free text, required, 1 to 120.
  - allDay: true or false, default false. start and end: the person's local wall time as a date and time, or as a day when allDay; end not before start; for all-day events end is the last day, inclusive.
  - place: free text up to 120, default empty. link: a web link with a web scheme only, up to 300, default empty. notes: free text up to 2000, default empty.
  - organizer: an address, default empty. guests: up to 30, each an address (required), name (free text up to 80, default empty) and reply (yes, no, maybe or waiting, default waiting); no repeats.
- `my-day-tasks`. Key as above. At most 1000 per person.
  - ownerId (server-set), title: free text, required, 1 to 200. done: true or false, default false. doneAt: a day, default empty, set by the server.
  - due: a real day, default empty. eventKey: the key of one of the person's own events, default empty. note: free text up to 1000, default empty. createdAt: server-set time.
- `my-day-rules`. Key: an exact address, or a domain written with a leading at sign, lower-cased. kind: internal or external, required. Shared by everyone, at most 500 rows.
- `my-day-settings`. One row with key `team`: internalDomain (a mail domain, up to 100, default empty meaning nobody is internal by default).

How an event is classified: external if its title starts with "External:" in any casing, or if the organiser or any guest other than the person is external. The person and rooms never count. An address is external by the first match of: an exact rule, a domain rule, the team domain (internal); otherwise external. An event with nobody else is internal.

## Server functions

Each starts with `requireCaller()`, uses the caller's id as the owner, and validates every argument. Messages are plain sentences.
- `listEvents(from, to)`: two real days, from before to, at most 45 days apart; returns the caller's events overlapping the span and whether a team feed is set.
- `listTeamEvents(from, to)`: same checks; reads the feed and returns checked events or a plain error; refuses when no feed is set.
- `saveEvent(input)`: title, times, lengths, link scheme, guest count and addresses as above; a new row gets a key from the caller's id; an existing key must belong to the caller.
- `removeEvent(key)`: key must belong to the caller. Tasks linked to it keep working with the link cleared.
- `listTasks()`, `saveTask(input)`, `setTaskDone(key, done)`, `removeTask(key)`, `clearDoneTasks()`: title and note lengths, a real due day, a boolean, and an eventKey that is the caller's own. A key that is not the caller's is answered with "That task was not found."
- `listRules()`, `saveRule(address, kind)`, `removeRule(key)`: the key is trimmed, lower-cased and must be an address or a domain with a leading at sign; kind must be internal or external.
- `getSettings()`, `saveSettings(input)`: the domain is a valid mail domain or empty.
- `whoAmI()`: the caller's address, used to leave the person out of the guest check.

## Connectors

- `MY_DAY_TEAM_FEED_URL` and `MY_DAY_TEAM_FEED_TOKEN`: one shared team calendar, for instance a read-only calendar subscription from a calendar provider. Settings apply to the whole space, so everyone sees these events as "Team" events; do not point it at one person's private calendar. The coding agent writes a small adapter that returns title, times, place and guests, skips declined and cancelled events, and never stores the events. Without them the views show only each person's own events and nothing is reported as missing.
- Each person connecting their own calendar provider needs per-person sign-in held by the app, never by space code, so it is not part of this space. No AI key is needed.

## Acceptance checks

1. Given no events on the day, when Calendar opens on Day, then it shows "Nothing on this day" with Add event.
2. Given two overlapping events, when Day opens, then they sit side by side.
3. Given a three-day all-day event, when I open any of its three days, then it shows in that day's all-day strip.
4. Given a guest outside the team domain, or a title that starts with "external:" in any casing, when the event is shown, then it is External and the External filter lists it.
5. Given a domain rule marks a guest's domain internal and an exact-address rule marks that guest external, when the event is shown, then the exact rule wins.
6. Given an event whose end is before its start, when I save it, then it is refused with "End must not be before start." and nothing is stored.
7. Given a task title that is empty or 201 characters, or a due day such as the thirtieth of February, when I save it, then it is refused with a sentence naming the field.
8. Given person A has tasks, when person B lists tasks, then none of A's appear; when B calls `setTaskDone` or `removeTask` with A's key, then it fails with "That task was not found." and A's row is unchanged.
9. Given an open task, when I tick it, then it moves to Done with the day it was done; when I untick it, then it returns and that day is cleared.
10. Given a task was due yesterday, when I open Tasks or today's Day view, then it is listed as overdue.
11. Given the calendar request fails, when the view opens, then the error state shows the reason and Try again, and the Tasks view still works.
12. Given saving a task fails, when I retry, then my typed text was kept with the reason shown and no duplicate row appears.
13. Given no team feed is set, when Calendar opens, then no Team events and no error show; given the feed fails, when it opens, then my own events show with a one-line notice.
14. Given the Due today widget is 2x2, when tasks are due, then it shows only the count and nothing is cut off or scrolls; given a taller box, when it renders, then titles appear with "+N more".

## Out of scope

Each person's own calendar sign-in, writing to an outside calendar or replying to invitations, repeating events, reminders and notifications, time zones other than the person's local one, sharing tasks with others, sub-tasks, and notes pulled from meeting tools.

Build it with your coding agent: read README.md ("Rules for space code") and docs/space-design.md first, copy .miso/ui/kit.tsx and use its components.

---
title: "Email decision log"
type: decision-log
description: Decisions this team made about sending mail, newest first, each with the reason and who decided.
tags:
  - team/context
created: 2026-11-25T00:00:00Z
updated: 2026-11-25T00:00:00Z
---

# Email decision log

> Newest first. Write a decision down the day it is made: what, why, who, and what we chose not
> to do. A decision changes with a new entry, never by editing an old one. Part of [[07-Maps/Email]].

## How to add one
Copy the block below to the top of the list and fill it in. Five lines are enough.

```markdown
### YYYY-MM-DD: <the decision in one sentence>
- **Why:** <the reason, and what made it urgent now>
- **Decided by:** <name>
- **Instead of:** <what we chose not to do>
- **Look again:** <a date or an event, or "no">
```

## Decisions

### 2026-11-25: A shared inbox like info@ is added to a campaign only when someone knows the company wants the mail
- **Why:** Mail to a shared inbox is read by several people or by nobody, and it is the address most
  often marked as spam. One complaint there costs more than the one contact it reaches.
- **Decided by:** <name>
- **Instead of:** Sending to every address the check does not refuse.
- **Look again:** After the next three campaigns.

### 2026-11-25: We send only to addresses marked Good to send
- **Why:** Bounces lower our sender reputation, and a lower reputation puts all our mail in spam
  folders, also the mail to people who want it.
- **Decided by:** <name>
- **Instead of:** Sending to the whole list and cleaning up from the bounces afterwards.
- **Look again:** If fewer than 9 in 10 checked addresses are good, we look at where the addresses come from.

<!-- These two entries are examples. Keep them if they are true for you, or replace them with your first real decisions. -->

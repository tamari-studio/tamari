---
title: "Note schema"
type: reference
created: 2026-10-28T00:00:00Z
updated: 2026-10-28T00:00:00Z
---

# Note schema

Copy this block to the top of every new note.

```yaml
---
title: "Exact Title of the Note"
type: concept  # concept, entity, project, summary, source-ref, plan, spec, draft, runbook, meeting, capture, reference, daily-brief, decision-log
aliases:
  - Alternative Name
description:
tags:
  - category/subcategory
  - status/draft  # stub, draft, mature
sources:
  - "[[04-Resources/original-source]]"
created: 2026-01-01T00:00:00Z
updated: 2026-01-01T00:00:00Z
confidence: medium  # low, medium, high
---
```

If no `type` fits, add the new one to the list above rather than inventing a value in one file.

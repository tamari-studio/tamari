# Vault: Knowledge OS

## What this vault is
A notes vault for one person or one team: plain Markdown in a git repo, read by people (in Obsidian or
the Tamari **Vault** space) and by AI assistants (Claude Code). It follows PARA plus Maps of Content.
Replace this paragraph with what *your* vault is for.

## Folder map (PARA)
| Folder | Purpose |
|--------|---------|
| `00-Inbox/` | Capture fast. Process weekly. Holds `frontmatter.md`, the note schema. |
| `01-Daily/` | Daily briefs and weekly check-ins |
| `02-Projects/` | Active work with a goal and a deadline. One folder per project. |
| `03-Areas/` | Ongoing responsibilities, no deadline |
| `04-Resources/` | Reference material by topic |
| `05-Knowledge/` | Consolidated frameworks and the people CRM |
| `06-Wiki/` | Entities, concepts, decisions |
| `07-Maps/` | Maps of Content: index notes that link related notes. `Home.md` is the entry point. |
| `08-Archive/` | Finished, inactive or paused work |
| `09-agents/` | Agent configs and automation. MCP servers live under `09-agents/mcp/<name>/`. |

## Key files
- `07-Maps/Home.md`: vault entry point. Keep it current: it is what an assistant reads to orient itself.
- `SOUL.md`: who the owner is, their values and constraints.
- `CRITICAL_FACTS.md`: always-loaded key facts. Keep it short.
- `AGENT_PLAN.md`: flat list of tasks that fit no single project.
- `index.md` and `log.md`: root index and change log.
- `02-Projects/<project>/ACTIVE_PLAN.md`: the plan of one project (phases and a "Human-Action Queue").

## Session skills (`.claude/skills/`)
| Skill | When |
|-------|------|
| `/session-context` | Start of every session |
| `/new-note` | Capture a new permanent note |
| `/wrap-up` | End of session |

Make more with a skill-creating skill, and list them in this table.

## Frontmatter
Every new `.md` note opens with the YAML block in `00-Inbox/frontmatter.md`, the single reference for
the schema. Always set `title`, `type`, `created`, `updated`. Omit fields that don't apply. Dates are
ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`); `updated` moves forward on every real edit.

## Hard rules
- Every note goes in the right PARA folder, not the root.
- Maps link to notes; notes link back to their Map.
- Archive rather than delete.
- Process the inbox at least once a week.
- Commit with explicit paths (`git add <paths>`), never `git add -A`.
- No secrets in the vault. Keys belong in the tool that uses them.

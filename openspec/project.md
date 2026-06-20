# Project OpenSpec Guide

This repository uses OpenSpec changes for durable follow-up work that affects reusable skills, agents, instructions, validators, tools, templates, or project documentation.

Before archiving a completed OpenSpec change, write `openspec/changes/<change-id>/retro.md` and run the retrospective follow-up gate:

```sh
npm run openspec:retro-followups -- <change-id>
npm run openspec:retro-gate -- <change-id>
```

`retro.md` must record evidence reviewed, problems found, outputs, and archive gate decision. Actionable findings need root-cause evidence and follow-up changes unless they were fixed in scope, intentionally non-actionable, or approved for skip with reason and approver.

Use `npm run openspec:retro-followups -- <change-id> --dry-run` for read-only inspection before writing follow-up changes.

When a change session produced reviewer `Prevention Feedback`, run `npm run instruction:feedback -- --pending` before archive and account for every unresolved entry in `retro.md`, an OpenSpec follow-up, or an approved no-follow-up reason.

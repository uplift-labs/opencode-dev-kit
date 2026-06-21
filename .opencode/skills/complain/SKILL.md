---
name: complain
description: Use this skill when current-session workflow friction, instruction conflict, tooling pain, missing automation, or reusable process feedback should be recorded in docs/feedbacks.
---

# Complain

Use this skill when current-session workflow friction, instruction conflict, tooling pain, missing automation, confusing handoff, validation noise, permission friction, or a reusable process improvement opportunity appears.

Do not wait for proof that the issue is recurring. If recurrence is unknown, write `Recurrence: unknown`. Prefer capturing a compact useful signal over suppressing it.

## Direct Write Contract

- If edit permission allows `docs/feedbacks/**`, append the entry yourself to `docs/feedbacks/<source>.md`.
- If the feedback directory, parent directories, or source file do not exist, create them through the edit/add-file path under `docs/feedbacks/**`; no shell command or project bootstrap is required.
- If feedback write is denied by explicit read-only/no-edit mode, missing permission, or missing write surface, return a `Feedback Candidate` block instead.
- Feedback write must stay small and must not block the main task. Capture the signal, then resume or return the assigned report.
- Do not edit source, config, instructions, specs, code, or task artifacts through this skill unless the user separately approved that work.

## Source File Naming

- Main session: `docs/feedbacks/main-agent.md`.
- Subagent: `docs/feedbacks/<agent-name>.md`.
- Skill-specific friction: `docs/feedbacks/<skill-name>.md`.
- Unknown or mixed source: `docs/feedbacks/general.md`.

Use lowercase hyphen-separated names. Keep one source file per agent or skill when possible.

## What To Capture

Capture any current-session signal about process, tooling, instruction, or autonomy friction:

- Instruction, skill, or agent contract made the work slower, noisier, unsafe, or awkward.
- Required input was missing because handoff/context contract was weak.
- Permission/tooling forced avoidable manual work.
- Validation was too noisy, too broad, too weak, or poorly diagnostic.
- A repeated-looking smell appears, even if you cannot prove history.
- A useful automation, helper, fixture, validator, or routing improvement is visible but outside current scope.
- Something irritates the agent and the better workflow is not yet known.

## What Not To Capture

- Secrets, credentials, tokens, raw private prompts, or unnecessary private paths.
- large logs, transcript dumps, or raw user data.
- personal blame toward the user or other agents. Describe workflow and artifact friction.
- Exact duplicates when an existing entry is clearly the same; add an occurrence note when cheap, otherwise create a new entry.

## Entry Template

Append entries newest last:

```md
## FB-YYYY-MM-DD-short-title

Source: <agent-or-skill-name>
Role: main-agent | reviewer | worker | skill
Type: complaint | suggestion | automation-candidate | instruction-conflict | tooling-friction | context-friction
Severity: low | medium | high
Recurrence: current-session-once | current-session-repeated | ledger-match | unknown
Status: open

### Complaint
Blunt agent voice. What felt wrong, annoying, slow, unsafe, or wasteful.

### Context
What task or step exposed this. Keep it privacy-safe.

### Evidence From Current Session
Concrete facts observed now. Commands/files/patterns if useful. No raw secrets or log dumps.

### Impact
How this hurts delivery: time, missed bugs, context bloat, repeated work, weak validation, or bad autonomy.

### Desired Future
What better workflow would feel like.

### Proposed Direction
Concrete idea if known. Otherwise: `unknown` or `needs analysis`.

### OpenSpec Follow-Up
yes | no | maybe

### Related Entries
- <optional links>
```

## Feedback Candidate Fallback

Return this only when direct ledger write is blocked:

```md
Feedback Candidate:
Target File: docs/feedbacks/<source>.md
Reason Direct Write Blocked: <mode|permission|missing-path|other>

<entry following the template>
```

## Output

After writing, return compact evidence:

- `Feedback`: written | candidate-only | skipped.
- `Target File`: path or `none`.
- `Reason`: short reason when skipped or candidate-only.

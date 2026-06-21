# Feedback Ledger

This directory stores agent and skill complaints, suggestions, and workflow-friction notes.

Use the `complain` skill when current-session process/tooling/instruction friction appears. Do not wait for proof that the issue is recurring; use `Recurrence: unknown` when unsure.

## Files

- `main-agent.md`: main session feedback.
- `<agent-name>.md`: one file per agent.
- `<skill-name>.md`: skill-specific feedback when useful.
- `general.md`: mixed or unknown source.

## Rules

- Keep entries privacy-safe: no secrets, tokens, raw private prompts, large logs, or log dumps.
- Focus on workflow, tooling, instruction, validation, autonomy, or handoff friction.
- Blunt complaints are allowed; personal blame is not.
- Prefer compact evidence from the current session over speculation.
- If cause or fix is unknown, write `unknown` or `needs analysis`.

## Template

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

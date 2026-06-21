# session-delivery-reviewer Feedback

Entries appended newest last.

## FB-2026-06-21-root-goal-narrowed-by-slice-summary

Source: session-delivery-reviewer
Role: reviewer
Type: instruction-conflict
Severity: high
Recurrence: current-session-once
Status: open

### Complaint
Session delivery review let a supplied current-slice summary narrow an original root-session user goal and did not escalate unfinished all-OpenSpec/archive/push work as P0.

### Context
A reviewed session started with a broad request to implement all OpenSpec changes, archive on completion, push after archives, and escalate blockers only under constrained conditions. Final review accepted a blocked diagnostic slice as handoff-ready even though historical todos and root prompts still showed unfinished relevant work.

### Evidence From Current Session
`session_delivery_context` for the reported session exposed the original root prompt, six detected requirement signals, and six unresolved historical todos tied to OpenSpec implementation/archive/push work.

### Impact
Final handoff could end a session before user-requested scope was complete, allowing missed implementation/archive/push work despite available session evidence.

### Desired Future
Root-session user messages and detected requirement signals dominate assistant-provided continuation summaries. Final delivery review blocks acceptance whenever the original broad goal remains incomplete.

### Proposed Direction
Require `requirementSignals[]` inventory, forbid current-slice framing from overriding root goals, and validate this contract in `validate-library`.

### OpenSpec Follow-Up
no

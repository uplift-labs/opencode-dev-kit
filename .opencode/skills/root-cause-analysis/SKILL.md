---
name: root-cause-analysis
description: Analyze evidence-backed symptoms into root causes, recurrence paths, unknown-cause investigations, and remediation-ready cause records.
license: MIT
---

# Root Cause Analysis

Use this skill when a retro, audit, reviewer gate, incident review, validation failure, or repeated workflow problem needs evidence-backed root-cause analysis before choosing fixes.

Do not use it for a single obvious typo, purely stylistic feedback, or a quick summary that does not need a recurrence-prevention decision.

## Contract

- Work from evidence refs, not memory or vibes.
- Treat symptoms, user corrections, failed commands, reviewer findings, and delays as signals until a cause is supported.
- Separate symptom, proximate trigger, missed guard, systemic root cause, contributing factors, and recurrence path.
- Use bounded `5 Whys` when it helps: normally 3-7 why steps, stop when another why would speculate beyond evidence.
- Use causal-chain or counterfactual-guard checks when `5 Whys` would collapse multiple causes into one vague statement.
- Use Ishikawa-style categories only as a checklist: instructions, tooling, validation, workflow, data/source availability, model behavior, user-owned decision, environment. Do not force every category into the output.
- A root cause is useful only if removing or reducing it would plausibly prevent recurrence while preserving evidence quality, safety, and user outcome.
- If evidence cannot support a cause, record `unknown` and route an investigation or instrumentation plan instead of guessing a remediation.
- Do not assign blame to a person, agent, tool, prompt, reviewer, or user-owned decision unless the evidence distinguishes that owner from alternatives.
- Positive trends need causes too: identify the condition, guard, or workflow that made the success repeatable so it can be preserved.
- After root-cause records are accepted, use `deep-task-planning` for remediation, preservation, or investigation plans.

## Method

1. Normalize each input problem into `symptom`, `impact`, `evidenceRefs`, and `confidence`.
2. Build the causal chain from trigger to outcome: what happened, what guard should have caught it, why the guard failed or was absent, and what recurrence path remains.
3. Ask bounded why questions only while each answer cites evidence or explicitly records an unknown.
4. Check alternative explanations. Keep competing causes when evidence supports more than one; mark uncertain branches as contributing factors or `unknown`.
5. Choose the narrowest cause that explains the recurrence path and can be reduced by a practical change.
6. Map unknowns to investigation evidence: logs, fixtures, validator gaps, transcript fields, reviewer contract changes, or instrumentation.
7. Map confirmed or likely causes to prevention levers: automation, validation, routing, reviewer gate, instruction change, artifact split, training example, or process guard.
8. When `Prevention Feedback` has `Likely Root Cause: unknown`, do not route it to instant instruction edits. Return an investigation route and, when durable tracking is needed, hand it to `openspec-propose` as an investigation follow-up.

## Output

Return:

- `Scope`: problems, trends, sessions, findings, or artifacts analyzed.
- `Evidence Reviewed`: refs used and coverage limits.
- `Cause Table`: symptom -> proximate trigger -> missed guard -> likely root cause or `unknown` -> recurrence path -> confidence.
- `Root Cause Records`: id, status `confirmed|likely|unknown`, trend/finding refs, evidence refs, cause statement, contributing factors, counterfactual guard, owner surface, confidence.
- `Investigation Routes`: unknowns, missing evidence, instrumentation or inspection needed, acceptance signal.
- `Fix Direction`: root cause -> smallest prevention lever -> validation signal -> regression risk.
- `Residual Risks`: unsupported assumptions, weak evidence, or `none`.
- `Actionable Continuation Items`: concrete follow-up tasks, or `none`.

# Porting Checklist For Skills And Agents

Use this checklist when moving project-local skills/agents into a global reusable library.

## Remove Project-Specific Anchors

- Repository names, product names, customer names, hardware names.
- Absolute source paths and sibling repository paths.
- Issue tracker/provider-specific commands unless the artifact is provider-specific.
- Local validation commands unless expressed as placeholders.
- Future-scope product decisions that do not apply globally.
- External directory permissions tied to one workspace.

## Generalize Safely

- Replace domain nouns with placeholders: `<project>`, `<service>`, `<legacy-client>`, `<upstream>`, `<wire-protocol>`, `<validation-command>`.
- Keep the workflow shape, evidence hierarchy, severity schema, and output contract.
- Keep domain-specific artifacts only when the domain itself is reusable, such as Rust concurrency, Windows service packaging, COM/ActiveX, config validation, or wire protocol tests.
- Rename artifacts when the original name would over-trigger or mislead in other projects.

## Compatibility Checks

- Skill folder name matches frontmatter `name`.
- Skill `description` is concrete and under OpenCode's discovery limit.
- Agent frontmatter uses valid `mode` and least-privilege `permission`.
- Reviewer agents are read-only leaf validators, except scoped feedback-ledger appends under `docs/feedbacks/**` through `complain`.
- Reviewer agents include a `## Feedback Ledger` section and scoped `permission.edit`/`permission.skill` rules for `docs/feedbacks/**` and `complain`.
- Reviewer agents include the canonical `## Prevention Feedback` section with `Recurrence Path`, `Prevention Target`, `Prevention Cost`, `Draft Rule`, and `Replay Evidence`.
- No copied instructions conflict with the target repository's higher-priority rules.

## Review Questions

- Would this artifact be useful in a project with a different language, provider, issue tracker, and architecture?
- Are the trigger and non-goals clear enough to avoid accidental overuse?
- Can a main session verify whether the artifact succeeded?
- Is any critical rule buried in the middle of a long prompt?
- If this artifact can drive implementation changes, does it require TDD/test-first or an explicit infeasibility note using project-neutral validation placeholders?
- Does the artifact ask routine questions instead of continuing with evidence or safe defaults?

# Codebase Audit Ledger — opencode-kit

- Audit id: opencode-kit-full-2026-06-27
- Repo: `D:\sa-gh\opencode-kit`
- Scope: full repository (docs/, global/, instructions/, openspec/, profiles/, templates/, tools/, top-level files)
- Goal: full audit to surface code smells, architecture smells, redundancy, test gaps, and failure modes
- Non-goals: rewrite skills, redesign OpenSpec change sets, or produce a turnkey refactor
- Mode: review-only
- Evidence policy: source/tests/schema/scripts > docs/comments > user claims
- Validation baseline: `node tools/validate-library.ts` -> `OK: skills=33 agents=15 markdown=85 warnings=1` (warning only on `global/opencode.json` permission:allow); `npm test` -> 9 test files, 54+8+…+… all PASS
- Resolution baseline (2026-06-27): `npm run validate:strict` -> `OK: skills=33 agents=15 markdown=115 warnings=0 infos=0`; `npm test` -> all suites PASS (library=61, install-opencode=8, plus unchanged suites); `npm run openspec:validate` -> 6/6 changes PASS.

## Block Coverage Summary

| Range | Files | Coverage | Notes |
| --- | --- | --- | --- |
| Top-level | README, AGENTS.md, package.json, opencode.json, .gitignore, .githooks/pre-push, LICENSE | reviewed | repo + global config duplication noted |
| docs/ | adapters, getting-started, quality-gates, token-economy, universal-development-loop, feedbacks/* (18) | reviewed | three redundant Universal Development Loop definitions |
| global/ | AGENTS.md, opencode.json, opencode.json.template, package.json, plugin/session-env.ts, agents/*.md (14), skills/*/SKILL.md (28) | reviewed | plugin dynamic-import across directories |
| instructions/ | universal-development-loop.md, reusable-project-agent-instructions.md, leaf-reviewer-agent-contract.md, evidence-and-validation.md, instruction-artifact-audit-runbook.md, porting-checklist.md | reviewed | project instructions duplicate loop |
| openspec/ | project.md | reviewed | no active change dir present |
| profiles/ | all.json | reviewed | only profile; `validate-library` enforces this strictly |
| templates/ | project/* + ci/github-actions.yml | reviewed | duplicated feedback README + adapter |
| tools/ | 14 TypeScript files (inventory + code-quality + session-delivery-context + 9 test files) | reviewed | 3 split-candidate files, 2 attention-band files |

## Findings

### F01 [P1] Three split-candidate code files (>800 lines each)
- Evidence: `npm run code-quality:inventory` -> `Status: split-candidate`; `tools/test-library.ts` (1708), `tools/validate-library.ts` (1468), `tools/session-delivery-context.ts` (1019).
- Impact: high review cost, hidden responsibilities, harder onboarding; `tools/test-library.ts` even makes the validator split-candidate by itself.
- Likely root cause: per-file growth was cheaper than extracting helpers; tests were inlined for fixture proximity.
- Recommendation: split each into 3-5 modules (`frontmatter.ts`, `markdown.ts`, `agents.ts`, `profiles.ts`, `opencode-config.ts`, `runner.ts`; or `fixture-builder.ts`, `test-cases/*.ts`, `assert-helpers.ts`; or `db.ts`, `requirements.ts`, `projection.ts`).
- Confidence: high.

### F02 [P1] `tools/test-library.ts` carries massive inline duplication
- Evidence: lines 80-318 hand-roll a `newLibraryFixture` function that embeds ~230 lines of YAML/text fixture content; reviewer permission YAML blocks (~17 lines each) are repeated verbatim in ~7 test cases; CI template literal (lines 191) and `package.json` literal (lines 205-227) and `AGENTS.md` literal (lines 228-263) are duplicated.
- Impact: any change to the reviewer permission shape requires editing 7+ places; fixture drift is invisible to the validator.
- Likely root cause: inline literals are easier to write than factoring helpers; there is no `fixture-builder.ts`.
- Recommendation: extract `buildLibraryFixture({ skills, agents, profiles, extra })` returning a fixture root, plus a `frontmatterReviewer(...)` helper for the reviewer permission block. Cap the file under ~400 lines.
- Confidence: high.

### F03 [P1] Custom test runner reinvented in 9 test files
- Evidence: `tools/test-library.ts`, `tools/test-library-validation-scripts.ts`, `tools/test-code-quality-inventory.ts`, `tools/test-headroom-mcp-wrapper.ts`, `tools/test-session-env-plugin.ts`, `tools/test-instruction-feedback-ledger.ts`, `tools/test-install-opencode-global.ts`, `tools/test-openspec-operation-gate.ts`, `tools/test-pre-push-validate.ts` each declare their own `TestCase` type, `tests: TestCase[]`, `assert*`, `withTemp*`, `writeText`. Total test infra ~3500 lines.
- Impact: no shared fixtures, no parallel runner, no shared skip/timing; `npm test` is one giant `&&` chain (line 13 of `package.json`).
- Likely root cause: `node:test` (stable since Node 22, available on Node >=24 required by the repo) was not adopted.
- Recommendation: switch to `node --test` with `--test-reporter=spec`, factor one `tools/test-helpers.ts` for temp-dir, text-write, and subprocess invocation; keep suite-specific files thin.
- Confidence: high.

### F04 [P2] `tools/validate-library.ts` mixes 10+ responsibilities
- Evidence: frontmatter parser (lines 197-269), JSONC stripper (lines 1136-1188, 1190-1226), permission-policy detector (lines 1232-1272), markdown validator (1299-1356), routing/binding helpers, `validateSkills`, `validateAgents`, `validateProfiles`, `validateReadme`, `validateAgentsMd`, `validateDevKitContract`, `validateInstallerConfigDirModel`, `validateImplementationWorkerRouting`, `validateSessionDeliveryBinding`, `validateOpenCodeConfigFiles` all in one file.
- Impact: changes to one domain touch the same file; error-output coupling makes triage harder; cannot reuse validators from other tools.
- Recommendation: split by domain into `validators/{frontmatter,skills,agents,profiles,markdown,opencode-config,devkit-contract,permission-policy,binding,routing}.ts`; keep `validate-library.ts` as the orchestrator.
- Confidence: high.

### F05 [P2] Hand-rolled JSONC parser in `validate-library.ts`
- Evidence: `stripJsonComments` (lines 1136-1188) and `stripJsonTrailingCommas` (lines 1190-1226) implement string-aware comment stripping and trailing-comma stripping from scratch.
- Impact: hand-rolled parsers are easy to break on Unicode escapes, multi-line strings, or nested templates; bugs here silently corrupt parsed OpenCode config.
- Recommendation: replace with `jsonc-parser` (the same one OpenCode itself depends on) or limit to plain JSONC cases used by the kit; document unsupported edge cases.
- Confidence: medium.

### F06 [P2] `tools/session-delivery-context.ts` couples DB I/O, heuristic regex, and projection
- Evidence: 1019 lines mixing `DatabaseSync` queries (event/message/question/todo scans), Russian+English regex-based `REQUIREMENT_SIGNAL_RULES` (lines 149-181), structural-secret key list (line 147), and final JSON projection. Uses Node experimental `node:sqlite`.
- Impact: heuristic-vs-evidence boundary is fuzzy; large surface area makes testing expensive; behavior depends on OpenCode's internal SQLite schema.
- Recommendation: split into `db.ts` (typed DB scans), `requirements.ts` (deterministic regex rules), `redaction.ts` (structural keys); document schema assumptions from opencode source and pin a compatibility range; surface `unknown` rather than guessing.
- Confidence: high.

### F07 [P2] `global/plugin/session-env.ts` dynamically imports from `tools/`
- Evidence: `loadSessionDeliveryContextModule` (lines 51-63) reaches out to `../../tools/session-delivery-context.ts` because plugin dir is `global/plugin/` and target is `tools/`.
- Impact: plugin is not self-contained; relocation or vendor install breaks; violates "self-discoverable plugin" intuition; complicates Windows path normalization.
- Recommendation: move `tools/session-delivery-context.ts` content into `global/plugin/session-delivery-context.ts` (or split into `global/plugin/delivery-context/`), keep tool thin wrapper if needed for CLI consumers; document the `OPENCODE_CONFIG_DIR` lookup contract.
- Confidence: high.

### F08 [P2] Hardcoded absolute user path in committed config
- Evidence: `global/opencode.json:39` -> `"command": ["C:/Users/Sergey/.local/bin/codebase-memory-mcp.exe"]`. AGENTS.md states: "do not hardcode repository names, company-internal paths… unless explicitly scoped".
- Impact: cannot be reused on another machine without editing; the file is gitignored (`.gitignore` line 3) so technically not committed, but present in the working tree for one developer; if a teammate re-installs, the file is regenerated from template which does not contain the path.
- Recommendation: split machine-local MCP provider config into `global/opencode.local.json` referenced from `.gitignore`, or document that user must overlay via `edit global/opencode.json after install:global`.
- Confidence: high.
- Resolution: addressed by `kit-config-hygiene`. Machine-local paths now use the `global/opencode.local.json` overlay pattern (`global/opencode.local.json.example` documents the contract; root `.gitignore` excludes the live overlay). The installer provisions `global/opencode.json` from the portable template, which contains no hardcoded paths. Resolved 2026-06-27.

### F09 [P2] `permission: allow` in installed config triggers validator warning
- Evidence: `npm run validate` -> `WARN: OpenCode permission config uses top-level allow; this allows all tools by default: global/opencode.json`; `npm run validate:strict` exits 1 with `Warnings are not allowed in strict validation mode`.
- Impact: strict pre-push validation fails on a warning the developer cannot easily remove because the override is the desired local UX; `permission: ask` from template vs `permission: allow` from local override diverges silently.
- Recommendation: distinguish "portable safe defaults" warnings from "local override" warnings via a marker field, or document that `validate:strict` is intended for CI only where template config is in place.
- Confidence: medium.
- Resolution: addressed by `kit-config-hygiene`. `tools/install-opencode-global.ts` writes `machineOverride: true` into the provisioned `global/opencode.json`; `tools/validate-library.ts` downgrades top-level, wildcard, and tool-wide `permission: allow` warnings to `INFO:` when the marker is present and prints an `infos=…` summary. Strict mode still fails without the marker. Resolved 2026-06-27.

### F10 [P1] Universal Development Loop defined in 4 places, slightly differently
- Evidence:
  - `docs/universal-development-loop.md` (31 lines, 11 numbered steps, no Output Shape)
  - `instructions/universal-development-loop.md` (45 lines, same 11 steps + Token/Time Rules + Quality Defaults + Output Shape sections)
  - `instructions/reusable-project-agent-instructions.md` (87 lines, mentions loop inline in one section)
  - `templates/project/AGENTS.md` (57 lines, repeats loop inline with embedded session-delivery-reviewer binding sentence)
  - `global/skills/adaptive-delivery/SKILL.md` references it 5 times
- Impact: edits to the loop require touching 4 files; risk of drift; same canonical contract re-explained with slightly different wording creates ambiguity for downstream agents.
- Recommendation: keep one canonical source (`instructions/universal-development-loop.md`) and replace other locations with a one-line "see `instructions/universal-development-loop.md`" reference; require the validator to flag a step list appearing in any other instruction artifact.
- Confidence: high.

### F11 [P1] Identical reviewer contract blocks repeated across 14 agents
- Evidence: `instruction:inventory` `Repeated Lines` table shows `Prevention Feedback`, `Recurrence Path`, `Draft Rule`, `Replay Evidence`, `Actionable Continuation Items`, `Findings`, `Verdict` blocks all appear 10-14 times across reviewer agents.
- Impact: editing the contract requires editing 14 files; risk of subtle drift that validator cannot catch.
- Recommendation: keep one canonical `instructions/leaf-reviewer-agent-contract.md` (already exists); update reviewer agents to include "see `instructions/leaf-reviewer-agent-contract.md`" and require the validator to check the reference; consider extracting the shared YAML to a `templates/agent-reviewer-frontmatter.yml` snippet.
- Confidence: high.

### F12 [P2] Two AGENTS.md files with overlapping name and intent
- Evidence: `AGENTS.md` (77 lines, repo-library rules) and `global/AGENTS.md` (121 lines, runtime global rules). Different audiences but same filename and similar headers; `tools/validate-library.ts` requires specific sections in each independently (lines 753-794 for repo AGENTS.md; 1393-1418 for session-delivery binding in both).
- Impact: contributor confusion; "which AGENTS.md?" question is high-frequency; risk of editing wrong file.
- Recommendation: keep both (they serve different audiences), but rename the repo-level one to `REPO_AGENTS.md` or move its rules into `docs/curation.md` so the filename `AGENTS.md` only means "the runtime instruction file".
- Confidence: medium.

### F13 [P2] `global/.gitignore` ignores `package.json` and `package-lock.json` but `global/package.json` exists
- Evidence: `global/.gitignore` -> `node_modules / package.json / package-lock.json / bun.lock / .gitignore`. Inventory shows `global/package.json` (5 lines, declares `@opencode-ai/plugin`) and `global/package-lock.json` (14629 lines).
- Impact: contributors cannot bootstrap `global/` cleanly from a fresh clone; only the working tree of one developer drives plugin dependency installation. Either the files should be tracked (currently they appear untracked) or the .gitignore is wrong.
- Recommendation: either remove `package.json` and `package-lock.json` from `global/.gitignore`, or move dependency declaration into the root `package.json` and delete `global/package.json`.
- Confidence: high.
- Resolution: rechecked on 2026-06-27 — `global/.gitignore` no longer exists in the working tree, and `git ls-files global/package.json global/package-lock.json` both return zero entries. The dependency declaration moved out of `global/` (the plugin now ships only as `global/plugin/session-env.ts`; no `global/package.json` is needed). The contradiction is moot; no follow-up required.

### F14 [P2] `global/node_modules` checked in
- Evidence: inventory shows `global/node_modules/` populated with `@ai-sdk`, `@opencode-ai/plugin`, `effect`, `zod`, etc. Code-quality inventory lists `global/node_modules` in `Skipped Directories` rather than ignored. The repo's `.gitignore` line 1 ignores `node_modules/` at root but `global/.gitignore` line 1 also says `node_modules`. Despite both gitignores, the directories exist and contain content.
- Impact: large repo size, dependency drift between working copies, security review burden, `npm install` ambiguity.
- Recommendation: confirm `global/node_modules` is excluded from git index (`git ls-files global/node_modules | wc -l` should be 0); if it is tracked, run `git rm -r --cached global/node_modules`; if it is untracked but blocking CI, document a single bootstrap command.
- Confidence: medium (need `git ls-files` to confirm tracked status).
- Resolution: rechecked on 2026-06-27 — `git ls-files global/node_modules | wc -l` returns 0; the directory is not tracked. With F13's dependency declaration removed from `global/`, the directory is not produced by the kit's bootstrap either. Resolved without further action.

### F15 [P2] OpenSpec workflow advertised but not actively used in repo
- Evidence: `openspec/project.md` (5 lines), no `openspec/changes/`, no `openspec/specs/`. Validator `validateProfiles` and `validateOpenCodeConfigFiles` work fine without it, but `tools/openspec-operation-gate.ts` defines 8 operations (`propose`, `apply`, `task-update`, `review`, `acceptance`, `archive`, `post-archive`, `prepush`) used only against hypothetical changes; `pre-push-validate.ts` adds OpenSpec prepush gate only when `openspec/` exists (lines 56-62 of `pre-push-validate.ts`).
- Impact: developers must learn an OpenSpec workflow that the kit itself does not use; risk of the gate behavior diverging from real practice.
- Recommendation: either add a sample `openspec/changes/<example>/proposal.md` + `tasks.md` to demonstrate the gate against real artifacts, or document in `openspec/project.md` that the kit is OpenSpec-ready but does not ship sample changes.
- Confidence: medium.

### F16 [P2] No CI workflow committed
- Evidence: `templates/ci/github-actions.yml` exists but the repo root has no `.github/workflows/`. `npm run prepush:validate` is the only gate, triggered only after manual `git config core.hooksPath .githooks`.
- Impact: CI does not run library tests or validators by default; the kit cannot enforce its own contracts.
- Recommendation: add a `.github/workflows/validate.yml` that runs `npm ci && npm run validate:strict && npm test`; reference the existing `templates/ci/github-actions.yml`.
- Confidence: high.

### F17 [P2] Long sequential `npm test` chain
- Evidence: `package.json:13` -> `node tools/test-library.ts && node tools/test-library-validation-scripts.ts && ... && node tools/test-pre-push-validate.ts`. 9 stages chained with `&&`.
- Impact: one failure aborts the rest; no parallelism; aggregate test count not reported unless each test prints its own PASS line.
- Recommendation: switch to `node --test tools/test-*.ts` (built-in since Node 22) for parallel-by-file execution and unified reporting.
- Confidence: high.

### F18 [P3] Windows `setx` truncation not guarded
- Evidence: `tools/install-opencode-global.ts:184` -> `setx OPENCODE_CONFIG_DIR <path>`. Windows `setx` truncates user env vars at 1024 chars; deeply-nested paths (e.g. `D:\Users\<long-name>\Repos\opencode-dev-kit\global`) can approach that limit.
- Impact: silent install failure with no error path; OpenCode will start with empty/old config and the user may not understand why.
- Recommendation: measure the resulting path; if >900 chars, warn and suggest `--print` for manual setup or fallback to `.cmd` shim.
- Confidence: medium.

### F19 [P3] POSIX installer is asymmetric vs Windows
- Evidence: `tools/install-opencode-global.ts:194-197` -> only prints an `export` line for POSIX; the Windows path runs `setx`. There is no shared abstraction and no regression test for POSIX behavior.
- Impact: contributors on macOS/Linux must manually edit shell profile; no automation confirms persistence; `--unset` similarly only prints removal instructions.
- Recommendation: extract `persistEnvVar(platform)` returning `{ status, mode: 'setx'|'export-line' }`; add a `--persist-script <file>` mode that appends idempotently; document the asymmetry in README.
- Confidence: low.

### F20 [P3] `init-project.ts` backup stamp collides within 1 second
- Evidence: `tools/init-project.ts:89` -> `.replace(/[-:.TZ]/g, "").slice(0, 14)` -> `YYYYMMDDHHMMSS`. Two overwrites within 1 second would collide.
- Impact: second overwrite overwrites the first backup.
- Recommendation: append a short random suffix (e.g. UUID first 8 hex) or detect existing backup and increment.
- Confidence: medium.

### F21 [P3] Validator's `git ls-files` fallback lacks tracked-vs-untracked distinction
- Evidence: `tools/validate-library.ts:317-333` -> `getMarkdownFiles` prefers `git ls-files --cached --others --exclude-standard`; if not in a git repo, falls back to filesystem walk.
- Impact: a non-git checkout gets a different markdown set than a git checkout; the validator's forbidden-anchor scan misses untracked files when git is present but does not cover ignored files.
- Recommendation: document the assumption; provide a `--no-git` flag for explicit filesystem walk; require the validator test fixture to assert both modes.
- Confidence: low.

### F22 [P3] `headroom-mcp-wrapper.ts` spawns `headroom` without availability check
- Evidence: `tools/headroom-mcp-wrapper.ts:178-184` -> `spawn("headroom", ["mcp", "serve"])`. No `which`-style check; child `error` event sets `process.exitCode = 1` but the wrapper does not emit a clear diagnostic.
- Impact: the wrapper fails silently for users without `headroom` on PATH, even though `opencode.json` enables the MCP.
- Recommendation: pre-check binary availability; surface a deterministic error to stderr; treat it as `unknown` per the kit's helper policy rather than crash.
- Confidence: medium.

### F23 [P3] `validate-library.ts` text-contract arrays embedded inline
- Evidence: `agentTextContracts` (lines 49-97) and `preventionFeedbackRequiredText` (lines 41-48) plus 30+ inline `for (const required of [...])` blocks (e.g. lines 650-666, 713, 912-914, 927, 956-958).
- Impact: each reviewer contract becomes its own inline string list scattered across the file; consolidation or reuse is hard; tests must reproduce the strings verbatim.
- Recommendation: move all required-text lists to `tools/contracts/*.ts` named by domain; the validator references them.
- Confidence: medium.

### F24 [P3] Feedback README duplicated at kit and template level
- Evidence: `docs/feedbacks/README.md` (57 lines, full template) vs `templates/project/docs/feedbacks/README.md` (20 lines, abbreviated version with same content).
- Impact: drift between kit and template feedback contract; kit uses one template, projects get a different one.
- Recommendation: have the template README either pull from the kit README at build time (`init-project` copies from `docs/feedbacks/README.md`) or generate a deterministic abbreviation; either way one source of truth.
- Confidence: medium.

### F25 [P3] Permission YAML duplicated across 14 reviewer agents
- Evidence: each reviewer agent has ~16 lines of identical YAML frontmatter (read/glob/grep allow, edit/docs/feedbacks/** allow, rest deny). 14 reviewers x ~16 lines = ~220 lines of duplicated configuration.
- Impact: editing the permission shape (e.g. adding `lsp: deny`) requires editing 14 files; validator already enforces consistency but the duplication is the smell.
- Recommendation: keep one `templates/agent-reviewer-frontmatter.yml` and have an `init:agent` tool that emits the block, or document that the validator generates the missing frontmatter when only key facts are provided.
- Confidence: low.

## Redundancy Matrix

| Id | Locations | Type | Action | Validation |
| --- | --- | --- | --- | --- |
| D01 | `docs/universal-development-loop.md` vs `instructions/universal-development-loop.md` vs `templates/project/AGENTS.md` vs `instructions/reusable-project-agent-instructions.md` | overlapping responsibility | keep canonical in `instructions/`, replace others with reference | validate-library should detect duplicate step lists |
| D02 | 14 reviewer agent bodies | duplicated Leaf Contract / Feedback Ledger / Prevention Feedback blocks | reference `instructions/leaf-reviewer-agent-contract.md` | validator already checks tokens; tighten to reference form |
| D03 | `docs/feedbacks/README.md` vs `templates/project/docs/feedbacks/README.md` | near duplicate | one source; template copies at bootstrap | init-project already reads from template; align with kit |
| D04 | `global/opencode.json` vs `global/opencode.json.template` vs root `opencode.json` | three config files | document the layering clearly; root = repo workspace; global/opencode.json.template = portable default; global/opencode.json = machine override (gitignored) | validator should allow `permission: allow` only with explicit override marker | Resolved 2026-06-27: layering documented in `README.md` -> "Configuration Layering" and `openspec/project.md`; installer writes `machineOverride: true` into the provisioned local config; validator downgrades `permission: allow` under the marker to `INFO:`; strict mode still fails without the marker. `tools/doctor.ts` reports the active layer. |
| D05 | 9 `tools/test-*.ts` files each re-implement TestCase / assert / withTempDir | redundant wrapper code | replace with `node --test`; keep suite-specific helpers thin | count: 9 files, ~3500 lines |
| D06 | Hand-rolled JSONC parser vs `jsonc-parser` package | reinvented dependency | adopt `jsonc-parser` | covered by unit test |
| D07 | Frontmatter parser in `validate-library.ts` vs js-yaml/zod alternatives | reinvented dependency | consider adopting `js-yaml` or `zod` for `name`, `description` only | covered by validator tests |
| D08 | Inline required-text arrays in `validate-library.ts` (15+ blocks) | overlapping contract lists | move to `tools/contracts/*.ts` | already covered by tests |

## Test Gap Matrix

| Id | Behavior | Existing Evidence | Missing Gate | Priority |
| --- | --- | --- | --- | --- |
| T01 | POSIX `install-opencode-global.ts` path is asymmetric with Windows | unit tests cover Windows `setx` and reg | no coverage for `--print` on POSIX path | medium |
| T02 | `validate-library.ts` exact `<= 1024 char` setx path warning | none | no fixture with deeply-nested path | low |
| T03 | `permission: allow` warning only on installed `global/opencode.json` | validator emits warning | no test asserts the warning text format | medium |
| T04 | CI matrix (Node >=24) across platforms | none committed | no `.github/workflows/validate.yml` | high |
| T05 | Cross-platform POSIX path normalization in fixtures | tests run on Windows | no CI matrix verification on Linux/macOS | medium |
| T06 | Concurrent `npm test` invocations on shared `.opencode/state/instruction-feedback-ledger.json` | tests use tempdirs | no integration test for two parallel writers | low |
| T07 | `headroom-mcp-wrapper.ts` behavior when `headroom` binary is missing | smoke test | no test for `error` event path | medium |
| T08 | `init-project.ts` backup collision within 1 second | overwrite tested | no test for two overwrites in same second | low |
| T09 | Negative test for `validateMarkdownFile` TDD-language warning | warning path covered | no test for `negatedScopeLanguage` exemption on positive line | low |

## Failure Mode Matrix

| Id | Scenario | Trigger | Expected Behavior | Evidence / Missing |
| --- | --- | --- | --- | --- |
| W01 | `setx` truncation on long Windows path | install on `D:\Users\long-name\...` | either succeed or surface truncation | no guard; silent failure |
| W02 | `headroom` binary missing on PATH | MCP startup | deterministic error message | wrapper logs to stderr only |
| W03 | `opencode.json` `permission: allow` overrides template default | developer overrides local file | validator warns but does not block unless strict mode | confirmed (warn, blocks strict) |
| W04 | `node:sqlite` schema change in newer Node | Node version bump | plugin surfaces `unknown` per helper policy | no documented compatibility range |
| W05 | Two `init:project` overwrites within 1 second | rapid bootstrap | unique backup per overwrite | stamp collides |
| W06 | Non-git checkout runs validator | CI without git | falls back to filesystem walk | documented but unmarked |
| W07 | `qwen-local-worker` runtime endpoint missing | local server not started | agent returns `blocked` with missing precondition | only documented; no test for offline path |
| W08 | `permission: allow` in installed config fails strict pre-push | CI runs `validate:strict` | CI fails | confirmed (exit 1) |
| W09 | `session-delivery-context.ts` SQLite DB missing or locked | OpenCode not running | tool returns missing-sessions list | covered by plugin wrapper; not unit-tested |

## Validation

| Check | Command | Result |
| --- | --- | --- |
| Validator (default) | `node tools/validate-library.ts` | OK: skills=33 agents=15 markdown=85 warnings=1 |
| Validator (strict) | `node tools/validate-library.ts --fail-on-warnings` | FAIL (1 warning on `global/opencode.json`) |
| Test pipeline | `npm test` | OK: 9 stages, all PASS |
| Code-quality inventory | `npm run code-quality:inventory` | 3 split-candidate files, 2 attention files |
| Instruction inventory | `npm run instruction:inventory` | 60 artifacts, 33 skills, 15 agents, repeated lines dominated by reviewer contract blocks |
| Project inventory | `npm run project:inventory -- --root .` | confirms `global/package.json`, `global/package-lock.json`, three `opencode.json` variants |

## Residual Risks

- `global/node_modules` and `global/package.json` may be tracked or not — needs `git ls-files global/node_modules | wc -l` to confirm before recommending removal.
- The kit has no CI, so any code-quality regression lands without enforcement until `pre-push` runs locally.
- The session-delivery reviewer binding contract is enforced in `validate-library.ts` by string-presence checks; subtle drift in the AGENTS.md wording may pass validation but break reviewer behavior.
- `permission: allow` warning has no override marker; strict mode is unusable for any developer who needs local allow.

## OpenSpec Follow-Up Backlog

Recommended as one OpenSpec change group once the user confirms the scope:

- **CHG: split-candidate refactor for tools/** — F01-F05
- **CHG: deduplicate instruction artifacts** — F10, F11, F12, F24, F25 (D01, D02, D03, D08)
- **CHG: plugin self-containment** — F07
- **CHG: kit-local config hygiene** — F08, F09, F13, F14 (D04)
- **CHG: add CI workflow + node:test migration** — F16, F17, D05
- **CHG: install/init hardening** — F18, F19, F20, F22

Or keep as separate changes per outcome. None should become a single change unless the user wants to amortize review cost.

## Actionable Continuation Items

- Confirm `git ls-files global/node_modules | wc -l` and `git ls-files global/package.json global/package-lock.json | wc -l` to triage F14 / F13.
- Decide whether to keep `permission: allow` as a permanent override marker (introduce `machineOverride: true` field) or document that `validate:strict` is CI-only.
- Choose whether to switch the kit's own `npm test` to `node --test` (Node >=24 available) — this is the highest-leverage refactor and unblocks parallelism.
- Decide whether the kit should ship a sample OpenSpec change so the gate has something to operate on.
- Pick a canonical Universal Development Loop file and convert the others to one-line references; this removes the largest drift risk.
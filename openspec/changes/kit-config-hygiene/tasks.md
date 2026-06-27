## 1. Pre-flight investigation

- [x] 1.1 Run `git ls-files global/package.json | wc -l`; record whether tracked. (Result: 0 — not tracked.)
- [x] 1.2 Run `git ls-files global/package-lock.json | wc -l`; record whether tracked. (Result: 0 — not tracked.)
- [x] 1.3 Run `git ls-files global/node_modules | wc -l`; record total tracked entries. (Result: 0 — not tracked.)
- [x] 1.4 If `global/node_modules` has tracked entries, document `git rm -r --cached global/node_modules` as a follow-up task before completion. (No follow-up needed: directory is not tracked and is not produced by the kit's bootstrap.)

## 2. machineOverride marker

- [x] 2.1 Update `tools/install-opencode-global.ts` so the provisioned `global/opencode.json` includes `"machineOverride": true`.
- [x] 2.2 Update `tools/validators/opencode-config.ts` so `validateOpenCodePermissionRules` reads the `machineOverride` field from the parsed config and downgrades `permission: allow` and `permission.<key>: allow` warnings to `INFO:` when the marker is set. (Lives in `tools/validate-library.ts` until `refactor-tools-split-candidate` lands its `tools/validators/opencode-config.ts` split.)
- [x] 2.3 Add `addInfo` to the validator alongside `addWarning` and `addError`.
- [x] 2.4 Update the validator summary line (`OK: skills=… agents=… markdown=… warnings=…`) to also report `infos=…`.
- [x] 2.5 Confirm `validate:strict` (which fails on warnings) still fails when the marker is missing. (Regression tests: "validator strict mode fails for top-level permission allow without machineOverride" and "validator strict mode fails for wildcard permission allow without machineOverride".)

## 3. Path overlay pattern

- [x] 3.1 Edit the working-tree `global/opencode.json` to remove the hardcoded `C:/Users/Sergey/.local/bin/codebase-memory-mcp.exe` provider block. (No working-tree `global/opencode.json` exists in this repo; the installer no longer seeds machine-specific paths because the template never contained them. The marker + overlay pattern below is the new contract.)
- [x] 3.2 Create `global/opencode.local.json.example` with a documented overlay snippet that adds the local provider.
- [x] 3.3 Update `.gitignore` (root) to add `global/opencode.local.json`.
- [x] 3.4 Update `README.md` "Configuration layering" subsection to document the overlay pattern.

## 4. .gitignore consistency

- [x] 4.1 If the pre-flight check showed `global/package.json` and `global/package-lock.json` as tracked: remove their entries from `global/.gitignore`. (N/A: `global/.gitignore` does not exist in the working tree.)
- [x] 4.2 If they were not tracked: add a follow-up task that decides between deletion and hoisting. (No follow-up needed: `global/package.json` is no longer needed; `@opencode-ai/plugin` is satisfied through `global/plugin/session-env.ts` discovery only.)
- [x] 4.3 Confirm `global/.gitignore` no longer contains contradictory entries. (Confirmed: file is absent.)

## 5. Documentation

- [x] 5.1 Add a "Configuration layering" subsection to `README.md` covering the three layers, the `machineOverride` marker, and the `opencode.local.json` overlay.
- [x] 5.2 Update `openspec/project.md` to reference the layering section.
- [x] 5.3 Update `tools/doctor.ts` so its output mentions which `opencode.json` layer is active (root vs global) when both exist.

## 6. Validation and archive readiness

- [x] 6.1 Run `npm run validate:strict`; confirm zero errors and zero warnings against the updated config. (`OK: skills=33 agents=15 markdown=115 warnings=0 infos=0`.)
- [x] 6.2 Run `npm test`; confirm all suites pass. (library=61, library-validation=3, code-quality=4, headroom=7, session-env=13, instruction-feedback=12, install-opencode=8, openspec-gate=8, pre-push=8.)
- [x] 6.3 Add a regression test in `tools/test-library.ts` (or its `node --test` successor) that constructs a fixture repo with `machineOverride: true` and confirms `validate:strict` passes. ("validator strict mode passes for machineOverride + permission allow", "validator downgrades top-level permission allow under machineOverride", "validator downgrades wildcard permission allow under machineOverride", "validator reports info count in summary".)
- [x] 6.4 Add a regression test that constructs a fixture repo without `machineOverride: true` and confirms `validate:strict` fails on `permission: allow`. ("validator strict mode fails for top-level permission allow without machineOverride", "validator strict mode fails for wildcard permission allow without machineOverride".)
- [x] 6.5 Update `docs/feedbacks/audit-opencode-kit-2026-06-27.md` to mark F08, F09, F13, F14, D04 as resolved.
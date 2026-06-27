# Universal Development Loop

The kit uses one process for every project. Technology adapters change commands; they do not create new workflows.

The canonical definition of the Universal Development Loop — step list, Token/Time Rules, Quality Defaults, and Output Shape — lives at `instructions/universal-development-loop.md`. All other artifacts in this repository and in downstream projects should reference that file instead of restating the loop.

If this kit doc and the canonical file drift, `tools/validate-library.ts` will fail the build until the divergence is reconciled. Update the canonical file and let this pointer point back to it.

## What Changes Here

- New kit-policy notes about the loop (e.g. proportionality, non-goals) belong in this file or in `docs/`.
- Step text, token/time rules, quality defaults, and output shape belong only in `instructions/universal-development-loop.md`.
- Project-level templates, reviewer agents, and downstream `AGENTS.md` files should point at the canonical file rather than duplicating the step list.

See `instructions/universal-development-loop.md` for the contract.
# Upstream

- Source: https://github.com/m0hill/anti-slop, branch `feat/gleam-profile`, commit `68d9a97`.
- Copied: every non-test file under the source's `src/` (generic, Effect, and Gleam plugins plus `configs/`). Upstream RuleTester tests were not copied.
- Previous copy: upstream commit `b5d2288` (byte-identical, no local edits), replaced on 2026-10-14.
- Local deviations: none.
- Configuration: `.oxlintrc.json` extends `configs/recommended.json` and `configs/gleam.json`.

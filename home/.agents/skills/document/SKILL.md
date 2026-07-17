---
name: document
description: Write evidence-based PR descriptions, changelog entries, release notes, and incident postmortems. Use when the user asks to document a change, prepare PR prose, update a changelog, announce a release, or record an incident.
disable-model-invocation: true
---

# Document

Write for the reader from repository evidence. Never infer a feature, result, test outcome, timeline event, or cause that the evidence does not establish.

## 1. Choose the document

Infer the type from the request. If it is unclear, ask once: PR description, changelog entry, release notes, or postmortem?

Read only the matching file in `templates/` before drafting:

- PR description: `templates/pr.md`
- Changelog entry: `templates/changelog.md`
- Release notes: `templates/release-notes.md`
- Postmortem: `templates/postmortem.md`

## 2. Gather evidence

Read `AGENTS.md` and any nearer project instructions.

For a PR description or changelog:

1. Resolve the comparison base from the user's requested range, the PR base when available, or the repository's default branch.
2. Inspect the commits, changed paths, full diff, and relevant changed files.
3. Read linked issues or specs only when available and relevant.
4. Find the project's real verification commands and determine which were actually run. Never present proposed commands as completed checks.

For release notes:

1. Resolve the requested version and exact commit or tag range.
2. If either is ambiguous, ask rather than guessing.
3. Inspect the commits and diff across that range.

For a postmortem:

1. Collect what broke, user impact, detection, start and resolution times with timezone, mitigation, root cause, and current status.
2. Read relevant incident records, diagnostics, and fixes.
3. Ask for missing material facts. Record unresolved facts as unknown.

The evidence is complete when every substantive statement in the draft can be traced to the diff, project records, or incident facts supplied by the user.

## 3. Draft for the audience

Apply the selected template. Match established repository terminology and document style.

- Reviewers need intent, behavioral changes, verification, risk, and focused review guidance.
- Changelog readers need notable externally observable changes, not implementation trivia.
- Release users need benefits, fixes, breaking changes, and required upgrade actions.
- Postmortem readers need a blameless causal account and concrete follow-up actions.

If commits disagree with code, trust the code. Do not claim performance, security, compatibility, or reliability improvements without evidence. Never reproduce secrets or private URLs found in a diff; describe them generically and warn the user that sensitive material appears in the change.

## 4. Deliver safely

- PR description: show the complete title and body in chat. Offer to create or update the PR with `gh`; do not mutate the remote without confirmation.
- Changelog: preserve the existing format and edit only the relevant section. Do not duplicate an equivalent entry.
- Release notes: write to the repository's established release-note location. If none exists, propose `docs/releases/<version>.md` before creating it.
- Postmortem: write to the repository's established incident-doc location. If none exists, propose `docs/postmortems/<date>-<slug>.md` before creating it.

Do not commit, push, publish, merge, tag, or release. Finish by naming the evidence range, output location, and any facts still unknown.

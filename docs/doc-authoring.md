# Documentation authoring

Use these principles when writing, editing, or organizing repository documentation.
Start with the [load map](README.md#start-here) and follow the routes for the subject
being documented. Contribution procedures and verification commands live in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Scope and evidence

- Keep `docs/` focused on durable implementation knowledge: architecture,
  ownership, contracts, observable behavior, constraints, and maintenance procedures.
- Describe behavior supported by the current code and tests. Read the relevant
  implementation before asserting a rule; distinguish tested behavior from an
  assumption or an unverified claim.
- Keep plans, phase progress, future features, and lists of missing features out
  of `docs/`. Do not reference plans as evidence or link readers to them.
- Document an implementation limitation when it affects correct use, such as
  snapshot replacement or append-only event logs. Explain the consequence for
  callers without turning it into a future-work list.

## Choose what to explain

Organize around questions a maintainer needs answered: where a responsibility
belongs, how data moves, which rule wins, what happens on failure, and where to
verify the behavior. Prefer a short explanation, decision table, or ownership map
over a walkthrough of individual functions.

Keep each rule in one authoritative location and link to it elsewhere. Keep exact
types and signatures in code, detailed edge cases in tests, setup and commands in
the contribution guide, and upstream formats in the upstream contract. Explain
how this extension consumes a contract rather than copying the complete schema.

Add a document only when it covers a distinct subject that is easier to find and
maintain separately. Extend an existing section for small additions. Avoid a file
per module, exhaustive API catalogs, and examples that merely repeat the code.

## Links and navigation

- Add or adjust a route in [README.md](README.md#start-here) when introducing,
  moving, or changing the scope of a document. Route by the reader's task.
- Use relative links for files within this repository. Prefer file or heading
  links over line numbers that drift as code changes.
- Link Migent contracts to `https://github.com/nodeint/migent`, not a sibling
  checkout. Use `blob/HEAD/` for the default branch, or a commit/tag when an exact
  revision matters. State revision constraints when compatibility depends on them.
- Use descriptive link labels. Link behavior sections to the relevant
  implementation and tests so readers can inspect details without searching.

## Editing and maintenance

Update the affected documentation when a change alters ownership, data flow,
compatibility, state precedence, error handling, load timing, or cache lifecycle.
Internal refactors usually require only link updates unless the documented
behavior changes.

Revise the existing explanation to describe the resulting implementation. Remove
obsolete statements rather than appending a correction or preserving conversational
history. Keep useful constraints explicit and avoid claims broader than the
implementation supports. Preserve unrelated content and changes.

Use concise English to match the repository documents. Use headings for lookup,
tables for comparisons and decision rules, and examples only when they resolve an
ambiguity. A document should help a reader locate the implementation, understand
the rules to preserve, and find the relevant verification without reading all of
core.

## Verification

Before editing, identify the affected documents, the claims to check, and the
appropriate baseline checks. Follow the repository's verification requirements;
report failures before proceeding.

For documentation-only edits:

1. Compare behavioral claims with the relevant code and tests.
2. Check relative file links and changed heading anchors. Verify changed external
   links when accessible; report any that could not be checked.
3. Check the load map and remove stale or duplicate guidance.
4. Run `git diff --check` and review the final content, including newly added files.

Do not add tests that only mirror prose. Runtime tests, build, or packaging are
needed when the change also affects executable behavior, tooling, or packaged
assets; use the applicable checks from the contribution guide. Report commands,
results, and verification limits without claiming checks that were not run.

# Contributing to Migent for VS Code

Repository: `nodeint/migent-vscode`.

## Setup

Node.js 24 and pnpm 12.6.0 (match CI); VS Code ≥1.93.0 (`package.json`). Run from repo root:

```bash
pnpm install --frozen-lockfile
pnpm setup:git # once per checkout, before branching/committing; rerun after hook changes
pnpm build     # bundles src/extension.ts into dist/extension.js; vscode stays external
pnpm package   # packages the existing build into a VSIX; build first
```

## Layout

| Path | Owns |
| --- | --- |
| `src/extension.ts` | Activation and command registration |
| `src/vscode/` | VS Code layer: registry, watchers, context keys, CLI capability |
| `src/core/` | Session and workflow data handling; colocated Vitest tests |
| `src/cli/` | CLI location and version checks; colocated Vitest tests |
| `src/text/` | Text catalog |
| `src/core/fixtures/` | Sample session and workflow data for tests |
| `package.json` | Extension identity, version, contributions, scripts |
| `.vscodeignore` | Allowlist of files included in the VSIX |

- Keep data handling testable without a VS Code host.
- Never hand-edit `dist/`; never commit VSIX files, dependencies, or credentials.
- `@nodeint/migent-contracts` (dev) is pinned to `MINIMUM_CLI_VERSION` in `src/cli/version.ts`;
  bump both and the fixture CLI's reported version together, and fix surfaced type errors.

## Test

```bash
pnpm typecheck
pnpm build
pnpm test             # unit; no VS Code host
pnpm test:integration # VS Code host; build first
pnpm package
```

- Select cases with the [testing guide](docs/testing.md).
- Run relevant checks after implementation; do not weaken verification to make a change pass.
- Required CI (`.github/workflows/ci.yml`): the sequence above on macOS and Windows, with
  integration tests on VS Code 1.93.0 and 1.145.0 (`--versions <v>`); all must pass.
- Manual VSIX check: build and package, run **Extensions: Install from VSIX...** with
  `migent-vscode-<version>.vsix`, reload, open a workspace containing
  `.migent/config.yaml`, verify the changed behavior, and inspect extension-host logs.

## Lint

```bash
pnpm lint:fix      # automatic fixes, then zero warnings
pnpm lint          # zero warnings
pnpm lint:md       # Markdown style; lint:md:fix to fix
pnpm lint:md:links # Markdown links
```

See `scripts/wrappers/run-eslint.mjs`. ESLint enforces:

- `src/core/`, `src/cli/`, and `src/text/` never import `vscode`.
- `src/text/` imports only types from the rest of `src/`.
- `src/vscode/` passes catalog ids (`text('<area>.<name>')`), not string literals, to
  status bar messages, picker and input titles, tree labels, and panel and channel names.

## Work types

Choose one primary type per issue/branch. New types need this table and references
in the `checkout-issue` and `design` skills updated.

| Type | Meaning | Branch |
| --- | --- | --- |
| feature | New observable command, view, setting, or capability | `feat/<slug>` |
| bugfix | Restore behavior promised by docs, contracts, or tests | `fix/<slug>` |
| refactor | Restructure code; preserve behavior and contracts | `refactor/<slug>` |
| migration | Staged compatibility, data transformation, or cutover | `feat/<slug>` |
| docs | Documentation only | `docs/<slug>` |
| chore | Tooling, dependencies, or CI; no product behavior change | `chore/<slug>` |

## Issues

Use the `.github/ISSUE_TEMPLATE/` form matching the work type: `<type>.yml`; labels follow Work types.
Blank issues are disabled; write issues in English.

## Branch and pull request rules

- `next` is the integration/default branch; `main` holds the latest release,
  advanced by `release.yml`. Never commit/push directly to either, force-push,
  use `--no-verify`, or bypass protections.
- Require `origin/next`; branch from it with no upstream. Use the work-type prefix
  above or `release/X.Y.Z`. Later upstreams must be `origin/<same-branch-name>`;
  pushes use an explicit same-name refspec.
- All changes enter `next` via draft PRs, squash-merged; delete working branches
  afterward. Require resolved conversations, linear history, and no bypass actors.
  Follow the naming conventions below. Include supplied attribution in commits and PRs.
- Fill `.github/pull_request_template.md`; link closing issues with `Fixes #<n>`.
- User-visible changes add a bullet ending with its PR link under the appropriate
  `## Unreleased` category in `CHANGELOG.md`, in the same PR.

### Naming conventions

- Branch: `<type>/<issue-number>-<slug>` (omit the number without an issue); slug is
  lowercase kebab-case; single dots between segments are allowed (e.g. `require-cli-0.9.0`).
- Commit/PR title: `<type>: <imperative summary>`; short English, no scope or final period.
- Release: branch `release/X.Y.Z`, title `Release X.Y.Z`.

## Release policy

- Only releases change the root `package.json` version. Merging a `release/X.Y.Z` PR into
  `next` publishes; the PR is the human gate (version, changelog notes, green CI).
  [`release.yml`](.github/workflows/release.yml) defines the validation, tagging, `main`
  sync, and registry publication steps.
- Release PRs: move Unreleased notes to `## X.Y.Z`, leaving Unreleased empty; never rewrite
  released notes. Check VSIX contents with `pnpm exec vsce ls --no-dependencies`.
- Tags are immutable; never delete, move, or reuse a released version. If a version reached
  a registry, release the next patch.
- Retry registry publication for an existing release with
  `gh workflow run release.yml -f tag=vX.Y.Z --ref next`. `RELEASE_PAUSED=true` (repository
  variable) stops release jobs.

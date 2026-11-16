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
pnpm lint          # inspect
pnpm lint:fix      # automatic fixes
pnpm lint:strict   # zero warnings
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

- `next` is the integration/default branch; `main` mirrors the latest release tag,
  advanced by `release.yml`. Never commit/push directly to either, force-push,
  use `--no-verify`, or bypass protections; resolve hook blocks with the maintainer.
- Require `origin/next` (if missing, ask the maintainer; never substitute `main`);
  branch from it with no upstream: `git switch --no-track -c <branch> origin/next`.
  Later upstreams must be `origin/<same-branch-name>`; pushes use an explicit same-name
  refspec: `git push -u origin refs/heads/<branch>:refs/heads/<branch>`.
- Check existing changes before switching branches; never discard, stash, or include
  unrelated work without agreement. Stage files by name; avoid `git add -A` and `git commit -am`.
- `pnpm setup:git` installs `.githooks/` and branch/push defaults, refuses to replace a
  different hooks path, and removes incorrect main/next upstreams. Hooks block protected
  branch commits/pushes, push destinations with another name, invalid branch names, and
  invalid commit subjects (Naming conventions); they complement server-side protection.
- All changes enter `next` via draft PRs (`gh pr create --draft --base next`), one coherent
  change each, squash-merged after both CI jobs pass and maintainer approval.
  Include supplied attribution in commits and PRs.
- Describe problem, resulting behavior, validation (including manual checks), and known
  limitations; link closing issues with `Fixes #<n>`.
- User-visible changes add a bullet under `## Unreleased` in `CHANGELOG.md`, in the same PR.

### Naming conventions

- Branch: `<type>/<slug>` with type `feat`, `fix`, `refactor`, `docs`, or `chore`, or
  `release/X.Y.Z`. Slug: `[a-z0-9]+([.-][a-z0-9]+)*`; versions have no leading zeros.
- Commit/PR: short imperative English subject consistent with recent history; no leading
  or trailing spaces and no final period. Review English/imperative wording manually.
- Release: `release/X.Y.Z` → `Release X.Y.Z`; a `Release <version>` subject is allowed only
  on the matching branch. Squash: `<PR title> (#N)`.
- Hooks check branch names on commit/push and new commit subjects; rerun `pnpm setup:git`
  after hook changes.

## Release policy

- Only releases change the root `package.json` version. Merging a `release/X.Y.Z` PR into
  `next` publishes; the PR is the human gate (version, changelog notes, green CI).
- `.github/workflows/release.yml` separates validation (`plan`), source refs and the
  GitHub Release (`github`), and registry publication (`publish`). `plan` checks the
  version, notes, and ancestry; a merged release must be newer and untagged. `github`
  creates `vX.Y.Z`, fast-forwards `main`, builds the VSIX, and attaches it to the GitHub
  Release. Only then does `publish` download that VSIX and publish to Marketplace,
  then Open VSX. It does not rerun tests or verify registries.
- Release PRs: move Unreleased notes to `## X.Y.Z`, leaving Unreleased empty; never rewrite
  released notes. Inspect VSIX contents with `pnpm exec vsce ls --no-dependencies` against
  `.vscodeignore`. `extensionKind: ["workspace"]`: check remote behavior in the workspace
  extension host; record Linux and remote checks separately.
- Tags are immutable; never delete, move, or reuse a released version. Retry registry
  publication with `gh workflow run release.yml -f tag=vX.Y.Z --ref next`: `plan` validates
  the existing tag and `publish` uses its existing GitHub Release VSIX; `github` is skipped.
  The release asset and matching `main` must already exist. Report missing prerequisites
  before recovery; dispatch does not create releases or repair `main`. If a version
  reached a registry, release the next patch.
- `RELEASE_PAUSED=true` (repository variable) stops the release jobs; for a skipped merged
  release, enable publication, tag the exact merged commit, and push the same-name tag.
  The tag-push flow runs all three jobs; dispatch is only for an existing release asset.
- Manual `main` sync is recovery only: from a clean checkout with hooks installed, verify
  `origin/main` and `origin/next` ancestry, then
  `git push origin refs/tags/vX.Y.Z:refs/heads/main`; never advance to a newer `next` HEAD.
- Prerequisites: `next` protected with review, both CI checks, and up-to-date branches;
  `main` blocks force-push/deletion and allows the **GitHub Actions** app to push;
  environment **release** with an open deployment branch policy; Marketplace publisher and
  Open VSX namespace **nodeint** with trusted publishing for `nodeint/migent-vscode`,
  workflow `release.yml`, environment `release`; Actions OIDC (`id-token: write`,
  `contents: write`), no PAT secrets. See the
  [Marketplace](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)
  and [Open VSX](https://github.com/eclipse-openvsx/openvsx/blob/master/cli/README.md#trusted-publishing)
  trusted publishing guides.

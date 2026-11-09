# Contributing

This guide covers `nodeint/migent-vscode`, the Migent extension for VS Code.
The extension currently provides read-only monitoring. Other planned features in `plans/` are not
necessarily implemented.

## Development setup

Use Node.js 24 and pnpm 12.6.0 to match CI. The extension supports VS Code
1.93.0 and later, as declared in `package.json`.

```bash
git clone https://github.com/nodeint/migent-vscode.git
cd migent-vscode
pnpm install --frozen-lockfile
pnpm setup:git
pnpm typecheck
pnpm build
pnpm test
pnpm package
```

Run commands from the repository root. `pnpm build` bundles `src/extension.ts`
into `dist/extension.js`, leaving the VS Code API external. `pnpm package`
packages the existing build; always build first.

Read [AGENTS.md](AGENTS.md) and the [documentation load map](docs/README.md#start-here)
before making changes. Establish the scope, expected behavior, and verification
method, then run the relevant baseline checks. Stop and report failures before
implementation so they can be resolved or explicitly accepted.

## Project layout

- `src/extension.ts`: extension activation and command registration.
- `src/vscode/`: the VS Code layer (registry, watchers, context keys, CLI capability); verified by the integration tests.
- `src/core/`: session and workflow data handling, with colocated Vitest tests.
- `src/cli/`: CLI location and version checks (no `vscode` import), with colocated Vitest tests.
- `src/core/fixtures/`: sample session and workflow data used by tests.
- `package.json`: extension identity, version, VS Code contributions, and scripts.
- `.vscodeignore`: allowlist of files included in the VSIX.
- `.github/workflows/ci.yml`: validation on macOS and Windows.
- `plans/` and `designs/`: roadmap and UI references.

Keep data handling testable without a VS Code host. Follow existing ownership
and patterns, keep changes focused, and preserve unrelated work. Do not edit
generated `dist/` files or commit VSIX artifacts, dependencies, or credentials.

## Issues and branches

Read the issue and its comments before starting. Summarize the problem,
reproduction steps, expected behavior, and acceptance criteria. Clarify closed
or ambiguous issues before implementing a change.

With GitHub CLI, issue details and comments can be read with:

```bash
gh api repos/nodeint/migent-vscode/issues/<number>
gh api repos/nodeint/migent-vscode/issues/<number>/comments
```

Use short branch names describing the change: `feat/<slug>`, `fix/<slug>`,
`docs/<slug>`, or `chore/<slug>`. Use `release/X.Y.Z` for release preparation.
`next` is the integration branch; `main` mirrors the latest release tag.
Start work from `origin/next`. If it is missing, ask the maintainer to initialize
it from the agreed baseline; do not silently substitute `main`.

```bash
git fetch origin
git status --short
git switch --no-track -c <branch> origin/next
git branch -vv
```

Check existing changes before switching branches. Do not discard, stash, or
include unrelated changes without agreement. Work on a dedicated branch;
its upstream should be absent until the first push, then `origin/<branch>`.
Do not commit directly to `main` or `next`, or push feature changes directly
to either branch. Open PRs into `next`.

Run `pnpm setup:git` once per checkout to install `.githooks/` and local branch/
push defaults. It refuses to replace a different hooks path and removes
incorrect main/next upstreams from working branches. The hooks block protected
branch commits, direct protected branch pushes, and mismatched branch names.
The sole main update exception is the guarded sync and the release workflow.
Local hooks complement server-side protection; they do not replace it.
If a hook blocks an operation, resolve the cause with the maintainer; do not
bypass safeguards.

## Verification

Before and after implementation, run checks relevant to the change. The full
CI sequence after dependency installation is:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm package
```

CI runs this sequence on macOS and Windows, followed by `pnpm test:integration`
(a failure fails the job on both systems). To limit flakiness, each CI job runs the
integration tests against one VS Code version: 1.145.0 on macOS and 1.93.0
(the minimum) on Windows. `pnpm lint` enforces that `src/core/` and `src/cli/`
never import `vscode`. There are currently no separate lint or gate scripts.
Report baseline failures separately from regressions; do not weaken
verification to make a change pass.

Follow the [testing guide](docs/testing.md) when selecting test cases and
verifying behavior changes.

To check the packaged extension:

1. Run `pnpm build` and `pnpm package`.
2. In VS Code, use **Extensions: Install from VSIX...** and select the generated
   `migent-vscode-<version>.vsix`.
3. Reload VS Code and open a workspace containing `.migent/config.yaml` to
   exercise the declared activation event.
4. Verify the behavior affected by the change and inspect extension-host logs
   for errors. Monitoring is implemented; running and controlling sessions remains roadmap work.

## Pull requests

Target `next`. Keep one coherent change per PR.
Describe the problem, resulting behavior, and validation, including manual
checks and known limitations. Add `Fixes #<number>` when the PR closes an issue.
Record user-visible changes under `## Unreleased` in `CHANGELOG.md`.

Review the diff, stage files by name, and use a short imperative commit subject
consistent with recent history. Avoid `git add -A` and `git commit -am` so that
unrelated work and generated files are not included accidentally.

With authorization to push and open a PR:

```bash
git add <files>
git commit -m "<subject>"
git push -u origin refs/heads/<branch>:refs/heads/<branch>
gh pr create --draft --base next --head <branch> --title "<subject>" --body-file <notes-file>
gh pr checks <number>
```

Use the explicit same-name push refspec and verify the upstream afterward.
Wait for both CI matrix jobs to pass against the current base before merging.
Report failing or pending checks accurately. Merging requires maintainer
approval; do not force-push or bypass branch protection.

## Releasing

Merging a `release/X.Y.Z` pull request into `next` publishes the extension.
`.github/workflows/release.yml` validates the merged commit, creates the
`vX.Y.Z` tag, fast-forwards `main` to it, and then builds and publishes the
VSIX to VS Code Marketplace, Open VSX, and GitHub Releases. `main` follows the
release tag; it never waits for registry propagation.

The release pull request stays the human gate: it sets the version, writes the
changelog notes, and passes CI before merging. Tagging, main synchronization,
and publication are automatic.

### One-time maintainer setup

Before the first release:

1. Initialize remote `next` from the agreed baseline. Protect `next` with PR
   review, both CI matrix checks, and "require branches to be up to date before
   merging", so the squash-merged release commit matches the tested merge ref.
2. Protect `main` against force-push and deletion, and add the **GitHub
   Actions** app to its push restrictions so the workflow can fast-forward it.
   A PR-only main rule will block that operation; agree on the exception before
   the first automated release.
3. Create the GitHub environment **release**. Leave its deployment branch
   policy open: the workflow deploys from pull-request, tag, and branch refs.
   Restrict who can merge release PRs instead of relying on reviewers.
4. Create/verify Marketplace publisher **nodeint**. Under Trusted Publishing,
   authorize GitHub owner **nodeint**, repository **migent-vscode**, workflow
   **release.yml**, environment **release**.
5. Create/claim Open VSX namespace **nodeint**, complete its publisher agreement,
   and configure a trusted publisher for the same owner, repository, workflow,
   and environment. Ensure the publishing account has namespace rights.
6. Allow GitHub Actions OIDC requests and GitHub Release creation. The job
   requests `id-token: write` and `contents: write`; no PAT secrets are
   required. Install and authenticate GitHub CLI locally for release observation.
7. Set the repository variable `RELEASE_PAUSED` to `true` to stop automatic
   publication, and unset it to resume.

See the official [Marketplace Trusted Publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)
and [Open VSX CLI Trusted Publishing guide](https://github.com/eclipse-openvsx/openvsx/blob/master/cli/README.md#trusted-publishing).
Do not push a release tag until these prerequisites are ready.

### Prepare a release PR

Start with a clean working tree and create `release/X.Y.Z` from `origin/next`.
Feature work should already be merged through its own PR. Confirm the version
with the maintainer and check existing tags and registry versions to avoid
reusing a published version.

Update the root `package.json` version. Move the user-facing notes from
`## Unreleased` in `CHANGELOG.md` into `## X.Y.Z`, leaving an empty Unreleased
section for future changes. Compare the notes with changes since the previous
release and preserve existing released notes. Refresh README and release
assets when the release changes what users can do.

Run the full verification sequence and inspect the VSIX contents using
`pnpm exec vsce ls --no-dependencies`. Confirm that `.vscodeignore` includes
all required runtime assets and excludes development files and secrets.
Install the VSIX and test the release behavior. CI covers macOS and Windows;
record Linux and remote-host checks separately when relevant. The extension
declares `extensionKind: ["workspace"]`, so remote behavior must be checked
in the workspace extension host.

Open the release PR against `next` with the release notes and verification
results. Both CI jobs must pass. Merging publishes the release.

### Automatic publication

`release.yml` starts when a `release/*` pull request is merged into `next`. It
checks that the merged commit carries a newer version, a nonempty `## X.Y.Z`
changelog section, and no existing tag, then creates and pushes `vX.Y.Z`,
fast-forwards `main` to that commit, and publishes the VSIX to Marketplace, then
Open VSX, then a GitHub Release. It does not rerun the tests: the release PR's
CI and the up-to-date merge requirement are the test gate.

Watch the run through completion and check the GitHub Release:

```bash
gh run list --workflow release.yml --event pull_request --json databaseId,status,conclusion,url
gh run watch <databaseId> --exit-status
gh release view vX.Y.Z
```

The workflow verifies both registries itself, retrying while propagation lags.
Install the exact version from Marketplace and the Open VSX VSIX in a suitable
client and verify the affected behavior. Metadata checks alone do not establish
successful installation.

To publish an existing tag again, or to recover after a failed run, dispatch the
workflow for that tag:

```bash
gh workflow run release.yml -f tag=vX.Y.Z --ref next
```

Keep tags immutable. Never delete, move, or reuse a released version.

### Synchronize main

`main` is fast-forwarded by the workflow before publication; it does not wait
for either registry. Manual synchronization is only a recovery path. Run it
from a clean checkout with `pnpm setup:git` installed:

```bash
git fetch origin --tags
git merge-base --is-ancestor origin/main vX.Y.Z
git merge-base --is-ancestor vX.Y.Z origin/next
git push origin refs/tags/vX.Y.Z:refs/heads/main
git ls-remote origin refs/heads/main refs/tags/vX.Y.Z
```

The pre-push hook requires the configured origin, unchanged remote refs, a
lightweight tag, matching version/notes, and fast-forward ancestry. The two
remote hashes must match afterward. Do not advance main to a newer next HEAD,
force-push, or create a separate merge commit. If protection blocks the update,
report the configuration blocker and leave main unchanged.

### Failed or partial releases

The tag and `main` may already point at a release whose publication failed; that
is expected, because source state no longer depends on the registries. Report the
failing step and which registries or GitHub assets already exist. If nothing
reached either registry, dispatch the same tag again after fixing external
configuration. When a version already reached a registry, prepare the next patch
through a new release PR; never delete or overwrite a released version. If the
run failed only at "Verify main advanced", publication succeeded: fix the main
push restriction and re-run, or run the guarded synchronization above.

If `RELEASE_PAUSED` skipped a merged release, create the tag on the merged
commit that the release PR produced and dispatch it:

```bash
git tag vX.Y.Z <merged-release-sha>
git push origin refs/tags/vX.Y.Z:refs/tags/vX.Y.Z
gh workflow run release.yml -f tag=vX.Y.Z --ref next
```

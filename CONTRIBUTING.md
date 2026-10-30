# Contributing

This guide covers `nodeint/migent-vscode`, the Migent extension for VS Code.
The extension is currently a scaffold. Planned features in `plans/` are not
necessarily implemented.

## Development setup

Use Node.js 24 and pnpm 12.6.0 to match CI. The extension supports VS Code
1.90.0 and later, as declared in `package.json`.

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
- `src/core/`: session and workflow data handling, with colocated Vitest tests.
- `src/core/fixtures/`: sample session and workflow data used by tests.
- `package.json`: extension identity, version, VS Code contributions, and scripts.
- `.vscodeignore`: allowlist of files included in the VSIX.
- `.github/workflows/ci.yml`: validation on Ubuntu and Windows.
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
`next` is the integration branch; `main` records verified published releases.
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
The sole main update exception is the guarded release synchronization below.
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

CI runs this sequence on Ubuntu and Windows. There are currently no separate
lint or gate scripts. Report baseline failures separately from regressions;
do not weaken verification to make a change pass.

For behavior changes, cover the affected cases with meaningful tests. Core
tests use fixtures and temporary directories without launching VS Code.
For extension commands, activation, or UI changes, also verify the behavior
in VS Code and describe the manual steps in the PR. Automated extension-host
integration tests are not currently configured.

To check the packaged extension:

1. Run `pnpm build` and `pnpm package`.
2. In VS Code, use **Extensions: Install from VSIX...** and select the generated
   `migent-vscode-<version>.vsix`.
3. Reload VS Code and open a workspace containing `.migent/config.yaml` to
   exercise the declared activation event.
4. Verify the behavior affected by the change and inspect extension-host logs
   for errors. The current scaffold registers **Migent: Refresh** with an empty
   handler; monitoring and execution features remain roadmap work.

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

The tag-triggered `.github/workflows/release.yml` publishes the same tested
VSIX to VS Code Marketplace, Open VSX, and GitHub Releases. It validates the
tag, runs the reusable CI workflow on Windows and Ubuntu, and publishes from
the Ubuntu artifact. `main` advances only after publication is verified.

### One-time maintainer setup

Before the first release:

1. Initialize remote `next` from the agreed baseline. Protect `next` with PR
   review and both CI matrix checks. Protect `main` against force-push/deletion
   and allow the designated release maintainer to perform the guarded
   fast-forward. A PR-only main rule will block that operation; agree on the
   policy before release rather than bypassing it during publication.
2. Create the GitHub environment **release**, restrict it to `v*` tags, and
   configure required reviewers for publication approval.
3. Create/verify Marketplace publisher **nodeint**. Under Trusted Publishing,
   authorize GitHub owner **nodeint**, repository **migent-vscode**, workflow
   **release.yml**, environment **release**.
4. Create/claim Open VSX namespace **nodeint**, complete its publisher agreement,
   and configure a trusted publisher for the same owner, repository, workflow,
   and environment. Ensure the publishing account has namespace rights.
5. Allow GitHub Actions OIDC requests and GitHub Release creation. The publish
   job requests `id-token: write` and `contents: write`; no PAT secrets are
   required. Install and authenticate GitHub CLI locally for release observation
   and the final synchronization hook.

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
Install the VSIX and test the release behavior. CI covers Ubuntu and Windows;
record macOS and remote-host checks separately when relevant. The extension
declares `extensionKind: ["workspace"]`, so remote behavior must be checked
in the workspace extension host.

Open the release PR against `next` with the release notes and verification
results. Both CI jobs must pass. Obtain approval before merging or publishing.

### Publish and verify

After merging, fetch origin and identify the PR's exact merge SHA on next.
Verify its root version and nonempty `## X.Y.Z` changelog section. With
authorization, create and push a new lightweight stable tag:

```bash
git tag vX.Y.Z <merged-release-sha>
git push origin refs/tags/vX.Y.Z:refs/tags/vX.Y.Z
```

The workflow accepts stable `vX.Y.Z` tags only and rejects tags outside next,
version mismatches, missing notes, and unexpected extension identity. It runs
the complete CI matrix before the environment-gated publishing job. Approve
that job when ready. It publishes the tested artifact to Marketplace, then
Open VSX, then creates the GitHub Release using the matching changelog section.
Keep tag references immutable and do not tag an unmerged branch.

Watch the run through completion and check the GitHub Release:

```bash
gh run list --workflow release.yml --branch vX.Y.Z --json databaseId,status,conclusion,url
gh run watch <databaseId> --exit-status
gh release view vX.Y.Z
node scripts/verify-publication.mjs X.Y.Z
```

The public registry check can lag publication; wait and recheck if propagation
is incomplete. Install the exact version from Marketplace and the Open VSX
VSIX in a suitable client and verify the affected behavior. Metadata checks
alone do not establish successful installation.

### Synchronize main

After the workflow succeeds and both registry/install checks pass, fetch refs
and confirm that main is an ancestor of the tagged SHA and the tag is on next.
With authorization to finish the release, run:

```bash
git fetch origin --tags
git merge-base --is-ancestor origin/main vX.Y.Z
git merge-base --is-ancestor vX.Y.Z origin/next
git push origin refs/tags/vX.Y.Z:refs/heads/main
git ls-remote origin refs/heads/main refs/tags/vX.Y.Z
```

Run from a clean checkout with `pnpm setup:git` installed. The pre-push hook
requires the configured origin, unchanged remote refs, a lightweight tag,
matching version/notes, fast-forward ancestry, a successful release workflow
for the same tag and SHA, and that version exposed by both public registries.
The two remote hashes must match afterward. Do not advance main to a newer
next HEAD, force-push, or create a separate merge commit. If protection blocks
the update, report the configuration blocker and leave main unchanged.

### Failed or partial releases

On failure, leave main and the tag unchanged. Report the failing step and
which registries or GitHub assets already exist. Do not blindly rerun a
partially published release, skip duplicate-version errors, or overwrite a
released version. Agree on recovery with the maintainer. If a version reached
either registry, prepare the next patch through a new release PR and tag.
When only registry propagation is pending, recheck publication rather than
republishing. If nothing was published, a maintainer may authorize rerunning
the same immutable tag after fixing external configuration.

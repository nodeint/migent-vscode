---
name: release
description: Prepare extension release notes and PRs; merge and publish VSIX with authorization.
---

# Release

## Steps

1. Read [repository policy](../../../CONTRIBUTING.md#release-policy),
   [release workflow](../../../.github/workflows/release.yml), and
   [release validation](../../../scripts/release.mjs). Ask about missing required inputs.
2. Follow [Prepare and review](#prepare-and-review). Get notes and version approval
   before version edits, commits, pushes, or PR creation; preserve unrelated work.
3. Follow [Open PR and pass CI](#open-pr-and-pass-ci) and
   [create-pr](../create-pr/SKILL.md) for commit, push, and PR mechanics.
   Stop on failed checks; changed notes or version need approval again.
4. Check [Prerequisites](#prerequisites), then [Merge and verify](#merge-and-verify)
   with explicit merge authorization; reuse existing authorization within scope.
5. On publishing failure, report the job and step, then stop. For authorized
   retries, follow [Recovery](#recovery).
6. Report version, commit, tag, run and GitHub Release URLs, CI, Marketplace and
   Open VSX installation results, `main` synchronization, and anything unverified.
   A tag alone does not prove completion.

## Preparation

### Prepare and review

- Fetch `origin` and tags. Require a clean entry tree and resume existing release
  branches or PRs. Preserve unrelated work; revisions keep only expected release edits.
- Compare `git log <previous-tag>..HEAD` with Unreleased for missing user-visible
  changes. Confirm release scope and version with the maintainer when not supplied.
- Check the root `package.json`, existing release tags, Marketplace, and Open VSX
  to avoid reusing a published version. A new release must be newer than the latest
  stable release tag. Existing tags belong to recovery, not new release preparation.
- Create `release/X.Y.Z` from `origin/next` under CONTRIBUTING.md branch rules.
- Draft only `CHANGELOG.md` before notes approval. Move Unreleased notes into
  `## X.Y.Z`, leaving Unreleased empty; never rewrite released notes.
- Compare notes with the actual changes and describe observable extension behavior,
  compatibility requirements, and migration steps when relevant. Review the version,
  notes, and diff locally; approval needs neither CI nor an existing release commit.

### Open PR and pass CI

After notes approval, update only the root `package.json` version to `X.Y.Z`.
Run the full repository verification sequence:

```bash
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
pnpm package
pnpm exec vsce ls --no-dependencies
```

- Inspect VSIX contents against `.vscodeignore`; check required runtime assets and
  excluded development files and secrets. Do not commit generated bundles or VSIX files.
- Install the VSIX through **Extensions: Install from VSIX...**, reload, open a
  workspace with `.migent/config.yaml`, and verify release behavior and host logs.
  Record Linux and remote workspace-host checks separately.
- Confirm the diff matches approved notes, version, and release scope. Follow the
  create-pr skill to commit, push, and open a draft PR into `next`.
- Wait for both CI matrix jobs on the current head and base, including integration
  tests on both documented VS Code versions. Mark ready only when green. If `next`
  advances, update and repeat affected review and checks.

## Publishing

### Prerequisites

- Verify repository protections, required checks, the `release` environment,
  trusted publishing for Marketplace and Open VSX, and Actions permissions against
  CONTRIBUTING.md. Confirm publication is not paused by `RELEASE_PAUSED=true`.
- Stop on missing prerequisites. Changing protections or publisher settings needs
  explicit authorization. Use the configured VSIX publishing workflow.

### Merge and verify

- Obtain explicit merge authorization unless already given. Recheck current-head
  CI and publishing prerequisites, then squash-merge with subject `Release X.Y.Z`.
- Watch the release run triggered by the merged PR:

  ```bash
  gh run list --workflow release.yml --event pull_request --json databaseId,status,conclusion,url
  gh run watch <id> --exit-status
  gh release view vX.Y.Z
  ```

  Match the run to the release PR and merged commit. If no run appears, inspect
  the trigger and pause variable; report the blocker before creating a tag.
- Fetch and verify that the tag points to the merged release commit and `origin/main`
  equals that commit. Confirm the GitHub Release contains the expected VSIX.
- Confirm the exact version appears on Marketplace and Open VSX, allowing for
  propagation delay. Install from Marketplace and install the Open VSX VSIX in a
  suitable client; verify affected behavior. Metadata alone does not prove installation.
- Report any installation or platform checks that could not be performed.

### Recovery

Inspect the failed run, tag, `main`, GitHub Release assets, and both registries
first. Retry only authorized steps; ask before undocumented recovery or new
external mutations. Tags are immutable: never delete, move, or reuse a release tag.

- If the version reached either registry, prepare the next patch through a new
  release PR. Never overwrite a published version.
- If neither registry received the version, fix the external cause, then dispatch
  the existing tag and watch the new run:

  ```bash
  gh workflow run release.yml -f tag=vX.Y.Z --ref next
  ```

  Dispatch runs validation and registry publication only; the `github` job is skipped.
  Require the existing GitHub Release VSIX and matching `main` before dispatching.
  If either is missing, report the failed job and recovery blocker; do not delete
  release assets or create replacement assets independently. For a failed `publish`
  job, rerunning only failed jobs also preserves the completed GitHub Release.
- If `RELEASE_PAUSED` skipped a merged release, follow CONTRIBUTING.md to tag the
  exact merged release commit and push the same-name tag after publication is enabled
  and the recovery actions are authorized. The tag push runs all three jobs.
- If `main` did not advance, follow CONTRIBUTING.md's guarded manual synchronization
  procedure after resolving protection settings. Never advance it to a newer `next`
  HEAD or force-push. Recheck both registries before choosing retry or next patch.

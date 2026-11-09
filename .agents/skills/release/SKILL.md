---
name: release
description: >
  Release the Migent VS Code extension through a PR into next, then let the
  merge workflow tag the merged commit, fast-forward main, and publish to
  Marketplace, Open VSX, and GitHub. Use for release, tag a version, push a
  release tag, or /release requests.
metadata:
  short-description: "Release the Migent VS Code extension"
---

# Release the extension

Read `CONTRIBUTING.md` from `## Releasing` onward. Follow its prerequisites,
verification, and recovery procedure. Work from the repository root and reply in
the user's language.

## Prepare

Use the user's version. Otherwise propose the next patch above the root
package version and existing stable tags; confirm before continuing.
A request to release a named version authorizes preparing and pushing its
release PR. Merge only when explicitly authorized; merging publishes.

Require a clean working tree. Do not stash, discard, or include unrelated work.
Fetch origin and tags; require origin/next, never substitute main.
Run `pnpm setup:git`. Create `release/X.Y.Z` from origin/next without tracking,
or inspect and resume an existing release PR. Its upstream must be absent or
origin/release/X.Y.Z. Never reuse a published version or move an existing tag.
Confirm the release environment, the GitHub Actions push access to main, and
both registry OIDC policies described in CONTRIBUTING are configured.

## Release PR

Change only root package.json, CHANGELOG.md, and pnpm-lock.yaml if needed.
Compare commits since the previous release with the user-facing notes.
Move Unreleased notes under `## X.Y.Z`, leaving Unreleased empty.
Preserve released notes. Stop if there is no user-facing change to record.

Run typecheck, build, test, and package as documented in CONTRIBUTING.
Inspect the VSIX and perform relevant manual VS Code checks. Stop on failure.
Stage release files by name, commit `Release X.Y.Z`, and push explicitly:

```bash
git push -u origin refs/heads/release/X.Y.Z:refs/heads/release/X.Y.Z
gh pr create --draft --base next --head release/X.Y.Z --title "Release X.Y.Z" --body-file <notes-file>
```

Wait for both CI matrix jobs to pass, then mark ready. Without merge
authorization, report the PR URL and stop. Otherwise squash-merge without
bypassing checks. Never commit/push feature work directly to main or next.

## Merge and watch

Squash-merging the release PR starts `release.yml`, which validates the merged
commit, creates and pushes `vX.Y.Z`, fast-forwards `main` to it, then builds and
publishes to both registries and GitHub Releases. Do not create the tag or push
main by hand; that is only the recovery path.

```bash
gh run list --workflow release.yml --event pull_request --json databaseId,status,conclusion,url
gh run watch <databaseId> --exit-status
gh release view vX.Y.Z
```

If no run is listed, wait 30 seconds and retry, at most five times. The workflow
validates next ancestry, version ordering, and nonempty release notes; it does
not rerun tests because the release PR's CI is the gate.

Report success only when the workflow concludes success. The final "Verify main
advanced" step can fail after a successful publication: report it as a main
synchronization problem, not a publication failure. Follow CONTRIBUTING's
recovery procedure; never delete or move a tag, and never blindly rerun a
partially published release. To retry a tag that published nothing, run
`gh workflow run release.yml -f tag=vX.Y.Z --ref next`.

## Verify

The workflow verifies both registries itself, retrying while propagation lags.
Install the exact version from Marketplace and the Open VSX VSIX in a suitable
client and verify the affected behavior; metadata checks alone do not establish
successful installation. Confirm remote main equals the tagged SHA:

```bash
git ls-remote origin refs/heads/main refs/tags/vX.Y.Z
```

Never force-push, advance main to the latest next HEAD, or create a separate
merge/squash commit. If hooks or branch protection block synchronization, report
the blocker and ask; do not bypass it. Report version, tag, workflow/release
URLs, registry checks, manual checks, and the main synchronization result.

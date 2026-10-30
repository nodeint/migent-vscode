---
name: release
description: >
  Release the Migent VS Code extension through a PR into next, tag the merged
  commit, watch Marketplace, Open VSX, and GitHub publication, then fast-forward
  main to the verified tag. Use for release, tag a version, push a release tag,
  or /release requests.
metadata:
  short-description: "Release the Migent VS Code extension"
---

# Release the extension

Read `CONTRIBUTING.md` from `## Releasing` onward. Follow its prerequisites,
verification, recovery, and guarded synchronization procedure. Work from the
repository root and reply in the user's language.

## Prepare

Use the user's version. Otherwise propose the next patch above the root
package version and existing stable tags; confirm before publishing.
A request to release a named version authorizes preparing/pushing its release
PR and tagging the merged commit. Merge only when explicitly authorized.
Authorization to finish the release merge includes final guarded main
synchronization. Do not ask again for already authorized actions.

Require a clean working tree. Do not stash, discard, or include unrelated work.
Fetch origin and tags; require origin/next, never substitute main.
Run `pnpm setup:git`. Create `release/X.Y.Z` from origin/next without tracking,
or inspect and resume an existing release PR. Its upstream must be absent or
origin/release/X.Y.Z. Never reuse a published version or move an existing tag.
Confirm the release environment and both registry OIDC policies described in
CONTRIBUTING are configured before pushing the tag.

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

## Tag and publish

Fetch after merging. Identify the PR's actual merge SHA on origin/next,
verify its root version and changelog, and ensure the tag does not exist.
Create a lightweight tag on that exact SHA, never on an unmerged branch:

```bash
git tag vX.Y.Z <merged-release-sha>
git push origin refs/tags/vX.Y.Z:refs/tags/vX.Y.Z
gh run list --workflow release.yml --branch vX.Y.Z --json databaseId,status,conclusion,url
gh run watch <databaseId> --exit-status
gh release view vX.Y.Z
```

Pushing the tag starts publication after the environment approval gate.
If no run is listed, wait 30 seconds and retry, at most five times.
The workflow validates next ancestry, version, and nonempty release notes;
runs CI on Windows/Linux; publishes the tested Ubuntu VSIX through OIDC to
both registries; then creates the GitHub Release with that VSIX.

Report success only when the workflow concludes success. On failure, leave
main and the tag unchanged and report completed external steps. Follow
CONTRIBUTING's recovery procedure; never blindly rerun partial publication.

## Advance main

Run `node scripts/verify-publication.mjs X.Y.Z` and the documented registry
install checks. If propagation is incomplete, wait and recheck without
republishing. Follow CONTRIBUTING's explicit tag-to-main push procedure.
The installed hook requires ancestry, successful release workflow, and both
public registries before permitting this exception.

Never force-push, advance main to the latest next HEAD, or create a separate
merge/squash commit. If hooks or branch protection block synchronization,
report the blocker and ask; do not bypass it. Verify remote main equals the
tagged SHA. Report version, tag, workflow/release URLs, registry checks,
manual checks, and synchronization result.

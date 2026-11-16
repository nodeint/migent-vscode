import { test } from "node:test";
import assert from "node:assert/strict";
import { branchProblem, commitProblem, commitSubjectProblem, pullRequestProblems, pushProblems, subjectProblem } from "./git-flow.mjs";

test("commit subjects accept the default merge of any branch into the current branch", () => {
  const branch = "feat/72-migrate-questions-per-execution";
  for (const source of ["branch 'next'", "branch 'main'", "branch 'fix/other'", "remote-tracking branch 'origin/next'"]) {
    assert.equal(commitSubjectProblem(`Merge ${source} into ${branch}`, branch), null, source);
  }
  assert.equal(commitSubjectProblem("feat: add status", branch), null);
  assert.ok(commitSubjectProblem("Merge branch 'next' into fix/other", branch));
  assert.ok(commitSubjectProblem(`Merge branch 'next' into ${branch} extra`, branch));
  assert.ok(commitSubjectProblem(`Merge next into ${branch}`, branch));
  assert.ok(pullRequestProblems(branch, `Merge branch 'next' into ${branch}`).length);
});

test("commits require a working branch", () => {
  for (const branch of ["", "main", "next"]) assert.ok(commitProblem(branch));
  for (const branch of ["fix/status", "docs/contributing", "release/0.1.0"]) assert.equal(commitProblem(branch), null);
});

test("commits require no upstream or the same-name origin upstream", () => {
  assert.equal(commitProblem("fix/status", "origin/fix/status"), null);
  assert.match(commitProblem("fix/status", "origin/next"), /Upstream origin\/next/);
  assert.ok(commitProblem("fix/status", "fork/fix/status"));
});

test("force-pushes to existing branches are blocked", () => {
  const ref = "refs/heads/fix/status";
  assert.match(pushProblems(`${ref} abc ${ref} def`, ref, () => false)[0], /Force-push/);
  assert.deepEqual(pushProblems(`${ref} abc ${ref} def`, ref, () => true), []);
  assert.deepEqual(pushProblems(`${ref} abc ${ref} ${"0".repeat(40)}`, ref, () => false), []);
});

test("all pushes and deletions into protected branches are blocked", () => {
  for (const target of ["main", "next"]) {
    for (const source of ["refs/heads/fix/status", "refs/tags/v0.1.0", "(delete)"]) {
      assert.equal(pushProblems(`${source} abc refs/heads/${target} def`, "refs/heads/fix/status").length, 1);
    }
  }
});

test("branch pushes preserve the source branch name, including HEAD", () => {
  const ref = "refs/heads/fix/status";
  for (const source of [ref, "HEAD"]) {
    assert.deepEqual(pushProblems(`${source} abc ${ref} def`, ref), []);
    assert.equal(pushProblems(`${source} abc refs/heads/fix/other def`, ref).length, 1);
  }
  assert.deepEqual(pushProblems("(delete) 000 refs/heads/old abc", ref), []);
  assert.deepEqual(pushProblems("refs/tags/v0.1.0 abc refs/tags/v0.1.0 000", ref), []);
  assert.equal(pushProblems(`${ref} abc ${ref} def\n${ref} abc refs/heads/main def`, ref).length, 1);
});

test("branch names follow the work types or release/X.Y.Z", () => {
  for (const branch of ["feat/session-tree", "fix/status", "refactor/store", "docs/contributing", "chore/require-cli-v6", "fix/123-status", "release/0.1.12"]) {
    assert.equal(branchProblem(branch), null);
  }
  for (const branch of ["results-header-ui", "feature/x", "fix/Status", "fix/", "fix/a--b", "release/0.1", "release/01.0.0", "chore/require-cli-0.6.0", "fix/0-status", "fix/123"]) {
    assert.ok(branchProblem(branch), branch);
  }
  assert.ok(commitProblem("migrate-to-migent-0.5.4"));
  assert.equal(pushProblems("refs/heads/tmp abc refs/heads/tmp def", "refs/heads/tmp").length, 1);
});

test("commit subjects use <type>: <summary>, and release subjects match the branch", () => {
  for (const subject of ["feat: update overview progress UI", "fix: restore status", "refactor: simplify tree", "docs: explain setup", "chore: update CI"]) {
    assert.equal(subjectProblem(subject, "feat/overview"), null, subject);
  }
  assert.equal(subjectProblem("Release 0.1.12", "release/0.1.12"), null);
  assert.equal(subjectProblem("docs: update changelog", "release/0.1.12"), null);
  for (const [subject, branch] of [
    ["", "fix/a"], ["Fix status", "fix/a"], ["fix: ", "fix/a"], ["fix: restore status.", "fix/a"],
    ["fix: restore status ", "fix/a"], ["fix(ui): restore status", "fix/a"], ["test: cover status", "fix/a"],
    ["Update changelog", "release/0.1.12"], ["Release 0.1.13", "release/0.1.12"], ["Release 0.1.12", "fix/a"],
  ]) {
    assert.ok(subjectProblem(subject, branch), subject);
  }
});

test("pullRequestProblems validates the PR title against the head branch", () => {
  assert.deepEqual(pullRequestProblems("chore/split-ci", "chore: split CI jobs"), []);
  assert.deepEqual(pullRequestProblems("release/1.2.3", "Release 1.2.3"), []);
  assert.notDeepEqual(pullRequestProblems("release/1.2.3", "docs: clarify notes"), []);
  assert.equal(pullRequestProblems("chore/split-ci", "Split CI jobs.").length, 1);
  assert.equal(pullRequestProblems("Split_CI", "chore: split CI jobs").length, 1);
});

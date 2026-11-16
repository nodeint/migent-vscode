import { test } from "node:test";
import assert from "node:assert/strict";
import { branchProblem, commitProblem, pushProblems, subjectProblem } from "./git-flow.mjs";

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
  assert.match(pushProblems(`${ref} abc ${ref} def`, ref, undefined, () => false)[0], /Force-push/);
  assert.deepEqual(pushProblems(`${ref} abc ${ref} def`, ref, undefined, () => true), []);
  assert.deepEqual(pushProblems(`${ref} abc ${ref} ${"0".repeat(40)}`, ref, undefined, () => false), []);
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

test("only a verified release tag can advance main", () => {
  const line = "refs/tags/v0.1.0 abc refs/heads/main def";
  let checked = false;
  assert.deepEqual(pushProblems(line, "refs/heads/release/0.1.0", (tag, local, remote) => {
    assert.deepEqual([tag, local, remote], ["refs/tags/v0.1.0", "abc", "def"]);
    checked = true;
  }), []);
  assert.equal(checked, true);
  assert.equal(pushProblems(line, "refs/heads/main", () => { throw new Error("Not published"); }).length, 1);
  assert.equal(pushProblems("refs/tags/v0.1.0 abc refs/heads/next def", "refs/heads/main", () => {}).length, 1);
});

test("branch names follow the work types or release/X.Y.Z", () => {
  for (const branch of ["feat/session-tree", "fix/status", "refactor/store", "docs/contributing", "chore/require-cli-0.6.0", "release/0.1.12"]) {
    assert.equal(branchProblem(branch), null);
  }
  for (const branch of ["results-header-ui", "feature/x", "fix/Status", "fix/", "fix/a--b", "release/0.1", "release/01.0.0"]) {
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { commitProblem, pushProblems } from "./git-flow.mjs";

test("commits require a working branch", () => {
  for (const branch of ["", "main", "next"]) assert.ok(commitProblem(branch));
  for (const branch of ["fix/status", "docs/contributing", "release/0.1.0"]) assert.equal(commitProblem(branch), null);
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
    assert.equal(pushProblems(`${source} abc refs/heads/other def`, ref).length, 1);
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

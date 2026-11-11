import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const workflow = name => parse(readFileSync(path.join(import.meta.dirname, "..", ".github", "workflows", name), "utf8"));

test("release workflow parses and covers merge, tag, and manual retry entries", () => {
  const release = workflow("release.yml");
  assert.deepEqual(Object.keys(release.on).sort(), ["pull_request", "push", "workflow_dispatch"]);
  assert.deepEqual(release.on.pull_request.types, ["closed"]);
  assert.deepEqual(release.on.push.tags, ["v*"]);
  assert.deepEqual(release.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(release.jobs.release.environment, "release");
  assert.deepEqual(Object.keys(release.jobs.release.permissions).sort(), ["contents", "id-token"]);
  const names = release.jobs.release.steps.flatMap(step => step.name ?? []);
  for (const name of ["Create release tag", "Advance main", "Verify main advanced"]) {
    assert.ok(names.includes(name), `Missing release step: ${name}`);
  }
});

test("CI workflow parses", () => {
  const ci = workflow("ci.yml");
  assert.deepEqual(ci.on.push.branches, ["next"]);
  assert.deepEqual(ci.jobs.test.strategy.matrix.os, ["macos-latest", "windows-latest"]);
});

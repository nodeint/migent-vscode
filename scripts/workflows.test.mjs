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
  const { plan, github, publish } = release.jobs;
  assert.deepEqual(plan.outputs && Object.keys(plan.outputs).sort(), ["sha", "tag", "version"]);
  assert.equal(github.environment, "release");
  assert.deepEqual(github.permissions, { contents: "write" });
  assert.equal(publish.environment, "release");
  assert.deepEqual(publish.permissions, { contents: "read", "id-token": "write" });
  const steps = job => job.steps.flatMap(step => step.name ?? []);
  for (const name of ["Create release tag", "Advance main", "Create GitHub Release"]) {
    assert.ok(steps(github).includes(name), `Missing github step: ${name}`);
  }
  for (const name of ["Download release VSIX", "Verify main advanced", "Publish to VS Code Marketplace", "Publish to Open VSX"]) {
    assert.ok(steps(publish).includes(name), `Missing publish step: ${name}`);
  }
});

test("CI workflow parses", () => {
  const ci = workflow("ci.yml");
  assert.deepEqual(Object.keys(ci.on), ["pull_request"]);
  assert.deepEqual(ci.on.pull_request.branches, ["next"]);
  assert.deepEqual(ci.jobs.test.strategy.matrix.os, ["macos-latest", "windows-latest"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  mergeReleasePlan,
  newestStableTag,
  releaseNotes,
  taggedReleasePlan,
} from "./release.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const manifest = { name: "migent-vscode", publisher: "nodeint", version: "0.1.0" };
test("release notes contain only the exact version section, preserving subheadings", () => {
  const notes = "# Changelog\r\n\r\n## Unreleased\r\n\r\n## 0.1.0\r\n\r\n### Added\r\n- Monitoring.\r\n\r\n## 0.0.1\r\n- Scaffold.\r\n";
  assert.equal(releaseNotes("v0.1.0", manifest, notes), "### Added\n- Monitoring.\n");
});
test("invalid releases fail closed", () => {
  for (const tag of ["main", "v0.1.0-beta.1", "v00.1.0", "v0.2.0"]) {
    assert.throws(() => releaseNotes(tag, manifest, "## 0.1.0\n- Monitoring."));
  }
  for (const notes of ["# Changelog", "## 0.1.0\n", "## 0.1.0\n### Added\n", "## 0.1.0\n- One\n## 0.1.0\n- Two"]) {
    assert.throws(() => releaseNotes("v0.1.0", manifest, notes));
  }
  assert.throws(() => releaseNotes("v0.1.0", { ...manifest, publisher: "other" }, "## 0.1.0\n- Monitoring."));
});

test("only stable tags take part in version ordering", () => {
  assert.equal(newestStableTag(["v0.1.0-beta.1", "v0.10.0", "v0.9.9", "nightly"]), "v0.10.0");
  assert.equal(newestStableTag(["v0.1.0-beta.1", "nightly"]), null);
  assert.equal(compareVersions("v0.10.0", "v0.9.9"), 1);
  assert.equal(compareVersions("v0.1.0", "v0.1.0"), 0);
  assert.equal(compareVersions("v0.1.0", "v0.1.1"), -1);
});

test("a merged release must be newer, untagged, and on next", () => {
  const changelog = "# Changelog\n\n## Unreleased\n\n## 0.2.0\n- Editor.\n\n## 0.1.0\n- Monitoring.\n";
  const next = { ...manifest, version: "0.2.0" };
  const plan = mergeReleasePlan({
    manifest: next,
    changelog,
    tags: ["v0.1.0"],
    tagSha: null,
    sha: "abc",
    onNext: true,
  });
  assert.deepEqual(plan, { tag: "v0.2.0", version: "0.2.0", sha: "abc", notes: "- Editor.\n" });

  const attempt = overrides => () => mergeReleasePlan({
    manifest: next,
    changelog,
    tags: ["v0.1.0"],
    tagSha: null,
    sha: "abc",
    onNext: true,
    ...overrides,
  });
  assert.throws(attempt({ tagSha: "def" }), /already exists/);
  assert.throws(attempt({ tags: ["v0.2.0"] }), /must be newer/);
  assert.throws(attempt({ tags: ["v0.3.0"] }), /must be newer/);
  assert.throws(attempt({ onNext: false }), /origin\/next/);
});

test("a tagged release must be checked out at the tag", () => {
  const plan = taggedReleasePlan({
    tag: "v0.1.0",
    sha: "abc",
    tagSha: "abc",
    manifest,
    changelog: "## 0.1.0\n- Monitoring.",
    onNext: true,
  });
  assert.equal(plan.tag, "v0.1.0");
  assert.throws(() => taggedReleasePlan({
    tag: "v0.1.0",
    sha: "abc",
    tagSha: "def",
    manifest,
    changelog: "## 0.1.0\n- Monitoring.",
    onNext: true,
  }), /does not match/);
});

function temporaryRepository(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "migent-release-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release-test@example.invalid");
  git("-c", "core.hooksPath=", "commit", "--allow-empty", "-m", "Baseline");
  return { directory, git, baseline: git("rev-parse", "HEAD") };
}

function commitRelease(git, directory, version) {
  writeFileSync(path.join(directory, "package.json"), JSON.stringify({ ...manifest, version }));
  writeFileSync(path.join(directory, "CHANGELOG.md"), `# Changelog\n\n## ${version}\n- Monitoring.\n`);
  git("add", "package.json", "CHANGELOG.md");
  git("-c", "core.hooksPath=", "commit", "-m", `Release ${version}`);
  return git("rev-parse", "HEAD");
}

test("release command accepts a tagged commit on next and rejects an unmerged tag", t => {
  const { directory, git, baseline } = temporaryRepository(t);
  commitRelease(git, directory, "0.1.0");
  git("tag", "v0.1.0");
  git("update-ref", "refs/remotes/origin/next", "HEAD");
  const invoke = () => spawnSync(process.execPath, [path.join(import.meta.dirname, "release.mjs")], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.1.0" },
  });
  const valid = invoke();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(readFileSync(path.join(directory, "release-notes.md"), "utf8"), /- Monitoring\./);
  git("update-ref", "refs/remotes/origin/next", baseline);
  assert.notEqual(invoke().status, 0);
});

test("merge mode plans the tag for a merged release commit and rejects reuse", t => {
  const { directory, git } = temporaryRepository(t);
  const sha = commitRelease(git, directory, "0.2.0");
  git("tag", "v0.1.0");
  git("update-ref", "refs/remotes/origin/next", sha);
  const output = path.join(directory, "github-output.txt");
  writeFileSync(output, "");
  const invoke = () => spawnSync(process.execPath, [path.join(import.meta.dirname, "release.mjs"), "--from-merge"], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GITHUB_OUTPUT: output },
  });
  const valid = invoke();
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(readFileSync(output, "utf8"), /^tag=v0\.2\.0$/m);
  assert.match(readFileSync(output, "utf8"), new RegExp(`^sha=${sha}$`, "m"));
  git("tag", "v0.2.0");
  assert.notEqual(invoke().status, 0);
});

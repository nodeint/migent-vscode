import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseNotes } from "./release.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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

test("release command accepts a tagged commit on next and rejects an unmerged tag", t => {
  const directory = mkdtempSync(path.join(tmpdir(), "migent-release-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "Release test");
  git("config", "user.email", "release-test@example.invalid");
  git("-c", "core.hooksPath=", "commit", "--allow-empty", "-m", "Baseline");
  const baseline = git("rev-parse", "HEAD");
  writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
  writeFileSync(path.join(directory, "CHANGELOG.md"), "# Changelog\n\n## 0.1.0\n- Monitoring.\n");
  git("add", "package.json", "CHANGELOG.md");
  git("-c", "core.hooksPath=", "commit", "-m", "Release 0.1.0");
  git("tag", "v0.1.0");
  git("update-ref", "refs/remotes/origin/next", "HEAD");
  const invoke = () => spawnSync(process.execPath, [path.join(import.meta.dirname, "release.mjs")], {
    cwd: directory,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_TYPE: "tag", GITHUB_REF_NAME: "v0.1.0" },
  });
  const valid = invoke();
  assert.equal(valid.status, 0, valid.stderr);
  git("update-ref", "refs/remotes/origin/next", baseline);
  assert.notEqual(invoke().status, 0);
});

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseNotes } from "./release.mjs";

export function commitProblem(branch) {
  return !branch || branch === "main" || branch === "next"
    ? "Commit on a working branch and open a pull request into next."
    : null;
}

export function pushProblems(input, currentRef, verifyRelease) {
  const problems = [];
  for (const line of input.trim().split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [source, localSha, target, remoteSha] = line.trim().split(/\s+/);
    if (target === "refs/heads/main" || target === "refs/heads/next") {
      if (target === "refs/heads/main" && /^refs\/tags\/v\d+\.\d+\.\d+$/.test(source) && verifyRelease) {
        try { verifyRelease(source, localSha, remoteSha); } catch (error) { problems.push(`Release synchronization blocked: ${error.message}`); }
        continue;
      }
      problems.push(`Direct pushes to ${target.slice("refs/heads/".length)} are blocked. Open a pull request into next.`);
    } else if (target?.startsWith("refs/heads/") && source !== "(delete)") {
      const resolved = source === "HEAD" ? currentRef : source;
      if (resolved !== target) problems.push(`Branch destination mismatch: ${source} -> ${target}. Push to the same branch name.`);
    }
  }
  return problems;
}

export function verifyPublishedRelease(tag, localSha, remoteSha, remote, url) {
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000 });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `${command} failed`);
    return result.stdout.trim();
  };
  const git = (...args) => run("git", args);
  if (remote !== "origin" || url !== git("remote", "get-url", "--push", "origin")) throw new Error("Use the configured origin remote.");
  if (git("status", "--porcelain")) throw new Error("Working tree must be clean.");
  const sha = git("rev-parse", `${tag}^{commit}`);
  if (sha !== localSha) throw new Error("Use a lightweight release tag.");
  const refs = git("ls-remote", "origin", "refs/heads/main", "refs/heads/next", tag);
  const advertised = new Map(refs.split("\n").map(line => { const [hash, ref] = line.split(/\s+/); return [ref, hash]; }));
  if (advertised.get(tag) !== sha || advertised.get("refs/heads/main") !== remoteSha) throw new Error("Remote release tag or main changed.");
  git("fetch", "origin", "main", "next");
  if (git("rev-parse", "origin/main") !== remoteSha || git("rev-parse", "origin/next") !== advertised.get("refs/heads/next")) throw new Error("Remote branches changed; retry.");
  git("merge-base", "--is-ancestor", remoteSha, sha);
  git("merge-base", "--is-ancestor", sha, "origin/next");
  const version = tag.slice("refs/tags/v".length);
  const manifest = JSON.parse(git("show", `${sha}:package.json`));
  releaseNotes(`v${version}`, manifest, git("show", `${sha}:CHANGELOG.md`));
  const runs = JSON.parse(run("gh", ["run", "list", "--repo", "nodeint/migent-vscode", "--workflow", "release.yml", "--branch", `v${version}`, "--json", "headSha,conclusion"]));
  if (!runs.some(item => item.headSha === sha && item.conclusion === "success")) throw new Error("No successful release workflow for this tag and commit.");
  run(process.execPath, [path.join(import.meta.dirname, "verify-publication.mjs"), version]);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const head = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf8" });
  if (head.error || (head.status !== 0 && head.status !== 1)) throw new Error(head.stderr || "Cannot read HEAD.");
  const branch = head.stdout.trim();
  const problems = process.argv[2] === "pre-push"
    ? pushProblems(readFileSync(0, "utf8"), `refs/heads/${branch}`, (tag, localSha, remoteSha) => verifyPublishedRelease(tag, localSha, remoteSha, process.argv[3], process.argv[4]))
    : [commitProblem(branch)].filter(Boolean);
  for (const problem of problems) process.stderr.write(`migent-vscode: ${problem}\n`);
  process.exitCode = problems.length ? 1 : 0;
}

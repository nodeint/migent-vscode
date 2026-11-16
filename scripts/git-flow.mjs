import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { releaseNotes } from "./release.mjs";

const workBranch = /^(feat|fix|refactor|docs|chore)\/[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const releaseBranch = /^release\/(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const workSubject = /^(feat|fix|refactor|docs|chore): [^\s.](?:[^\r\n]*[^\s.])?$/;

export function branchProblem(branch) {
  return workBranch.test(branch) || releaseBranch.test(branch)
    ? null
    : `Branch ${branch} must be <type>/<slug> (feat, fix, refactor, docs, chore) or release/X.Y.Z; see CONTRIBUTING.md.`;
}

export function subjectProblem(subject, branch) {
  if (releaseBranch.test(branch) && subject === `Release ${branch.slice("release/".length)}`) return null;
  return workSubject.test(subject)
    ? null
    : "Use <type>: <imperative summary> without a final period; release subjects must match release/X.Y.Z. See CONTRIBUTING.md.";
}

export function commitProblem(branch, upstream = "") {
  if (!branch || branch === "main" || branch === "next") return "Commit on a working branch and open a pull request into next.";
  if (upstream && upstream !== `origin/${branch}`) {
    return `Upstream ${upstream} must be origin/${branch} or unset. Run git branch --unset-upstream or pnpm setup:git.`;
  }
  return branchProblem(branch);
}

const zeroSha = /^0+$/;

export function pushProblems(input, currentRef, verifyRelease, isAncestor = () => true) {
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
      const problem = branchProblem(target.slice("refs/heads/".length));
      if (problem) problems.push(problem);
      if (remoteSha && !zeroSha.test(remoteSha) && !isAncestor(remoteSha, localSha)) {
        problems.push(`Force-push to ${target.slice("refs/heads/".length)} is blocked. Fetch and integrate the remote branch first.`);
      }
    }
  }
  return problems;
}

export function verifyReleaseSync(tag, localSha, remoteSha, remote, url) {
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
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const head = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { encoding: "utf8" });
  if (head.error || (head.status !== 0 && head.status !== 1)) throw new Error(head.stderr || "Cannot read HEAD.");
  const branch = head.stdout.trim();
  const isAncestor = (ancestor, descendant) =>
    spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], { stdio: "ignore" }).status === 0;
  const upstream = branch && process.argv[2] !== "pre-push"
    ? spawnSync("git", ["for-each-ref", "--format=%(upstream:short)", `refs/heads/${branch}`], { encoding: "utf8" }).stdout.trim()
    : "";
  const problems = process.argv[2] === "pre-push"
    ? pushProblems(readFileSync(0, "utf8"), `refs/heads/${branch}`, (tag, localSha, remoteSha) => verifyReleaseSync(tag, localSha, remoteSha, process.argv[3], process.argv[4]), isAncestor)
    : process.argv[2] === "commit-msg"
      ? [commitProblem(branch, upstream), subjectProblem(readFileSync(process.argv[3], "utf8").split(/\r?\n/)[0], branch)].filter(Boolean)
      : [commitProblem(branch, upstream)].filter(Boolean);
  for (const problem of problems) process.stderr.write(`migent-vscode: ${problem}\n`);
  process.exitCode = problems.length ? 1 : 0;
}

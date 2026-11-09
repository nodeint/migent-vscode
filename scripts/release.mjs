import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function releaseNotes(tag, manifest, changelog) {
  if (!STABLE_TAG.test(tag)) {
    throw new Error("Expected a stable release tag vX.Y.Z.");
  }
  const version = tag.slice(1);
  if (manifest.version !== version) throw new Error("Tag and package.json version differ.");
  if (manifest.publisher !== "nodeint" || manifest.name !== "migent-vscode") {
    throw new Error("Unexpected extension identity.");
  }
  const lines = changelog.replace(/\r\n/g, "\n").split("\n");
  const headings = lines.flatMap((line, index) => line === `## ${version}` ? [index] : []);
  if (headings.length !== 1) throw new Error("Expected exactly one changelog heading for this version.");
  const start = headings[0] + 1;
  const end = lines.findIndex((line, index) => index >= start && /^## /.test(line));
  const notes = lines.slice(start, end === -1 ? undefined : end).join("\n").trim();
  if (!notes || !notes.split("\n").some(line => line.trim() && !line.startsWith("#"))) {
    throw new Error("Release notes are empty.");
  }
  return `${notes}\n`;
}

export function compareVersions(left, right) {
  const parse = tag => {
    const match = STABLE_TAG.exec(tag);
    if (!match) throw new Error(`Expected a stable release tag vX.Y.Z, got ${tag}.`);
    return match.slice(1).map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function newestStableTag(tags) {
  return tags.filter(tag => STABLE_TAG.test(tag)).sort(compareVersions).at(-1) ?? null;
}

export function mergeReleasePlan({ manifest, changelog, tags, tagSha, sha, onNext }) {
  const tag = `v${manifest.version}`;
  const notes = releaseNotes(tag, manifest, changelog);
  if (!onNext) throw new Error(`${sha} is not on origin/next.`);
  if (tagSha) throw new Error(`Tag ${tag} already exists; dispatch release.yml for that tag to retry publication.`);
  const newest = newestStableTag(tags);
  if (newest && compareVersions(tag, newest) <= 0) {
    throw new Error(`${tag} must be newer than the latest release tag ${newest}.`);
  }
  return { tag, version: manifest.version, sha, notes };
}

export function taggedReleasePlan({ tag, sha, tagSha, manifest, changelog, onNext }) {
  const notes = releaseNotes(tag, manifest, changelog);
  if (!onNext) throw new Error(`${sha} is not on origin/next.`);
  if (tagSha !== sha) throw new Error("Checkout does not match release tag.");
  return { tag, version: manifest.version, sha, notes };
}

function createGit(directory) {
  return (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
}

function isAncestor(git, ancestor, descendant) {
  try {
    git("merge-base", "--is-ancestor", ancestor, descendant);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

function readTag(git, tag) {
  try {
    return git("rev-parse", "--verify", `${tag}^{commit}`);
  } catch {
    return null;
  }
}

export function releasePlan({ mode, git, manifest, changelog, tag }) {
  const sha = git("rev-parse", "HEAD");
  const onNext = isAncestor(git, sha, "origin/next");
  if (mode === "merge") {
    const tagName = `v${manifest.version}`;
    return mergeReleasePlan({
      manifest,
      changelog,
      tags: git("tag", "--list", "v*").split("\n").filter(Boolean),
      tagSha: readTag(git, tagName),
      sha,
      onNext,
    });
  }
  if (!tag) throw new Error("Release must run from a tag.");
  return taggedReleasePlan({ tag, sha, tagSha: readTag(git, tag), manifest, changelog, onNext });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv.includes("--from-merge") ? "merge" : "tag";
  if (mode === "tag" && process.env.GITHUB_REF_TYPE !== "tag") throw new Error("Release must run from a tag.");
  const plan = releasePlan({
    mode,
    git: createGit(process.cwd()),
    manifest: JSON.parse(readFileSync("package.json", "utf8")),
    changelog: readFileSync("CHANGELOG.md", "utf8"),
    tag: process.env.GITHUB_REF_NAME,
  });
  writeFileSync("release-notes.md", plan.notes);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${plan.tag}\nversion=${plan.version}\nsha=${plan.sha}\n`);
  }
  console.log(`Validated ${plan.tag} at ${plan.sha} on origin/next.`);
}

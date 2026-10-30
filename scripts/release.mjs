import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function releaseNotes(tag, manifest, changelog) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
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

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const tag = process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_REF_TYPE !== "tag") throw new Error("Release must run from a tag.");
  const notes = releaseNotes(tag, JSON.parse(readFileSync("package.json", "utf8")), readFileSync("CHANGELOG.md", "utf8"));
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const sha = git("rev-parse", "HEAD");
  if (git("rev-parse", `${tag}^{commit}`) !== sha) throw new Error("Checkout does not match release tag.");
  git("merge-base", "--is-ancestor", sha, "origin/next");
  writeFileSync("release-notes.md", notes);
  console.log(`Validated ${tag} at ${sha} on origin/next.`);
}

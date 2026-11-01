import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  sourcemap: true,
};

if (process.argv.includes("--integration")) {
  await build({
    ...common,
    entryPoints: ["src/integration/index.ts"],
    outfile: "dist-test/integration/index.js",
  });
} else {
  await build({
    ...common,
    entryPoints: ["src/extension.ts"],
    outfile: "dist/extension.js",
    minify: process.argv.includes("--production"),
  });
}

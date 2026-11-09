import path from "node:path";
import { pathToFileURL } from "node:url";

export async function verifyPublication(version, request = fetch) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw new Error("Expected a stable version X.Y.Z.");
  const marketplace = await request("https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json;api-version=7.2-preview.1" },
    body: JSON.stringify({ filters: [{ criteria: [{ filterType: 7, value: "nodeint.migent-vscode" }] }], flags: 1 }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!marketplace.ok) throw new Error(`Marketplace request failed: ${marketplace.status}`);
  const gallery = await marketplace.json();
  const extension = gallery.results?.[0]?.extensions?.find(item => item.extensionName === "migent-vscode" && item.publisher?.publisherName === "nodeint");
  if (!extension?.versions?.some(item => item.version === version)) throw new Error(`Marketplace does not expose ${version}.`);
  const openvsx = await request(`https://open-vsx.org/api/nodeint/migent-vscode/${version}`, { signal: AbortSignal.timeout(30_000) });
  if (!openvsx.ok) throw new Error(`Open VSX request failed: ${openvsx.status}`);
  const metadata = await openvsx.json();
  if (metadata.namespace !== "nodeint" || metadata.name !== "migent-vscode" || metadata.version !== version) throw new Error(`Open VSX does not expose ${version}.`);
}

export async function waitForPublication(version, {
  request = fetch,
  attempts = 20,
  delayMs = 15_000,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("Expected at least one publication attempt.");
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await verifyPublication(version, request);
      return attempt;
    } catch (error) {
      failure = error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw new Error(`${failure.message} Gave up after ${attempts} attempts.`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const attempts = Number(process.env.PUBLICATION_ATTEMPTS ?? 20);
  const delayMs = Number(process.env.PUBLICATION_DELAY_MS ?? 15_000);
  const attempt = await waitForPublication(process.argv[2], { attempts, delayMs });
  console.log(`Both registries expose nodeint.migent-vscode ${process.argv[2]} (attempt ${attempt}).`);
}

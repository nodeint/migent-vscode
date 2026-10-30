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

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await verifyPublication(process.argv[2]);
  console.log(`Both registries expose nodeint.migent-vscode ${process.argv[2]}.`);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyPublication, waitForPublication } from "./verify-publication.mjs";

const gallery = { results: [{ extensions: [{ extensionName: "migent-vscode", publisher: { publisherName: "nodeint" }, versions: [{ version: "0.1.0" }] }] }] };
const openvsx = { namespace: "nodeint", name: "migent-vscode", version: "0.1.0" };
const response = body => ({ ok: true, json: async () => body });
test("requires the exact version from both public registries", async () => {
  const calls = [];
  await verifyPublication("0.1.0", async (url, options) => {
    calls.push(url);
    if (url.includes("marketplace")) {
      assert.equal(JSON.parse(options.body).filters[0].criteria[0].value, "nodeint.migent-vscode");
      return response(gallery);
    }
    return response(openvsx);
  });
  assert.equal(calls.length, 2);
});
test("publication checks retry until both registries expose the version", async () => {
  let marketplaceCalls = 0;
  const attempt = await waitForPublication("0.1.0", {
    attempts: 3,
    sleep: async () => {},
    request: async url => {
      if (url.includes("marketplace")) {
        marketplaceCalls += 1;
        return response(marketplaceCalls < 3 ? { results: [] } : gallery);
      }
      return response(openvsx);
    },
  });
  assert.equal(attempt, 3);
  await assert.rejects(waitForPublication("0.1.0", {
    attempts: 2,
    sleep: async () => {},
    request: async () => response({ results: [] }),
  }), /Gave up after 2 attempts/);
});
test("missing versions, mismatched identity, and registry failures block synchronization", async () => {
  await assert.rejects(verifyPublication("0.2.0", async () => response(gallery)));
  await assert.rejects(verifyPublication("0.1.0", async url => response(url.includes("marketplace") ? gallery : { ...openvsx, namespace: "other" })));
  await assert.rejects(verifyPublication("0.1.0", async () => ({ ok: false, status: 503 })));
  await assert.rejects(verifyPublication("bad", async () => { throw new Error("Should not fetch"); }));
});

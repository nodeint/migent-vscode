import path from "node:path";
import { describe, expect, it } from "vitest";
import { sessionDir } from "./paths";

describe("paths", () => {
  it("resolves a session directory under .migent/sessions", () => {
    expect(sessionDir("/p", "s1")).toBe(path.join("/p", ".migent", "sessions", "s1"));
  });
});

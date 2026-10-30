import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { listWorkflows } from "./workflows";
import { makeProject } from "./testHelpers";

describe("listWorkflows", () => {
  it("lists workflow ids and stage ids, sorted by id", () => {
    const rows = listWorkflows(makeProject());
    expect(rows.map((row) => row.id)).toEqual(["implement", "plan"]);
    const plan = rows.find((row) => row.id === "plan");
    expect(plan?.file).toBe("plan.yaml");
    expect(plan?.title).toBe("Plan");
    expect(plan?.stages).toEqual(["plan", "review_plan"]);
    const implement = rows.find((row) => row.id === "implement");
    expect(implement?.stages).toEqual(["prepare", "implement", "review_work"]);
  });

  it("returns [] when there is no workflows directory", () => {
    expect(listWorkflows(path.join(os.tmpdir(), "no-such-project"))).toEqual([]);
  });
});


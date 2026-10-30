import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { workflowsDir } from "./paths";

export interface WorkflowSummary {
  /** Workflow id from the file body, else the file name without extension. */
  id: string;
  file: string;
  title: string | null;
  /** Stage ids in declaration order, for display. */
  stages: string[];
}

function stageIds(parsed: unknown): string[] {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const stages = (parsed as Record<string, unknown>).stages;
  if (!Array.isArray(stages)) return [];
  const ids: string[] = [];
  for (const stage of stages) {
    if (stage === null || typeof stage !== "object" || Array.isArray(stage)) continue;
    const id = (stage as Record<string, unknown>).id;
    if (typeof id === "string" && id !== "") ids.push(id);
  }
  return ids;
}

/** List `.migent/workflows/*.yaml`. A file that fails to parse is skipped, not guessed. */
export function listWorkflows(projectRoot: string): WorkflowSummary[] {
  let entries;
  try {
    entries = readdirSync(workflowsDir(projectRoot), { withFileTypes: true });
  } catch {
    return [];
  }
  const rows: WorkflowSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".yaml") && !entry.name.endsWith(".yml")) continue;
    const file = path.join(workflowsDir(projectRoot), entry.name);
    let parsed: unknown = null;
    try {
      parsed = parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const body = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
    const id = typeof body?.id === "string" && body.id !== "" ? body.id : path.basename(entry.name, path.extname(entry.name));
    const title = typeof body?.title === "string" && body.title !== "" ? body.title : null;
    rows.push({ id, file: entry.name, title, stages: stageIds(parsed) });
  }
  rows.sort((left, right) => left.id.localeCompare(right.id));
  return rows;
}

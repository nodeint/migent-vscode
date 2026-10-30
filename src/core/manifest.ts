import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { SessionManifest } from "./model";
import { SUPPORTED_MANIFEST_SCHEMA_VERSIONS } from "./model";

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * Parse `manifest.yaml` text. A manifest that does not parse is schema poison:
 * the caller treats the session as Unknown and never guesses.
 */
export function parseManifest(text: string): SessionManifest | null {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  const schemaVersion =
    typeof raw.schema_version === "number" && Number.isInteger(raw.schema_version)
      ? raw.schema_version
      : null;
  return {
    sessionId: asString(raw.session_id),
    title: asString(raw.title),
    workflowId: asString(raw.workflow_id),
    workflowPath: asString(raw.workflow_path),
    createdAt: asString(raw.created_at),
    priorSessionId: asString(raw.prior_session_id),
    role: asString(raw.role),
    schemaVersion,
    schemaSupported: schemaVersion === null || SUPPORTED_MANIFEST_SCHEMA_VERSIONS.includes(schemaVersion),
    raw,
  };
}

/** Read and parse manifest.yaml. Null when missing or unparsable. */
export function readManifest(manifestPath: string): SessionManifest | null {
  let text: string;
  try {
    text = readFileSync(manifestPath, "utf8");
  } catch {
    return null;
  }
  return parseManifest(text);
}

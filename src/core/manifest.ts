import { readFileSync } from 'node:fs';

import type { SessionManifest } from '@nodeint/migent-contracts';
import { parse } from 'yaml';

import { isRecord } from './record';

/** Manifest `schema_version` values this extension understands (v1 carries none or `1`, v2 carries `2`). */
export const CURRENT_MANIFEST_SCHEMA_VERSION = 2;
export const SUPPORTED_MANIFEST_SCHEMA_VERSIONS: readonly number[] = [1, CURRENT_MANIFEST_SCHEMA_VERSION];

/**
 * Result of reading `manifest.yaml`. `unsupported` is a manifest that declares a `schema_version` this extension does
 * not know (the contract describes only 1 and 2); `invalid` is a missing file, unparsable YAML, or a mapping that
 * matches neither contract member.
 */
export type ManifestRead =
  | { kind: 'ok'; manifest: SessionManifest }
  | { kind: 'unsupported'; schemaVersion: number }
  | { kind: 'invalid' };

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A session id the CLI may write quoted or as an unquoted non-negative integer; always returned as a string. */
export function asSessionId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return asString(value) ?? null;
}

/** The optional contract fields shared by both members that this reader forwards. */
function optionalStrings(raw: Record<string, unknown>, names: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = asString(raw[name]);
    if (value !== undefined) result[name] = value;
  }
  return result;
}

function readV2(raw: Record<string, unknown>): SessionManifest | null {
  const sessionId = asSessionId(raw.session_id);
  const createdAt = asString(raw.created_at);
  const workflowId = asString(raw.workflow_id);
  const isIncomplete = sessionId === null || createdAt === undefined || workflowId === undefined;
  if (raw.schema_version !== CURRENT_MANIFEST_SCHEMA_VERSION || isIncomplete) return null;
  const priorSessionId = asSessionId(raw.prior_session_id);
  return {
    session_id: sessionId,
    created_at: createdAt,
    schema_version: 2,
    workflow_id: workflowId,
    ...optionalStrings(raw, ['title', 'workflow_path', 'task', 'role']),
    ...(priorSessionId === null ? {} : { prior_session_id: priorSessionId }),
    ...(isRecord(raw.handoff) ? { handoff: raw.handoff } : {}),
  };
}

function readLegacy(raw: Record<string, unknown>): SessionManifest | null {
  const sessionId = asSessionId(raw.session_id);
  const createdAt = asString(raw.created_at);
  const status = asString(raw.status);
  if (sessionId === null || createdAt === undefined || status === undefined) return null;
  if (raw.schema_version !== undefined && raw.schema_version !== 1) return null;
  return {
    session_id: sessionId,
    created_at: createdAt,
    status,
    ...(raw.schema_version === 1 ? { schema_version: 1 as const } : {}),
    ...optionalStrings(raw, ['title', 'workflow_id']),
  };
}

/** Parse `manifest.yaml` text. A manifest the contract does not describe is never guessed at. */
export function parseManifest(text: string): ManifestRead {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch {
    return { kind: 'invalid' };
  }
  if (!isRecord(parsed)) return { kind: 'invalid' };
  const version = parsed.schema_version;
  if (typeof version === 'number' && Number.isInteger(version) && !SUPPORTED_MANIFEST_SCHEMA_VERSIONS.includes(version)) {
    return { kind: 'unsupported', schemaVersion: version };
  }
  const manifest = readV2(parsed) ?? readLegacy(parsed);
  return manifest === null ? { kind: 'invalid' } : { kind: 'ok', manifest };
}

/** Read and parse manifest.yaml. `invalid` when missing or unparsable. */
export function readManifest(manifestPath: string): ManifestRead {
  let text: string;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch {
    return { kind: 'invalid' };
  }
  return parseManifest(text);
}

/** The manifest `role`; only the v2 member declares it. Null for a workflow session or a legacy manifest. */
export function manifestRole(manifest: SessionManifest | null | undefined): string | null {
  return manifest !== null && manifest !== undefined && 'role' in manifest ? (manifest.role ?? null) : null;
}

/** The manifest `prior_session_id`; only the v2 member declares it. */
export function manifestPriorSessionId(manifest: SessionManifest | null | undefined): string | null {
  return manifest !== null && manifest !== undefined && 'prior_session_id' in manifest ? (manifest.prior_session_id ?? null) : null;
}

/** The manifest `handoff` mapping; only the v2 member declares it. */
export function manifestHandoff(manifest: SessionManifest | null | undefined): Record<string, unknown> | null {
  return manifest !== null && manifest !== undefined && 'handoff' in manifest ? (manifest.handoff ?? null) : null;
}

/** What a snapshot keeps of a manifest read: the contract value, the unsupported version, and the display input. */
export function manifestFacts(read: ManifestRead): {
  manifest: SessionManifest | null;
  unsupportedManifestVersion: number | null;
  state: 'ok' | 'invalid' | 'unsupported';
} {
  if (read.kind === 'ok') return { manifest: read.manifest, unsupportedManifestVersion: null, state: 'ok' };
  if (read.kind === 'unsupported') return { manifest: null, unsupportedManifestVersion: read.schemaVersion, state: 'unsupported' };
  return { manifest: null, unsupportedManifestVersion: null, state: 'invalid' };
}

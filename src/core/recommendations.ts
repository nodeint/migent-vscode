import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { SessionRecommendation } from '@nodeint/migent-contracts';

import { text as describe } from '../text';
import { type Declared, declaredOf } from './contractRead';
import { RECOMMENDATIONS_RELATIVE_PATH } from './paths';
import { isRecord } from './record';

/** `plugins/next/recommendations.json` schema versions this extension reads. */
export const SUPPORTED_RECOMMENDATIONS_SCHEMA_VERSIONS: readonly number[] = [1];

/** One entry as the contract declares it. Every value is inert text; nothing here is ever run. */
export type RecommendationEntry = Pick<SessionRecommendation, 'stage_id' | 'execution_id' | 'workflow' | 'reason'> & {
  warning: string | null;
};

export type RecommendationsRead =
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string }
  | { kind: 'unsupported'; schemaVersion: number | null }
  | { kind: 'ok'; entries: RecommendationEntry[] };

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
}

function entryOf(value: unknown): RecommendationEntry | null {
  const wire: Declared<SessionRecommendation> | null = declaredOf<SessionRecommendation>(value);
  if (wire === null) return null;
  const { stage_id: stageId, execution_id: executionId, workflow, reason, warning } = wire;
  if (typeof stageId !== 'string' || typeof executionId !== 'string' || typeof reason !== 'string') return null;
  if (workflow !== null && typeof workflow !== 'string') return null;
  return {
    stage_id: stageId,
    execution_id: executionId,
    workflow,
    reason,
    warning: typeof warning === 'string' && warning !== '' ? warning : null,
  };
}

/**
 * Read `plugins/next/recommendations.json` of one session on demand. An unusable file never affects session state.
 * An entry missing a required field is skipped; a missing `recommendations` list keeps the `invalid` result. The
 * freeze is not consulted: the file exists only when the next plugin ran.
 */
export function readRecommendations(sessionDirPath: string): RecommendationsRead {
  let text: string;
  try {
    text = readFileSync(path.join(sessionDirPath, RECOMMENDATIONS_RELATIVE_PATH), 'utf8');
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' || code === 'ENOTDIR' ? { kind: 'missing' } : { kind: 'unreadable', error: code };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : describe('states.unparsableJson') };
  }
  if (!isRecord(value)) return { kind: 'invalid', error: describe('states.notJsonObject') };
  const version = value.schema_version;
  if (typeof version !== 'number' || !SUPPORTED_RECOMMENDATIONS_SCHEMA_VERSIONS.includes(version)) {
    return { kind: 'unsupported', schemaVersion: typeof version === 'number' ? version : null };
  }
  if (!Array.isArray(value.recommendations)) {
    return { kind: 'invalid', error: describe('states.recommendationsNotList') };
  }
  const entries: RecommendationEntry[] = [];
  for (const item of value.recommendations) {
    const entry = entryOf(item);
    if (entry !== null) entries.push(entry);
  }
  return { kind: 'ok', entries };
}

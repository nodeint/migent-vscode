import { readFileSync } from 'node:fs';

import { parse } from 'yaml';

import { configPath } from './paths';
import { isRecord } from './record';

export type ProjectConfigState = 'missing' | 'ok' | 'invalid' | 'unreadable';

export interface ProjectConfig {
  state: ProjectConfigState;
  /** Read or parse error text; null for `ok` and `missing`. */
  error: string | null;
  /** Raw `schema_version` when it is an integer; null when absent or not an integer. */
  schemaVersion: number | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/**
 * Read `.migent/config.yaml` for display only. No defaults are applied and nothing
 * is validated beyond "a YAML mapping"; the file is never created.
 */
export function readProjectConfig(projectRoot: string): ProjectConfig {
  let text: string;
  try {
    text = readFileSync(configPath(projectRoot), 'utf8');
  } catch (error) {
    const code = isRecord(error) ? error.code : undefined;
    if (code === 'ENOENT') return { state: 'missing', error: null, schemaVersion: null };
    return { state: 'unreadable', error: errorText(error), schemaVersion: null };
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return { state: 'invalid', error: errorText(error), schemaVersion: null };
  }
  if (!isRecord(parsed)) {
    return { state: 'invalid', error: 'config.yaml must be a YAML mapping', schemaVersion: null };
  }
  const version = parsed.schema_version;
  return {
    state: 'ok',
    error: null,
    schemaVersion: typeof version === 'number' && Number.isInteger(version) ? version : null,
  };
}

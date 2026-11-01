import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { FROZEN_WORKFLOW_FILENAME, NEXT_FILENAME, resolveWithin } from './paths';
import { isRecord } from './record';

/** `next.json` schema versions this extension reads. */
export const SUPPORTED_NEXT_SCHEMA_VERSIONS: readonly number[] = [1];

export type ArtifactAvailability = 'ok' | 'missing' | 'rejected';

export interface SuggestionArtifact {
  /** Input name in the target workflow. */
  name: string;
  /** Name of the source session's output that feeds it. */
  output: string;
  /** Session-relative path as written in `next.json`. */
  path: string;
  availability: ArtifactAvailability;
}

export interface NextSuggestion {
  workflow: string;
  task: string | null;
  artifacts: SuggestionArtifact[];
  /** Kept as data only. It is never a runnable action in this phase. */
  argv: string[];
  /** True when the frozen workflow declares a matching `downstream` entry; null when that was not read. */
  declared: boolean | null;
}

export type NextRead =
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string }
  | { kind: 'unsupported'; schemaVersion: number | null }
  | { kind: 'ok'; sourceSessionId: string | null; suggestions: NextSuggestion[] };

export interface DeclaredDownstream {
  workflow: string;
  task: string | null;
  /** Target input name → source output name. */
  artifacts: Record<string, string>;
}

/** The `downstream` declaration shape in `workflow.frozen.yaml` has not been captured; this reader is lenient. */
export type FrozenDownstreamRead =
  | { kind: 'absent' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string }
  | { kind: 'ok'; downstream: DeclaredDownstream[] };

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === 'string' ? error.code : 'unknown error';
}

function availability(sessionDirPath: string, relative: string): ArtifactAvailability {
  const absolute = resolveWithin(sessionDirPath, relative);
  if (absolute === null) return 'rejected';
  try {
    return statSync(absolute).isFile() ? 'ok' : 'missing';
  } catch {
    return 'missing';
  }
}

function parseSuggestion(sessionDirPath: string, entry: unknown): NextSuggestion | null {
  if (!isRecord(entry)) return null;
  const workflow = str(entry.workflow);
  if (workflow === null) return null;
  const artifacts: SuggestionArtifact[] = [];
  if (isRecord(entry.artifacts)) {
    for (const [name, value] of Object.entries(entry.artifacts)) {
      if (!isRecord(value)) continue;
      const output = str(value.output);
      const artifactPath = str(value.path);
      if (output === null || artifactPath === null) continue;
      artifacts.push({ name, output, path: artifactPath, availability: availability(sessionDirPath, artifactPath) });
    }
  }
  const argv = Array.isArray(entry.argv) ? entry.argv.filter((item): item is string => typeof item === 'string') : [];
  return { workflow, task: str(entry.task), artifacts, argv, declared: null };
}

/** Read `next.json` v1 of one session on demand. Unsupported or invalid files never affect session state. */
export function readNext(sessionDirPath: string): NextRead {
  let text: string;
  try {
    text = readFileSync(path.join(sessionDirPath, NEXT_FILENAME), 'utf8');
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' ? { kind: 'missing' } : { kind: 'unreadable', error: code };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : 'unparsable JSON' };
  }
  if (!isRecord(value)) return { kind: 'invalid', error: 'not a JSON object' };
  const version = value.schema_version;
  if (typeof version !== 'number' || !SUPPORTED_NEXT_SCHEMA_VERSIONS.includes(version)) {
    return { kind: 'unsupported', schemaVersion: typeof version === 'number' ? version : null };
  }
  if (!Array.isArray(value.next)) return { kind: 'invalid', error: 'next is not a list' };
  const suggestions: NextSuggestion[] = [];
  for (const entry of value.next) {
    const suggestion = parseSuggestion(sessionDirPath, entry);
    if (suggestion !== null) suggestions.push(suggestion);
  }
  return { kind: 'ok', sourceSessionId: str(value.source_session_id), suggestions };
}

function parseDownstreamEntry(entry: unknown): DeclaredDownstream | null {
  if (!isRecord(entry)) return null;
  const workflow = str(entry.workflow);
  if (workflow === null) return null;
  const artifacts: Record<string, string> = {};
  if (isRecord(entry.artifacts)) {
    for (const [name, output] of Object.entries(entry.artifacts)) {
      if (typeof output === 'string') artifacts[name] = output;
    }
  }
  return { workflow, task: str(entry.task), artifacts };
}

/** Read the `workflow.downstream` declaration from `workflow.frozen.yaml`. */
export function readFrozenDownstream(sessionDirPath: string): FrozenDownstreamRead {
  let text: string;
  try {
    text = readFileSync(path.join(sessionDirPath, FROZEN_WORKFLOW_FILENAME), 'utf8');
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' ? { kind: 'absent' } : { kind: 'unreadable', error: code };
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : 'unparsable YAML' };
  }
  const workflow = isRecord(parsed) ? parsed.workflow : undefined;
  const downstream = isRecord(workflow) ? workflow.downstream : undefined;
  if (downstream === undefined) return { kind: 'absent' };
  if (!Array.isArray(downstream)) return { kind: 'invalid', error: 'downstream is not a list' };
  const declared = downstream
    .map((entry) => parseDownstreamEntry(entry))
    .filter((entry): entry is DeclaredDownstream => entry !== null);
  return { kind: 'ok', downstream: declared };
}

function sameMapping(suggestion: NextSuggestion, declared: DeclaredDownstream): boolean {
  if (Object.keys(declared.artifacts).length !== suggestion.artifacts.length) return false;
  return suggestion.artifacts.every((artifact) => declared.artifacts[artifact.name] === artifact.output);
}

function isDeclared(suggestion: NextSuggestion, downstream: readonly DeclaredDownstream[]): boolean {
  return downstream.some((entry) => entry.workflow === suggestion.workflow && sameMapping(suggestion, entry));
}

/**
 * Set `declared` on each suggestion: true when the frozen workflow declares the same
 * target workflow with the same artifact-to-output mapping. Without a readable
 * declaration the flag stays null, never guessed.
 */
export function markDeclared(
  suggestions: readonly NextSuggestion[],
  frozen: FrozenDownstreamRead,
): NextSuggestion[] {
  if (frozen.kind !== 'ok') return suggestions.map((suggestion) => ({ ...suggestion, declared: null }));
  return suggestions.map((suggestion) => ({ ...suggestion, declared: isDeclared(suggestion, frozen.downstream) }));
}

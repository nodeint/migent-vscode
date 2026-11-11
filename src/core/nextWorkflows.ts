import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { text as describe } from '../text';
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
  /**
   * Target input name → source output name. `null` when the entry omits `artifacts`: since CLI 0.5.1 every
   * published artifact is then passed under its own id.
   */
  artifacts: Record<string, string> | null;
}

/** The `downstream` declaration shape in `workflow.frozen.yaml` has not been captured; this reader is lenient. */
export type FrozenDownstreamRead =
  | { kind: 'absent' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string }
  | { kind: 'ok'; downstream: DeclaredDownstream[]; optionalArtifacts: string[] };

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
    return { kind: 'invalid', error: error instanceof Error ? error.message : describe('states.unparsableJson') };
  }
  if (!isRecord(value)) return { kind: 'invalid', error: describe('states.notJsonObject') };
  const version = value.schema_version;
  if (typeof version !== 'number' || !SUPPORTED_NEXT_SCHEMA_VERSIONS.includes(version)) {
    return { kind: 'unsupported', schemaVersion: typeof version === 'number' ? version : null };
  }
  if (!Array.isArray(value.next)) return { kind: 'invalid', error: describe('states.nextNotList') };
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
  if (!isRecord(entry.artifacts)) return { workflow, task: str(entry.task), artifacts: null };
  const artifacts: Record<string, string> = {};
  for (const [name, output] of Object.entries(entry.artifacts)) {
    if (typeof output === 'string') artifacts[name] = output;
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
    return { kind: 'invalid', error: error instanceof Error ? error.message : describe('states.unparsableYaml') };
  }
  const workflow = isRecord(parsed) ? parsed.workflow : undefined;
  const downstream = isRecord(workflow) ? workflow.downstream : undefined;
  if (downstream === undefined) return { kind: 'absent' };
  if (!Array.isArray(downstream)) return { kind: 'invalid', error: describe('states.downstreamNotList') };
  const declared = downstream
    .map((entry) => parseDownstreamEntry(entry))
    .filter((entry): entry is DeclaredDownstream => entry !== null);
  return { kind: 'ok', downstream: declared, optionalArtifacts: optionalRegistryArtifacts(isRecord(workflow) ? workflow : {}) };
}

/** Ids of registry artifacts with `required: false`. A pre-schema-7 pin has no registry, so none. */
function optionalRegistryArtifacts(workflow: Record<string, unknown>): string[] {
  const registry = Array.isArray(workflow.artifacts) ? workflow.artifacts : [];
  const ids: string[] = [];
  for (const item of registry) {
    if (isRecord(item) && item.required === false && typeof item.id === 'string') ids.push(item.id);
  }
  return ids;
}

/** What the session published and which registry artifacts are optional; `published` is null when unknown. */
interface OutputFacts {
  published: ReadonlySet<string> | null;
  optional: ReadonlySet<string>;
}

/**
 * Whether a `next.json` entry is what the frozen declaration resolves to, using the CLI's 0.5.1 rule
 * (`resolveSuggestionEntries`, https://github.com/nodeint/migent/releases/tag/v0.5.1). It is checked against the
 * session's own published outputs, never `next.json` alone. Anything that does not match stays undeclared.
 *
 * - Omitted `artifacts`: exactly the published outputs, each under its own name.
 * - Explicit mapping: every suggested artifact is declared with the same output. A declared entry the suggestion
 *   lacks is allowed only when its output is optional and was not published.
 */
function sameMapping(suggestion: NextSuggestion, declared: DeclaredDownstream, outputs: OutputFacts): boolean {
  const { published, optional } = outputs;
  if (declared.artifacts === null) {
    if (published === null) return false;
    const names = new Set(suggestion.artifacts.map((artifact) => artifact.name));
    return (
      names.size === suggestion.artifacts.length &&
      names.size === published.size &&
      suggestion.artifacts.every((artifact) => artifact.name === artifact.output && published.has(artifact.output))
    );
  }
  const mapping = declared.artifacts;
  const suggested = new Set(suggestion.artifacts.map((artifact) => artifact.name));
  if (suggested.size !== suggestion.artifacts.length) return false;
  if (!suggestion.artifacts.every((artifact) => mapping[artifact.name] === artifact.output)) return false;
  return Object.entries(mapping).every(
    ([name, output]) => suggested.has(name) || (optional.has(output) && published !== null && !published.has(output)),
  );
}

function isDeclared(
  suggestion: NextSuggestion,
  downstream: readonly DeclaredDownstream[],
  outputs: OutputFacts,
): boolean {
  return downstream.some((entry) => entry.workflow === suggestion.workflow && sameMapping(suggestion, entry, outputs));
}

/** True when the suggestion's workflow is declared with an omitted mapping that needs the unknown outputs. */
function needsUnknownOutputs(
  suggestion: NextSuggestion,
  downstream: readonly DeclaredDownstream[],
  outputs: OutputFacts,
): boolean {
  if (outputs.published !== null) return false;
  return downstream.some((entry) => entry.workflow === suggestion.workflow && entry.artifacts === null);
}

/**
 * Set `declared` on each suggestion: true when the frozen workflow declares the same target workflow and its
 * resolution gives the suggested artifacts. `published` is the session's published output names
 * (`status.json.outputs`); without them an omitted mapping cannot be resolved. Without a readable
 * declaration the flag stays null, never guessed.
 */
export function markDeclared(
  suggestions: readonly NextSuggestion[],
  frozen: FrozenDownstreamRead,
  published: readonly string[] | null,
): NextSuggestion[] {
  if (frozen.kind !== 'ok') return suggestions.map((suggestion) => ({ ...suggestion, declared: null }));
  const outputs: OutputFacts = {
    published: published === null ? null : new Set(published),
    optional: new Set(frozen.optionalArtifacts),
  };
  return suggestions.map((suggestion) => {
    if (isDeclared(suggestion, frozen.downstream, outputs)) return { ...suggestion, declared: true };
    return { ...suggestion, declared: needsUnknownOutputs(suggestion, frozen.downstream, outputs) ? null : false };
  });
}

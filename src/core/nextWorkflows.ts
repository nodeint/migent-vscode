import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type { SessionNext } from '@nodeint/migent-contracts';
import { parse } from 'yaml';

import { text as describe } from '../text';
import type { CoreWorkflow } from './contractCore';
import { asSessionId } from './manifest';
import { FROZEN_WORKFLOW_FILENAME, NEXT_FILENAME, resolveWithin } from './paths';
import { isRecord } from './record';

/** `next.json` schema versions this extension reads. */
export const SUPPORTED_NEXT_SCHEMA_VERSIONS: readonly number[] = [1];

export type ArtifactAvailability = 'ok' | 'missing' | 'rejected';

/** One `next.json` entry exactly as the contract declares it. `argv` and `command` are data only, never run. */
export type NextEntry = SessionNext['next'][number];

/** The `downstream` fields the declared rule reads, taken from the contract item. `task` is not read. */
export type DownstreamDeclaration = Pick<
  NonNullable<CoreWorkflow['downstream']>[number],
  'workflow' | 'artifacts'
>;

/**
 * A readable `next.json`. The contract value and the facts derived from it are separate fields:
 * `availability[index]` maps each artifact name of `next.next[index]` to whether its file is readable inside the
 * session.
 */
export interface NextOk {
  kind: 'ok';
  next: SessionNext;
  availability: Record<string, ArtifactAvailability>[];
}

export type NextRead =
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string }
  | { kind: 'unsupported'; schemaVersion: number | null }
  | NextOk;

/** The `downstream` declaration shape in `workflow.frozen.yaml` has not been captured; this reader is lenient. */
export type FrozenDownstreamRead =
  | { kind: 'absent' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string }
  | { kind: 'ok'; downstream: DownstreamDeclaration[]; optionalArtifacts: string[] };

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

/**
 * The artifact map, or null when a value lacks `output` or `path`. It is built with `Object.fromEntries`, which
 * creates own properties, so a key such as `__proto__` is kept instead of reaching the prototype setter.
 */
function artifactsOf(raw: Record<string, unknown>): NextEntry['artifacts'] | null {
  const pairs: [string, NextEntry['artifacts'][string]][] = [];
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) return null;
    const output = str(value.output);
    const artifactPath = str(value.path);
    if (output === null || artifactPath === null) return null;
    pairs.push([name, { output, path: artifactPath }]);
  }
  return Object.fromEntries(pairs);
}

/** The entry as the contract declares it, or null when a required field is missing or of the wrong type. */
function parseEntry(entry: unknown): NextEntry | null {
  if (!isRecord(entry)) return null;
  const workflow = str(entry.workflow);
  const task = str(entry.task);
  if (workflow === null || task === null) return null;
  if (!isRecord(entry.artifacts) || !Array.isArray(entry.argv)) return null;
  const artifacts = artifactsOf(entry.artifacts);
  if (artifacts === null) return null;
  const argv = entry.argv.filter((item): item is string => typeof item === 'string');
  if (argv.length !== entry.argv.length) return null;
  const command = str(entry.command);
  return { workflow, task, artifacts, argv, ...(command === null ? {} : { command }) };
}

function availabilityOf(sessionDirPath: string, entry: NextEntry): Record<string, ArtifactAvailability> {
  return Object.fromEntries(
    Object.entries(entry.artifacts).map(([name, artifact]) => [name, availability(sessionDirPath, artifact.path)]),
  );
}

/** The readable result: entries missing a required field are skipped. */
function okRead(sessionDirPath: string, sourceSessionId: string, raw: readonly unknown[]): NextOk {
  const entries: NextEntry[] = [];
  for (const item of raw) {
    const entry = parseEntry(item);
    if (entry !== null) entries.push(entry);
  }
  return {
    kind: 'ok',
    next: { schema_version: 1, source_session_id: sourceSessionId, next: entries },
    availability: entries.map((entry) => availabilityOf(sessionDirPath, entry)),
  };
}

/**
 * Read `next.json` v1 of one session on demand. Unsupported or invalid files never affect session state. An entry
 * missing a required field is skipped; the envelope's required fields keep the `invalid` result.
 */
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
  const sourceSessionId = asSessionId(value.source_session_id);
  if (sourceSessionId === null) {
    return { kind: 'invalid', error: describe('states.missingRequiredField', { field: 'source_session_id' }) };
  }
  return okRead(sessionDirPath, sourceSessionId, value.next);
}

function parseDownstreamEntry(entry: unknown): DownstreamDeclaration | null {
  if (!isRecord(entry)) return null;
  const workflow = str(entry.workflow);
  if (workflow === null) return null;
  if (!isRecord(entry.artifacts)) return { workflow };
  const artifacts: Record<string, string> = Object.fromEntries(
    Object.entries(entry.artifacts).filter((pair): pair is [string, string] => typeof pair[1] === 'string'),
  );
  return { workflow, artifacts };
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
    .filter((entry): entry is DownstreamDeclaration => entry !== null);
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
function sameMapping(entry: NextEntry, declared: DownstreamDeclaration, outputs: OutputFacts): boolean {
  const { published, optional } = outputs;
  const suggested = Object.entries(entry.artifacts);
  if (declared.artifacts === undefined) {
    if (published === null) return false;
    return (
      suggested.length === published.size &&
      suggested.every(([name, artifact]) => name === artifact.output && published.has(artifact.output))
    );
  }
  const mapping = declared.artifacts;
  if (!suggested.every(([name, artifact]) => Object.hasOwn(mapping, name) && mapping[name] === artifact.output)) {
    return false;
  }
  const suggestedNames = new Set(suggested.map(([name]) => name));
  return Object.entries(mapping).every(
    ([name, output]) =>
      suggestedNames.has(name) || (optional.has(output) && published !== null && !published.has(output)),
  );
}

function isDeclared(entry: NextEntry, downstream: readonly DownstreamDeclaration[], outputs: OutputFacts): boolean {
  return downstream.some((item) => item.workflow === entry.workflow && sameMapping(entry, item, outputs));
}

/** True when the entry's workflow is declared with an omitted mapping that needs the unknown outputs. */
function needsUnknownOutputs(
  entry: NextEntry,
  downstream: readonly DownstreamDeclaration[],
  outputs: OutputFacts,
): boolean {
  if (outputs.published !== null) return false;
  return downstream.some((item) => item.workflow === entry.workflow && item.artifacts === undefined);
}

/**
 * The `declared` flag of each entry, by index: true when the frozen workflow declares the same target workflow and
 * its resolution gives the suggested artifacts. `published` is the session's published output names
 * (`status.json.outputs`); without them an omitted mapping cannot be resolved. Without a readable declaration the
 * flag stays null, never guessed. The contract entries are not modified.
 */
export function markDeclared(
  read: NextOk,
  frozen: FrozenDownstreamRead,
  published: readonly string[] | null,
): (boolean | null)[] {
  if (frozen.kind !== 'ok') return read.next.next.map(() => null);
  const outputs: OutputFacts = {
    published: published === null ? null : new Set(published),
    optional: new Set(frozen.optionalArtifacts),
  };
  return read.next.next.map((entry) => {
    if (isDeclared(entry, frozen.downstream, outputs)) return true;
    return needsUnknownOutputs(entry, frozen.downstream, outputs) ? null : false;
  });
}

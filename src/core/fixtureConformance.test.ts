import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { TSchema } from '@nodeint/migent-contracts';
import { isValid, SESSION_FILE_EXCLUSIONS, SESSION_FILES, validationIssues } from '@nodeint/migent-contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const FIXTURES = path.resolve(__dirname, 'fixtures');
const SETS = ['sessions', 'captured', 'synthetic'] as const;

/** Fixtures that are not meant to conform. Each entry is a fixture directory and file, and the reason. */
const NON_CONFORMING: readonly { readonly fixture: string; readonly file: string; readonly reason: string }[] = [
  { fixture: 'sessions/corrupt-status', file: 'status.json', reason: 'The file is not JSON, to test the unreadable-status path.' },
  { fixture: 'sessions/unknown-schema', file: 'manifest.yaml', reason: 'schema_version is 99, to test the unsupported-schema path.' },
  { fixture: 'synthetic/next-invalid', file: 'next.json', reason: 'The file is not JSON, to test the invalid next-step path.' },
  { fixture: 'synthetic/next-unsupported', file: 'next.json', reason: 'schema_version is 2, which the contract does not describe.' },
  { fixture: 'synthetic/numeric-ids-unquoted/2', file: 'manifest.yaml', reason: 'The session ids are unquoted integers, which the CLI reads but never writes.' },
  { fixture: 'synthetic/numeric-ids-unquoted/3', file: 'manifest.yaml', reason: 'The session ids are unquoted integers, which the CLI reads but never writes.' },
  { fixture: 'synthetic/questions-superseded', file: 'questions.json', reason: 'It has a superseded record and an answer outside the observed shapes.' },
];

/** Session files the contract does not describe, plus files that are not session data. */
const UNDESCRIBED = new Set(SESSION_FILE_EXCLUSIONS.map((entry) => entry.name));
const NOT_SESSION_DATA = /(^|\/)(task\.md|reply\.txt|README\.md|probe-[^/]*\.yaml)$/;

interface FixtureFile {
  readonly fixture: string;
  readonly file: string;
  readonly absolute: string;
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** A fixture is a session directory. A directory with no files and no `executions` folder holds several fixtures. */
function fixtureRoots(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const holdsSessions = entries.every((entry) => entry.isDirectory()) && !entries.some((entry) => entry.name === 'executions');
  return holdsSessions ? entries.flatMap((entry) => fixtureRoots(path.join(directory, entry.name))) : [directory];
}

function fixtureFiles(): FixtureFile[] {
  return SETS.flatMap((set) =>
    readdirSync(path.join(FIXTURES, set), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => fixtureRoots(path.join(FIXTURES, set, entry.name)))
      .flatMap((root) =>
        walk(root).map((absolute) => ({
          fixture: path.relative(FIXTURES, root).split(path.sep).join('/'),
          file: path.relative(root, absolute).split(path.sep).join('/'),
          absolute,
        })),
      ),
  );
}

function patternMatches(pattern: string, file: string): boolean {
  const want = pattern.split('/');
  const have = file.split('/');
  return want.length === have.length && want.every((part, index) => part === '<id>' || part === have[index]);
}

function schemaFor(file: string): TSchema | undefined {
  return SESSION_FILES.find((entry) => patternMatches(entry.path, file))?.schema;
}

type Parsed = { readonly ok: true; readonly values: readonly unknown[] } | { readonly ok: false };

function parseFile(file: FixtureFile, framing: string): Parsed {
  const text = readFileSync(file.absolute, 'utf8');
  try {
    if (framing === 'yaml') return { ok: true, values: [parse(text) as unknown] };
    if (framing === 'json-lines') {
      return { ok: true, values: text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as unknown) };
    }
    return { ok: true, values: [JSON.parse(text) as unknown] };
  } catch {
    return { ok: false };
  }
}

function conforms(file: FixtureFile): boolean {
  const schema = schemaFor(file.file);
  if (schema === undefined) throw new Error(`No schema for ${file.fixture}/${file.file}`);
  const framing = SESSION_FILES.find((entry) => patternMatches(entry.path, file.file))?.framing ?? 'document';
  const parsed = parseFile(file, framing);
  return parsed.ok && parsed.values.every((value) => isValid(schema, value));
}

function issues(file: FixtureFile): unknown[] {
  const schema = schemaFor(file.file);
  const framing = SESSION_FILES.find((entry) => patternMatches(entry.path, file.file))?.framing ?? 'document';
  const parsed = schema === undefined ? { ok: false as const } : parseFile(file, framing);
  if (schema === undefined || !parsed.ok) return ['unreadable'];
  return parsed.values.flatMap((value) => validationIssues(schema, value));
}

const isListed = (file: FixtureFile): boolean =>
  NON_CONFORMING.some((entry) => entry.fixture === file.fixture && entry.file === file.file);

const all = fixtureFiles();
// A file the contract describes is always checked, even when its name is also listed as undescribed
// (`plugins/metrics/metrics.json` shares its name with the excluded legacy root `metrics.json`).
const described = all.filter(
  (file) =>
    !NOT_SESSION_DATA.test(file.file) &&
    (schemaFor(file.file) !== undefined || !UNDESCRIBED.has(path.posix.basename(file.file))),
);
const unmapped = described.filter((file) => schemaFor(file.file) === undefined);

describe('session fixtures conform to the contract schemas', () => {
  it('finds fixture files in every set', () => {
    for (const set of SETS) expect(described.some((file) => file.fixture.startsWith(`${set}/`))).toBe(true);
  });

  it('maps every fixture file to a schema or to a named exemption', () => {
    expect(unmapped.map((file) => `${file.fixture}/${file.file}`)).toEqual([]);
  });

  const checked = described.filter((file) => schemaFor(file.file) !== undefined);

  for (const file of checked.filter((candidate) => !isListed(candidate))) {
    it(`${file.fixture}/${file.file} conforms`, () => {
      expect(issues(file)).toEqual([]);
      expect(conforms(file)).toBe(true);
    });
  }

  for (const entry of NON_CONFORMING) {
    it(`excluded ${entry.fixture}/${entry.file} still does not conform`, () => {
      const file = checked.find((candidate) => candidate.fixture === entry.fixture && candidate.file === entry.file);
      expect(file, 'the excluded file exists and has a schema').toBeDefined();
      if (file !== undefined) expect(conforms(file)).toBe(false);
    });
  }
});

import { execFileSync, type ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { TSchema } from '@nodeint/migent-contracts';
import {
  AuthoringEnvelope,
  DoctorReport,
  GetClientList,
  GetModelList,
  GetNativeOptionList,
  isValid,
  PrepareResult,
  validationIssues,
} from '@nodeint/migent-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const FIXTURE = path.resolve(__dirname, 'fixtures', 'workspace', 'fake-migent.js');

let dir = '';
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'migent-conformance-'));
  mkdirSync(path.join(dir, '.migent'), { recursive: true });
  writeFileSync(path.join(dir, 'draft.yaml'), 'id: demo\n');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fixtureJson(args: string[], input = ''): unknown {
  const options: ExecFileSyncOptionsWithStringEncoding = { cwd: dir, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'] };
  return JSON.parse(execFileSync(process.execPath, [FIXTURE, ...args], options)) as unknown;
}

function expectConforms(schema: TSchema, value: unknown): void {
  expect(validationIssues(schema, value)).toEqual([]);
  expect(isValid(schema, value)).toBe(true);
}

// The integration suite trusts the fixture CLI; this keeps it from drifting from the published contracts.
describe('fixture CLI JSON output conforms to the CLI 0.5.5 contracts', () => {
  it('session prepare', () => {
    expectConforms(PrepareResult, fixtureJson(['session', 'prepare', 'A title', '--workflow', 'demo']));
  });

  it('get clients and get models', () => {
    expectConforms(GetClientList, fixtureJson(['get', 'clients', '--json']));
    expectConforms(GetModelList, fixtureJson(['get', 'models', '--json']));
  });

  it('the authoring envelope of workflow validate', () => {
    expectConforms(AuthoringEnvelope, fixtureJson(['workflow', 'validate', 'draft.yaml', '--json']));
  });

  it('doctor and native options', () => {
    expectConforms(DoctorReport, fixtureJson(['doctor', '--json']));
    expectConforms(GetNativeOptionList, fixtureJson(['get', 'options', '--client', 'codex', '--native', '--json']));
  });

  it('the authoring envelope of workflow save and config save', () => {
    const workflow = ['workflow', 'save', '-', '--target', 'w.yaml', '--format', 'yaml', '--json'];
    const config = ['config', 'save', '-', '--scope', 'project', '--format', 'yaml', '--preserve-comments', '--json'];
    expectConforms(AuthoringEnvelope, fixtureJson(workflow, 'id: demo\n'));
    expectConforms(AuthoringEnvelope, fixtureJson(config, 'schema_version: 7\n'));
  });
});

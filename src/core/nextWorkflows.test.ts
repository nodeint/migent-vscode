import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { markDeclared, readFrozenDownstream, readNext } from './nextWorkflows';
import { capturedDir, syntheticDir } from './testHelpers';

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempSession(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'migent-vscode-next-'));
  temps.push(dir);
  return dir;
}

describe('readNext', () => {
  it('reads the captured v1 next.json, keeping argv as data', () => {
    const read = readNext(capturedDir('handoff-source'));
    expect(read).toMatchObject({ kind: 'ok', sourceSessionId: '00000000-0000-4000-8000-0000000000b1' });
    if (read.kind !== 'ok') return;
    expect(read.suggestions).toHaveLength(1);
    const [suggestion] = read.suggestions;
    expect(suggestion).toMatchObject({
      workflow: 'probe-target',
      task: 'Acknowledge the note.',
      declared: null,
      argv: expect.arrayContaining(['session', 'run', '--prior']),
    });
    // The captured sample has no outputs/note.md, so availability is independent of the suggestion itself.
    expect(suggestion?.artifacts).toEqual([
      { name: 'context_note', output: 'note', path: 'outputs/note.md', availability: 'missing' },
    ]);
  });

  it('marks an artifact available when its file exists inside the session', () => {
    const dir = tempSession();
    mkdirSync(path.join(dir, 'outputs'));
    writeFileSync(path.join(dir, 'outputs', 'note.md'), 'n');
    writeFileSync(
      path.join(dir, 'next.json'),
      JSON.stringify({
        schema_version: 1,
        next: [
          {
            workflow: 'w',
            artifacts: { a: { output: 'note', path: 'outputs/note.md' }, b: { output: 'x', path: '../x.md' } },
          },
        ],
      }),
    );
    const read = readNext(dir);
    expect(read.kind === 'ok' && read.suggestions[0]?.artifacts.map((a) => a.availability)).toEqual([
      'ok',
      'rejected',
    ]);
  });

  it('keeps missing, invalid and unsupported files distinct (synthetic)', () => {
    expect(readNext(capturedDir('question-pending'))).toEqual({ kind: 'missing' });
    expect(readNext(syntheticDir('next-invalid')).kind).toBe('invalid');
    expect(readNext(syntheticDir('next-unsupported'))).toEqual({ kind: 'unsupported', schemaVersion: 2 });
  });

  it('skips suggestions without a workflow id', () => {
    const dir = tempSession();
    writeFileSync(path.join(dir, 'next.json'), JSON.stringify({ schema_version: 1, next: [{ task: 't' }, { workflow: 'w' }] }));
    const read = readNext(dir);
    expect(read.kind === 'ok' && read.suggestions.map((s) => s.workflow)).toEqual(['w']);
  });
});

describe('readFrozenDownstream and markDeclared', () => {
  it('reads the captured downstream declaration', () => {
    expect(readFrozenDownstream(capturedDir('handoff-source'))).toEqual({
      kind: 'ok',
      downstream: [{ workflow: 'probe-target', task: 'Acknowledge the note.', artifacts: { context_note: 'note' } }],
      optionalArtifacts: [],
    });
  });

  it('is absent without a frozen workflow or a downstream key', () => {
    expect(readFrozenDownstream(capturedDir('question-pending'))).toEqual({ kind: 'absent' });
    const dir = tempSession();
    writeFileSync(path.join(dir, 'workflow.frozen.yaml'), 'workflow:\n  id: x\n');
    expect(readFrozenDownstream(dir)).toEqual({ kind: 'absent' });
  });

  it('reports a malformed declaration as invalid', () => {
    const dir = tempSession();
    writeFileSync(path.join(dir, 'workflow.frozen.yaml'), 'workflow:\n  downstream: nope\n');
    expect(readFrozenDownstream(dir).kind).toBe('invalid');
    writeFileSync(path.join(dir, 'workflow.frozen.yaml'), 'a: [unclosed\n');
    expect(readFrozenDownstream(dir).kind).toBe('invalid');
  });

  it('flags a suggestion declared only when workflow and artifact mapping match', () => {
    const read = readNext(capturedDir('handoff-source'));
    if (read.kind !== 'ok') throw new Error('next did not read');
    expect(markDeclared(read.suggestions, readFrozenDownstream(capturedDir('handoff-source')), ['note'])[0]?.declared).toBe(true);
    // The synthetic declaration maps the same workflow to a different mapping elsewhere: not declared for other-target.
    const synthetic = readFrozenDownstream(syntheticDir('frozen-downstream'));
    const [declared] = markDeclared(read.suggestions, synthetic, ['note']);
    expect(declared?.declared).toBe(true);
    const other = markDeclared([{ ...read.suggestions[0]!, workflow: 'other-target' }], synthetic, ['note']);
    expect(other[0]?.declared).toBe(false);
  });

  it('leaves declared null when the declaration cannot be read', () => {
    const read = readNext(capturedDir('handoff-source'));
    if (read.kind !== 'ok') throw new Error('next did not read');
    expect(markDeclared(read.suggestions, { kind: 'absent' }, ['note'])[0]?.declared).toBeNull();
  });
});

describe('markDeclared with CLI 0.5.1 resolution', () => {
  const suggestion = (artifacts: Record<string, string>) => ({
    workflow: 'next',
    task: null,
    argv: [],
    declared: null,
    artifacts: Object.entries(artifacts).map(([name, output]) => ({
      name,
      output,
      path: `outputs/${output}.md`,
      availability: 'ok' as const,
    })),
  });
  const frozen = (downstream: { artifacts: Record<string, string> | null }[], optionalArtifacts: string[] = []) => ({
    kind: 'ok' as const,
    downstream: downstream.map((entry) => ({ workflow: 'next', task: null, ...entry })),
    optionalArtifacts,
  });
  const declared = (s: ReturnType<typeof suggestion>, f: ReturnType<typeof frozen>, published: string[] | null) =>
    markDeclared([s], f, published)[0]?.declared;

  it('reads an omitted mapping as omitted, apart from an empty one, and the optional registry ids', () => {
    const dir = tempSession();
    writeFileSync(
      path.join(dir, 'workflow.frozen.yaml'),
      'workflow:\n  artifacts:\n    - {id: a, file: a.md}\n    - {id: b, file: b.md, required: false}\n  downstream:\n    - workflow: x\n    - workflow: y\n      artifacts: {}\n',
    );
    expect(readFrozenDownstream(dir)).toEqual({
      kind: 'ok',
      downstream: [
        { workflow: 'x', task: null, artifacts: null },
        { workflow: 'y', task: null, artifacts: {} },
      ],
      optionalArtifacts: ['b'],
    });
  });

  it('confirms an omitted mapping only when the suggestion is exactly the published outputs under their own ids', () => {
    const f = frozen([{ artifacts: null }]);
    expect(declared(suggestion({ a: 'a', b: 'b' }), f, ['a', 'b'])).toBe(true);
    expect(declared(suggestion({ a: 'a' }), f, ['a', 'b'])).toBe(false);
    expect(declared(suggestion({ a: 'a', c: 'c' }), f, ['a', 'b'])).toBe(false);
    expect(declared(suggestion({ x: 'a' }), f, ['a'])).toBe(false);
  });

  it('does not guess an omitted mapping without the published outputs', () => {
    expect(declared(suggestion({ a: 'a' }), frozen([{ artifacts: null }]), null)).toBeNull();
  });

  it('allows a declared optional artifact to be missing only when it was not published', () => {
    const f = frozen([{ artifacts: { plan: 'plan', extra: 'extra' } }], ['extra']);
    expect(declared(suggestion({ plan: 'plan' }), f, ['plan'])).toBe(true);
    expect(declared(suggestion({ plan: 'plan' }), f, ['plan', 'extra'])).toBe(false);
    expect(declared(suggestion({ plan: 'plan', extra: 'extra' }), f, ['plan', 'extra'])).toBe(true);
  });

  it('keeps blocking a missing required artifact, an extra artifact and a different output', () => {
    const f = frozen([{ artifacts: { plan: 'plan', extra: 'extra' } }], []);
    expect(declared(suggestion({ plan: 'plan' }), f, ['plan'])).toBe(false);
    expect(declared(suggestion({ plan: 'plan', extra: 'extra', more: 'more' }), f, ['plan', 'extra'])).toBe(false);
    expect(declared(suggestion({ plan: 'other', extra: 'extra' }), f, ['plan', 'extra'])).toBe(false);
  });
});

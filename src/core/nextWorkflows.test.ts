import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { markDeclared, type NextOk, readFrozenDownstream, readNext } from './nextWorkflows';
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

const SOURCE_ID = '00000000-0000-4000-8000-0000000000b1';

/** A complete entry; every test of one required field starts from it. */
function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workflow: 'w',
    task: 't',
    artifacts: { a: { output: 'note', path: 'outputs/note.md' } },
    argv: ['migent', 'session', 'run'],
    ...overrides,
  };
}

function writeNext(dir: string, document: Record<string, unknown>): void {
  writeFileSync(path.join(dir, 'next.json'), JSON.stringify(document));
}

function okRead(dir: string): NextOk {
  const read = readNext(dir);
  if (read.kind !== 'ok') throw new Error(`next did not read: ${read.kind}`);
  return read;
}

describe('readNext', () => {
  it('reads the captured v1 next.json as the contract value, keeping argv as data', () => {
    const read = okRead(capturedDir('handoff-source'));
    expect(read.next.source_session_id).toBe(SOURCE_ID);
    expect(read.next.next).toEqual([
      {
        workflow: 'probe-target',
        task: 'Acknowledge the note.',
        artifacts: { context_note: { output: 'note', path: 'outputs/note.md' } },
        argv: ['migent', 'session', 'run', '--workflow', 'probe-target', '--prior', SOURCE_ID],
      },
    ]);
    // The captured sample has no outputs/note.md, so availability is derived apart from the entry itself.
    expect(read.availability).toEqual([{ context_note: 'missing' }]);
    expect(read.next.next[0]).not.toHaveProperty('availability');
    expect(read.next.next[0]).not.toHaveProperty('declared');
  });

  it('keeps an optional command and drops one of the wrong type', () => {
    const dir = tempSession();
    writeNext(dir, {
      schema_version: 1,
      source_session_id: SOURCE_ID,
      next: [entry({ command: 'migent session run' }), entry({ command: 7 })],
    });
    const read = okRead(dir);
    expect(read.next.next[0]?.command).toBe('migent session run');
    expect(read.next.next[1]).not.toHaveProperty('command');
  });

  it('marks an artifact available when its file exists inside the session', () => {
    const dir = tempSession();
    mkdirSync(path.join(dir, 'outputs'));
    writeFileSync(path.join(dir, 'outputs', 'note.md'), 'n');
    writeNext(dir, {
      schema_version: 1,
      source_session_id: SOURCE_ID,
      next: [
        entry({ artifacts: { a: { output: 'note', path: 'outputs/note.md' }, b: { output: 'x', path: '../x.md' } } }),
      ],
    });
    expect(okRead(dir).availability).toEqual([{ a: 'ok', b: 'rejected' }]);
  });

  it('keeps missing, invalid and unsupported files distinct (synthetic)', () => {
    expect(readNext(capturedDir('question-pending'))).toEqual({ kind: 'missing' });
    expect(readNext(syntheticDir('next-invalid')).kind).toBe('invalid');
    expect(readNext(syntheticDir('next-unsupported'))).toEqual({ kind: 'unsupported', schemaVersion: 2 });
  });

  it('keeps an artifact named __proto__ and computes its availability', () => {
    const dir = tempSession();
    const body = '{"schema_version":1,"source_session_id":"' + SOURCE_ID + '","next":[{"workflow":"w","task":"t","argv":[],' +
      '"artifacts":{"__proto__":{"output":"note","path":"../outside.md"},"ok":{"output":"note","path":"outputs/note.md"}}}]}';
    writeFileSync(path.join(dir, 'next.json'), body);
    const read = okRead(dir);
    const [first] = read.next.next;
    expect(Object.keys(first?.artifacts ?? {})).toEqual(['__proto__', 'ok']);
    expect(Object.getOwnPropertyDescriptor(first?.artifacts, '__proto__')?.value).toEqual({
      output: 'note',
      path: '../outside.md',
    });
    expect(Object.keys(read.availability[0] ?? {})).toEqual(['__proto__', 'ok']);
    expect(Object.getOwnPropertyDescriptor(read.availability[0], '__proto__')?.value).toBe('rejected');
  });

  it('accepts a numeric source session id as a string', () => {
    const dir = tempSession();
    writeNext(dir, { schema_version: 1, source_session_id: 12, next: [entry()] });
    expect(okRead(dir).next.source_session_id).toBe('12');
  });

  describe('required entry fields (B7)', () => {
    const fields: [string, unknown[]][] = [
      ['workflow', [undefined, '', 5, null, {}]],
      ['task', [undefined, '', 5, null, {}]],
      ['artifacts', [undefined, 'x', 5, null, ['a']]],
      ['argv', [undefined, 'x', 5, null, {}, ['ok', 1]]],
    ];
    const cases = fields.flatMap(([field, values]) => values.map((value) => [field, value] as const));

    it.each(cases)('skips an entry whose %s is %j and keeps the valid entries and their indexes', (field, value) => {
      const dir = tempSession();
      mkdirSync(path.join(dir, 'outputs'));
      writeFileSync(path.join(dir, 'outputs', 'note.md'), 'n');
      const broken = entry({ workflow: 'broken' });
      if (value === undefined) delete broken[field];
      else broken[field] = value;
      writeNext(dir, {
        schema_version: 1,
        source_session_id: SOURCE_ID,
        next: [
          entry({ workflow: 'first' }),
          broken,
          entry({ workflow: 'last', artifacts: { z: { output: 'q', path: 'missing.md' } } }),
        ],
      });
      const read = okRead(dir);
      expect(read.next.next.map((item) => item.workflow)).toEqual(['first', 'last']);
      expect(read.availability).toEqual([{ a: 'ok' }, { z: 'missing' }]);
    });

    const artifactCases: [string, unknown][] = [
      ['an artifact that is not an object', 'outputs/note.md'],
      ['an artifact without output', { path: 'outputs/note.md' }],
      ['an artifact without path', { output: 'note' }],
      ['an artifact with a wrong-typed output', { output: 3, path: 'outputs/note.md' }],
      ['an artifact with a wrong-typed path', { output: 'note', path: 3 }],
    ];
    it.each(artifactCases)('skips an entry with %s', (_label, artifact) => {
      const dir = tempSession();
      writeNext(dir, {
        schema_version: 1,
        source_session_id: SOURCE_ID,
        next: [entry({ workflow: 'broken', artifacts: { a: artifact } }), entry({ workflow: 'kept' })],
      });
      expect(okRead(dir).next.next.map((item) => item.workflow)).toEqual(['kept']);
    });

    it('skips an entry that is not an object, without throwing', () => {
      const dir = tempSession();
      writeNext(dir, { schema_version: 1, source_session_id: SOURCE_ID, next: [null, 'w', 4, [], entry()] });
      expect(okRead(dir).next.next).toHaveLength(1);
    });
  });

  describe('required envelope fields', () => {
    it.each([
      ['next', undefined],
      ['next', {}],
      ['next', 'x'],
      ['source_session_id', undefined],
      ['source_session_id', ''],
      ['source_session_id', null],
      ['source_session_id', {}],
      ['source_session_id', -1],
    ])('gives invalid when %s is %j', (field, value) => {
      const dir = tempSession();
      const document: Record<string, unknown> = { schema_version: 1, source_session_id: SOURCE_ID, next: [entry()] };
      if (value === undefined) delete document[field];
      else document[field] = value;
      writeNext(dir, document);
      expect(readNext(dir).kind).toBe('invalid');
    });

    it('does not quote file content in the error', () => {
      const dir = tempSession();
      writeNext(dir, { schema_version: 1, source_session_id: 'secret-id-value', next: 'secret-next-value' });
      const read = readNext(dir);
      expect(read.kind === 'invalid' && read.error).not.toMatch(/secret/);
    });

    it.each([undefined, 'x', 2, null])('gives unsupported for schema_version %j', (value) => {
      const dir = tempSession();
      const document: Record<string, unknown> = { source_session_id: SOURCE_ID, next: [entry()] };
      if (value !== undefined) document.schema_version = value;
      writeNext(dir, document);
      expect(readNext(dir).kind).toBe('unsupported');
    });
  });
});

describe('readFrozenDownstream and markDeclared', () => {
  it('reads the captured downstream declaration', () => {
    expect(readFrozenDownstream(capturedDir('handoff-source'))).toEqual({
      kind: 'ok',
      downstream: [{ workflow: 'probe-target', artifacts: { context_note: 'note' } }],
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
    const read = okRead(capturedDir('handoff-source'));
    expect(markDeclared(read, readFrozenDownstream(capturedDir('handoff-source')), ['note'])).toEqual([true]);
    // The synthetic declaration maps the same workflow to a different mapping elsewhere: not declared for other-target.
    const synthetic = readFrozenDownstream(syntheticDir('frozen-downstream'));
    expect(markDeclared(read, synthetic, ['note'])).toEqual([true]);
    const other: NextOk = {
      ...read,
      next: { ...read.next, next: read.next.next.map((item) => ({ ...item, workflow: 'other-target' })) },
    };
    expect(markDeclared(other, synthetic, ['note'])).toEqual([false]);
  });

  it('does not modify the contract entries', () => {
    const read = okRead(capturedDir('handoff-source'));
    const before = structuredClone(read.next);
    markDeclared(read, readFrozenDownstream(capturedDir('handoff-source')), ['note']);
    expect(read.next).toEqual(before);
  });

  it('leaves declared null when the declaration cannot be read', () => {
    const read = okRead(capturedDir('handoff-source'));
    expect(markDeclared(read, { kind: 'absent' }, ['note'])).toEqual([null]);
  });
});

describe('markDeclared with CLI 0.5.1 resolution', () => {
  const suggestion = (artifacts: Record<string, string>): NextOk => ({
    kind: 'ok',
    next: {
      schema_version: 1,
      source_session_id: SOURCE_ID,
      next: [
        {
          workflow: 'next',
          task: 't',
          argv: [],
          artifacts: Object.fromEntries(
            Object.entries(artifacts).map(([name, output]) => [name, { output, path: `outputs/${output}.md` }]),
          ),
        },
      ],
    },
    availability: [Object.fromEntries(Object.keys(artifacts).map((name) => [name, 'ok' as const]))],
  });
  const frozen = (downstream: { artifacts?: Record<string, string> }[], optionalArtifacts: string[] = []) => ({
    kind: 'ok' as const,
    downstream: downstream.map((item) => ({ workflow: 'next', ...item })),
    optionalArtifacts,
  });
  const declared = (s: NextOk, f: ReturnType<typeof frozen>, published: string[] | null) =>
    markDeclared(s, f, published)[0];

  it('reads an omitted mapping as omitted, apart from an empty one, and the optional registry ids', () => {
    const dir = tempSession();
    writeFileSync(
      path.join(dir, 'workflow.frozen.yaml'),
      'workflow:\n  artifacts:\n    - {id: a, file: a.md}\n    - {id: b, file: b.md, required: false}\n  downstream:\n    - workflow: x\n    - workflow: y\n      artifacts: {}\n',
    );
    expect(readFrozenDownstream(dir)).toEqual({
      kind: 'ok',
      downstream: [{ workflow: 'x' }, { workflow: 'y', artifacts: {} }],
      optionalArtifacts: ['b'],
    });
  });

  it('confirms an omitted mapping only when the suggestion is exactly the published outputs under their own ids', () => {
    const f = frozen([{}]);
    expect(declared(suggestion({ a: 'a', b: 'b' }), f, ['a', 'b'])).toBe(true);
    expect(declared(suggestion({ a: 'a' }), f, ['a', 'b'])).toBe(false);
    expect(declared(suggestion({ a: 'a', c: 'c' }), f, ['a', 'b'])).toBe(false);
    expect(declared(suggestion({ x: 'a' }), f, ['a'])).toBe(false);
  });

  it('does not guess an omitted mapping without the published outputs', () => {
    expect(declared(suggestion({ a: 'a' }), frozen([{}]), null)).toBeNull();
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

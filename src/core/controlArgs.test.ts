import { describe, expect, it } from 'vitest';

import {
  availableClients,
  cancelArgs,
  clientChoice,
  completeArgs,
  continueArgs,
  DEFAULT_RUN_SETTINGS,
  doctorArgs,
  doctorLines,
  initArgs,
  joinClients,
  modelsDefaultFirst,
  parseDoctorOutput,
  parsePrepared,
  parseRenameOutput,
  prepareArgs,
  renameArgs,
  repairArgs,
  runDownstreamArgs,
  runNewArgs,
  runPreparedArgs,
} from './controlArgs';

describe('control argv builders', () => {
  it('passes a task with quotes, spaces and Unicode as one argv value', () => {
    const task = 'Fix "login" bug — ca sĩ & $HOME';
    const args = runNewArgs({ workflowId: 'plan', task }, DEFAULT_RUN_SETTINGS);
    expect(args.slice(0, 6)).toEqual(['session', 'run', '--workflow', 'plan', '--task', task]);
  });

  it('takes the dispatch ceiling and progress flag from settings, never from the caller', () => {
    expect(runNewArgs({ workflowId: 'w', task: 't' }, { maxDispatches: 7, progress: false })).toEqual([
      'session', 'run', '--workflow', 'w', '--task', 't', '--max-dispatches', '7',
    ]);
    expect(runPreparedArgs({ sessionId: 's', workflowId: 'w' }, DEFAULT_RUN_SETTINGS)).toEqual([
      'session', 'run', '--session', 's', '--workflow', 'w', '--max-dispatches', '20', '--progress',
    ]);
  });

  it('keeps the dispatch ceiling a positive integer', () => {
    const args = continueArgs({ sessionId: 's' }, { maxDispatches: 0.4, progress: false });
    expect(args).toEqual(['session', 'continue', 's', '--max-dispatches', '1']);
  });

  it('adds --once and --refresh-workflow only when asked', () => {
    expect(continueArgs({ sessionId: 's', once: true, refreshWorkflow: true }, DEFAULT_RUN_SETTINGS)).toEqual([
      'session', 'continue', 's', '--once', '--refresh-workflow', '--max-dispatches', '20', '--progress',
    ]);
  });

  it('builds prepare and cancel arguments', () => {
    expect(prepareArgs({ title: 'My title', workflowId: 'plan' })).toEqual([
      'session', 'prepare', 'My title', '--workflow', 'plan',
    ]);
    expect(cancelArgs('s')).toEqual(['session', 'cancel', 's', '--json']);
    expect(completeArgs('s')).toEqual(['session', 'complete', 's']);
  });

  it('builds downstream run and prepare arguments with the prior as its own value', () => {
    const task = 'Ship "it" — ca sĩ';
    expect(runDownstreamArgs({ workflowId: 'impl', priorSessionId: 'src', task: null }, DEFAULT_RUN_SETTINGS)).toEqual([
      'session', 'run', '--workflow', 'impl', '--prior', 'src', '--max-dispatches', '20', '--progress',
    ]);
    const withTask = runDownstreamArgs({ workflowId: 'impl', priorSessionId: 'src', task }, DEFAULT_RUN_SETTINGS);
    expect(withTask.slice(0, 8)).toEqual(['session', 'run', '--workflow', 'impl', '--prior', 'src', '--task', task]);
    expect(prepareArgs({ title: 'T', workflowId: 'impl', priorSessionId: 'src' })).toEqual([
      'session', 'prepare', 'T', '--workflow', 'impl', '--prior', 'src',
    ]);
    expect(prepareArgs({ title: 'T', workflowId: 'impl' })).not.toContain('--prior');
  });
});

describe('parsePrepared', () => {
  it('reads the documented prepare output', () => {
    expect(parsePrepared({ session_id: 'a', title: 't', status: 'prepared', task_path: '.migent/sessions/a/task.md' })).toEqual({
      sessionId: 'a',
      taskPath: '.migent/sessions/a/task.md',
    });
  });

  it('rejects anything else', () => {
    expect(parsePrepared(null)).toBeNull();
    expect(parsePrepared({ session_id: 'a' })).toBeNull();
    expect(parsePrepared({ session_id: '', task_path: 'x' })).toBeNull();
  });
});

describe('reply, repair, doctor and init argv', () => {
  it('builds repair and doctor argv', () => {
    expect(repairArgs('s1')).toEqual(['session', 'repair', 's1']);
    expect(doctorArgs()).toEqual(['doctor', '--json']);
  });

  it('passes one agent spec per template agent as a single argv element and never prompts', () => {
    const agent = (client: string) => ({ client, model: `${client} model "x"` });
    const args = initArgs({ planning: agent('p'), review: agent('r'), coding: agent('c') });
    expect(args).toEqual([
      'init',
      '--agent',
      'coding=c:c model "x"',
      '--agent',
      'planning=p:p model "x"',
      '--agent',
      'review=r:r model "x"',
      '--no-input',
    ]);
  });

  it('joins available clients with their models and drops the rest', () => {
    const clients = [
      { kind: 'client', name: 'claude-code', command: 'claude', available: true },
      { kind: 'client', name: 'codex', command: 'codex', available: true },
      { kind: 'client', name: 'opencode', command: 'opencode', available: false },
      { kind: 'client', name: 'grok', command: 'grok', available: true },
      'junk',
    ];
    const models = [
      { kind: 'model', name: 'sonnet', client: 'claude-code', default: false },
      { kind: 'model', name: 'opus', client: 'claude-code', default: true },
      { kind: 'model', name: 'opus', client: 'other', default: true },
      { kind: 'model', name: 'gpt', client: 'codex', default: false },
      { kind: 'model', name: 'x', client: 'opencode', default: true },
      { kind: 'model', client: 'grok' },
      null,
    ];
    expect(joinClients(clients, models)).toEqual([
      { id: 'claude-code', models: ['sonnet', 'opus'], defaultModel: 'opus' },
      { id: 'codex', models: ['gpt'] },
    ]);
    expect(joinClients('nope', models)).toEqual([]);
    expect(joinClients(clients, {})).toEqual([]);
  });

  it('lists the default model first', () => {
    const [choice] = joinClients(
      [{ name: 'c', available: true }],
      [
        { name: 'm1', client: 'c', default: false },
        { name: 'm2', client: 'c', default: true },
        { name: 'm3', client: 'c', default: false },
      ],
    );
    expect(modelsDefaultFirst(choice)).toEqual(['m2', 'm1', 'm3']);
    expect(modelsDefaultFirst({ id: 'a', models: ['m1'], defaultModel: 'gone' })).toEqual(['m1']);
  });

  it('builds a client choice with its models and native option keys', () => {
    const models = [
      { name: 'm1', client: 'c', default: false },
      { name: 'm2', client: 'c', default: true },
      { name: 'x', client: 'other', default: true },
    ];
    const options = [{ name: 'effort' }, { name: 'sandbox' }, { name: 3 }, null];
    expect(clientChoice('c', models, options)).toEqual({
      id: 'c',
      models: ['m1', 'm2'],
      defaultModel: 'm2',
      optionKeys: ['effort', 'sandbox'],
    });
    expect(clientChoice('none', models, options)).toBeNull();
    expect(clientChoice('c', 'nope', options)).toBeNull();
  });

  it('lists only the available clients', () => {
    expect(
      availableClients([{ name: 'a', available: true }, { name: 'b', available: false }, { available: true }, null]),
    ).toEqual(['a']);
    expect(availableClients({})).toEqual([]);
  });

  it('reads doctor output, including failed checks, and rejects other shapes', () => {
    const output = JSON.stringify({
      ok: false,
      checks: [
        { name: 'config', ok: true, problems: [], warnings: ['w'] },
        { name: 'providers', ok: false, problems: ['no claude'], warnings: [] },
      ],
    });
    const checks = parseDoctorOutput(output);
    expect(checks?.map((check) => check.ok)).toEqual([true, false]);
    expect(doctorLines(checks ?? [])).toEqual([
      'ok   config',
      '     warning: w',
      'FAIL providers',
      '     problem: no claude',
    ]);
    expect(parseDoctorOutput('not json')).toBeNull();
    expect(parseDoctorOutput('{"checks":[1]}')).toBeNull();
  });
});

describe('rename', () => {
  it('passes the id and the title as separate argv values', () => {
    expect(renameArgs('3', 'A "quoted" title; rm -rf')).toEqual(['session', 'rename', '3', 'A "quoted" title; rm -rf', '--json']);
  });

  it('reads the rename result and rejects other shapes', () => {
    expect(parseRenameOutput('{"session_id":"3","title":"New","previous_title":null}')).toEqual({ sessionId: '3', title: 'New' });
    expect(parseRenameOutput('{"session_id":3,"title":"New"}')).toBeNull();
    expect(parseRenameOutput('nope')).toBeNull();
  });
});

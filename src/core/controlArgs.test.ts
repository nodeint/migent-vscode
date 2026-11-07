import { describe, expect, it } from 'vitest';

import {
  cancelArgs,
  continueArgs,
  DEFAULT_RUN_SETTINGS,
  doctorArgs,
  doctorLines,
  initArgs,
  joinProviders,
  modelsDefaultFirst,
  parseDoctorOutput,
  parsePrepared,
  prepareArgs,
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

  it('passes every init role as separate argv values and never prompts', () => {
    const role = (provider: string) => ({ provider, model: `${provider} model "x"` });
    const args = initArgs({ developer: role('d'), planner: role('p'), reviewer: role('r') });
    expect(args).toContain('--no-input');
    const planner = args.indexOf('--planner-provider');
    expect(args.slice(planner, planner + 4)).toEqual(['--planner-provider', 'p', '--planner-model', 'p model "x"']);
    const developer = args.indexOf('--provider');
    expect(args.slice(developer, developer + 4)).toEqual(['--provider', 'd', '--model', 'd model "x"']);
  });

  it('joins providers with their default client models and drops the rest', () => {
    const providers = [
      { kind: 'provider', name: 'claude', default_client: 'claude-code', requires_client: false },
      { kind: 'provider', name: 'codex', default_client: 'codex', requires_client: false },
      { kind: 'provider', name: 'byteplus', default_client: null, requires_client: true },
      { kind: 'provider', name: 'grok', default_client: 'grok', requires_client: false },
      'junk',
    ];
    const models = [
      { kind: 'model', name: 'sonnet', client: 'claude-code', default: false },
      { kind: 'model', name: 'opus', client: 'claude-code', default: true },
      { kind: 'model', name: 'opus', client: 'other', default: true },
      { kind: 'model', name: 'gpt', client: 'codex', default: false },
      { kind: 'model', name: 'ark', client: 'byteplus', default: true },
      { kind: 'model', client: 'grok' },
      null,
    ];
    expect(joinProviders(providers, models)).toEqual([
      { name: 'claude', models: ['sonnet', 'opus'], defaultModel: 'opus' },
      { name: 'codex', models: ['gpt'] },
    ]);
    expect(joinProviders('nope', models)).toEqual([]);
    expect(joinProviders(providers, {})).toEqual([]);
  });

  it('lists the default model first', () => {
    const [choice] = joinProviders(
      [{ name: 'a', default_client: 'c', requires_client: false }],
      [
        { name: 'm1', client: 'c', default: false },
        { name: 'm2', client: 'c', default: true },
        { name: 'm3', client: 'c', default: false },
      ],
    );
    expect(modelsDefaultFirst(choice)).toEqual(['m2', 'm1', 'm3']);
    expect(modelsDefaultFirst({ name: 'a', models: ['m1'], defaultModel: 'gone' })).toEqual(['m1']);
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

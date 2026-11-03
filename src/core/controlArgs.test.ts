import { describe, expect, it } from 'vitest';

import {
  cancelArgs,
  continueArgs,
  DEFAULT_RUN_SETTINGS,
  parsePrepared,
  prepareArgs,
  regenerateNextArgs,
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
    expect(regenerateNextArgs('src')).toEqual(['session', 'continue', 'src']);
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

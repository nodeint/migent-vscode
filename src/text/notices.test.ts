import { describe, expect, it } from 'vitest';

import { LABELS, type NoticeId, NOTICES, PROGRESS_MESSAGES } from './notices';

/**
 * The behavior pin for the catalog: today's literal wording, severity, buttons (in order), modal detail and progress
 * options of every id, written from the strings the call sites showed before the catalog existed. `Record<NoticeId,
 * ...>` makes a new id fail the typecheck until it is pinned here.
 */
interface Pin {
  params?: unknown;
  /** Toast and confirmation text, or the progress title. */
  text: string;
  /** More inputs for the same entry, each with the text it must give. */
  also?: [params: unknown, text: string][];
  severity?: 'info' | 'warning' | 'error';
  buttons?: string[];
  detail?: string;
  location?: 'window' | 'notification';
  isCancellable?: boolean;
}

const L = { label: 'S' };
const D = { detail: 'd' };
const M = { message: 'm' };
const FIX_LOG = 'View log';

const PINS: Record<NoticeId, Pin> = {
  'notify.completed': { params: L, text: 'Session S completed.', severity: 'info', buttons: ['Open overview'] },
  'notify.blocked': {
    params: { label: 'S', stage: 'plan' },
    text: 'Session S: plan is blocked and needs a reply.',
    severity: 'warning',
    buttons: ['Reply'],
  },
  'notify.failed': {
    params: { label: 'S', where: 'build attempt 2', cause: 'boom', quota: null },
    text: 'Session S failed (build attempt 2). boom',
    also: [
      [{ label: 'S', where: '', cause: null, quota: null }, 'Session S failed. The cause is in the response or log.'],
      [
        { label: 'S', where: 'plan', cause: 'x', quota: { reset: 'no reset time was recorded' } },
        'Session S failed (plan). Client quota was exhausted; no reset time was recorded. Continue reruns the stage.',
      ],
    ],
    severity: 'error',
    buttons: ['Continue', 'Open failure report', 'Open verify', 'Open response', 'Open handoff', FIX_LOG],
  },
  'notify.questions': {
    params: { label: 'S', stage: 'plan', count: 2 },
    text: 'Session S: plan is waiting for 2 answers.',
    also: [[{ label: 'S', stage: 'a role', count: 1 }, 'Session S: a role is waiting for 1 answer.']],
    severity: 'info',
    buttons: ['Answer questions'],
  },
  'control.writeBlocked': {
    params: { message: 'blocked because' },
    text: 'blocked because',
    severity: 'warning',
    buttons: ['Recheck', 'Refresh', FIX_LOG],
  },
  'control.stopNotConfirmed': {
    params: { detail: null },
    text: 'Stop not confirmed. The session may still be running.',
    also: [[{ detail: 'refused: still running' }, 'refused: still running']],
    severity: 'warning',
    buttons: ['Refresh', FIX_LOG],
  },
  'control.statusNotConfirmed': { text: 'Status not confirmed.', severity: 'warning', buttons: ['Refresh', FIX_LOG] },
  'control.completedWithWarnings': {
    params: { label: 'S', warnings: 'w' },
    text: 'Completed S with warnings: w',
    severity: 'warning',
    buttons: [FIX_LOG],
  },
  'control.prepareFailed': { params: D, text: 'Could not prepare the session: d', severity: 'error' },
  'control.prepareUnexpected': {
    text: 'Could not prepare the session: unexpected CLI output.',
    severity: 'error',
  },
  'control.taskNotWritten': {
    params: D,
    text: 'The session was prepared but task.md was not written: d',
    severity: 'error',
  },
  'control.spawnFailed': { params: D, text: 'Could not start the Migent CLI: d', severity: 'error' },
  'control.repairFailed': {
    params: D,
    text: 'Could not repair the session: d',
    severity: 'error',
    buttons: [FIX_LOG],
  },
  'control.completeFailed': {
    params: D,
    text: 'Could not complete the session: d',
    severity: 'error',
    buttons: [FIX_LOG],
  },
  'control.renameFailed': {
    params: D,
    text: 'Could not rename the session: d',
    severity: 'error',
    buttons: [FIX_LOG],
  },
  'control.doctorFailed': { params: D, text: 'Doctor could not run: d', severity: 'error', buttons: [FIX_LOG] },
  'control.workflowChanged': {
    text:
      'The workflow changed since this session started. Continue resets revision counts. ' +
      'Choose which definition to use.',
    severity: 'warning',
    buttons: ['View changes', 'Use session version', 'Use updated workflow'],
  },
  'control.repairing': { params: L, text: 'Repairing S', location: 'window', isCancellable: false },
  'control.completing': { params: L, text: 'Completing S', location: 'window', isCancellable: false },
  'control.renaming': { params: L, text: 'Renaming S', location: 'window', isCancellable: false },
  'control.stopping': { params: L, text: 'Stopping S', location: 'window', isCancellable: false },
  'control.doctorRunning': { text: 'Running Migent doctor', location: 'window', isCancellable: false },
  'control.running': {
    params: { title: 'Run' },
    text: 'Run — continues after closing VS Code',
    location: 'window',
    isCancellable: false,
  },
  'control.noTaskSaved': { text: 'The task.md file was not saved, so the session was not started.', severity: 'error' },
  'control.taskEmpty': { text: 'The task.md file is empty. Write the task, then run again.', severity: 'error' },
  'control.workflowNotSaved': { text: 'The workflow was not saved, so it was not run.', severity: 'error' },
  'control.workflowInvalid': {
    params: { error: null },
    text: 'This workflow is not valid, so it cannot be run.',
    also: [[{ error: 'bad yaml' }, 'bad yaml']],
    severity: 'error',
  },
  'control.draftUnsaved': {
    text:
      'The session workflow.yaml has unsaved changes, so the session was not started. ' +
      'Save it, or discard the changes, then run again.',
    severity: 'error',
  },
  'control.noWorkflowRecorded': { text: 'The session does not record which workflow to run.', severity: 'error' },
  'command.failed': { params: M, text: 'm', severity: 'error', buttons: ['Open workflow.yaml', FIX_LOG] },
  'reply.draftFailed': { params: D, text: 'Could not create the reply draft: d', severity: 'error' },
  'reply.statusNotConfirmed': {
    text: 'Status not confirmed. Your draft was kept.',
    severity: 'warning',
    buttons: ['Refresh', 'Stop waiting', FIX_LOG],
  },
  'reply.blocked': { params: { reason: 'r' }, text: 'r', severity: 'warning', buttons: [FIX_LOG] },
  'reply.sendFailed': {
    params: { detail: 'x.' },
    text: 'Could not send the reply: x. Your draft was kept.',
    severity: 'warning',
    buttons: [FIX_LOG],
  },
  'reply.sending': { text: 'Sending reply', location: 'notification', isCancellable: false },
  'reply.discardConfirm': {
    text: 'Discard this reply draft? The text is deleted.',
    buttons: ['Discard reply'],
  },
  'reply.continueWithoutConfirm': {
    params: L,
    text: 'Continue S without a reply? The agent is told to continue with the blocker unanswered.',
    buttons: ['Continue without reply'],
  },
  'reply.repairConfirm': {
    params: L,
    text: 'Repair S? This rebuilds status.json from the session directory.',
    buttons: ['Repair'],
  },
  'reply.completeConfirm': {
    params: L,
    text: 'Complete S? No further stage runs, and its outputs are published as they are.',
    buttons: ['Complete'],
  },
  'file.notFound': { params: { what: 'Output', file: '/f' }, text: 'Could not find Output: /f', severity: 'warning' },
  'session.outputNotFound': { params: { name: 'n' }, text: 'Output not found: n', severity: 'warning' },
  'session.handoffNotFound': { params: { name: 'n' }, text: 'Handoff file not found: n', severity: 'warning' },
  'session.workflowNotFound': {
    params: { workflow: 'w' },
    text: 'No workflow with id w in this project.',
    severity: 'warning',
  },
  'session.copyUnavailable': { text: 'This value is no longer available to copy.', severity: 'warning' },
  'draft.missing': { text: 'This session no longer has a workflow.yaml.', severity: 'warning' },
  'draft.openFailed': { params: D, text: 'Could not open workflow.yaml: d', severity: 'error' },
  'draft.prepared': {
    text: 'Session prepared. Its workflow can be edited before it runs.',
    severity: 'info',
    buttons: ['Open workflow.yaml'],
  },
  'deleteSession.confirm': {
    params: L,
    text: 'Delete session S?',
    detail: 'The session folder and its contents will be deleted. VS Code uses the trash when available.',
    buttons: ['Delete'],
  },
  'deleteSession.busy': { text: 'Cannot delete a session while an operation is in progress.', severity: 'error' },
  'deleteSession.running': { text: 'Cannot delete a running session. Stop it first.', severity: 'error' },
  'deleteSession.failed': { params: D, text: 'Could not delete session: d', severity: 'error' },
  'workflow.duplicateFailed': { params: M, text: 'Workflow not duplicated. m', severity: 'error' },
  'workflow.deleteConfirm': {
    params: { file: 'a.yaml' },
    text: 'Delete workflow a.yaml?',
    detail: 'The file is moved to the Trash. Existing sessions keep their own frozen copy.',
    buttons: ['Move to Trash'],
  },
  'workflow.deleteFailed': { params: D, text: 'Workflow not deleted. d', severity: 'error' },
  'workflow.saveFailed': { params: M, text: 'Workflow not saved. m', severity: 'error' },
  'config.saveFailed': { params: M, text: 'Configuration not saved. m', severity: 'error' },
  'questions.discardConfirm': {
    text: 'Discard the saved answers for this batch?',
    buttons: ['Discard draft'],
  },
  'init.cliUnavailable': {
    params: { kind: 'old' },
    text: 'The Migent CLI is unavailable (old).',
    severity: 'warning',
    buttons: ['Recheck', 'Install Migent CLI', 'Update Migent CLI'],
  },
  'init.noClients': {
    text: 'No client with models is available. Install an agent CLI first.',
    severity: 'error',
  },
  'init.running': { text: 'Initializing Migent', location: 'notification', isCancellable: false },
  'init.failed': { params: D, text: 'Could not initialize Migent: d', severity: 'error' },
  'init.done': {
    params: { name: 'f' },
    text: 'Initialized Migent in f.',
    severity: 'info',
    buttons: ['Run workflow'],
  },
  'init.loadingClients': { text: 'Migent: loading clients…', location: 'notification', isCancellable: true },
  'install.waiting': {
    text: 'Installing the Migent CLI in the terminal. Use Recheck if this does not update by itself.',
    severity: 'info',
    buttons: ['Recheck'],
  },
  'install.ready': { params: M, text: 'm', severity: 'info', buttons: ['Initialize project'] },
  'install.failed': { params: M, text: 'm', severity: 'error' },
  'install.notReady': { params: M, text: 'm', severity: 'warning', buttons: ['Recheck'] },
  'nextStep.projectClosed': { text: 'The project is no longer open.', severity: 'error' },
  'nextStep.blocked': {
    params: { workflow: 'w', reason: 'r' },
    text: 'Next step w: r',
    severity: 'warning',
  },
  'nextStep.resolveBlocked': { params: { reason: 'r' }, text: 'r', severity: 'warning' },
  'nextStep.notSaved': { text: 'The workflow was not saved, so it was not started.', severity: 'warning' },
};

interface Loose {
  kind: string;
  severity?: string;
  text?(params: unknown): string;
  title?(params: unknown): string;
  detail?(params: unknown): string;
  actions?: readonly (keyof typeof LABELS)[];
  action?: keyof typeof LABELS;
  location?: string;
  isCancellable?: boolean;
}

const ids = Object.keys(PINS) as NoticeId[];

describe('notice catalog pins today\'s behavior', () => {
  it('pins every id and nothing else', () => {
    expect([...ids].sort()).toEqual(Object.keys(NOTICES).sort());
  });

  it.each(ids)('%s', (id) => {
    const pin = PINS[id];
    const entry: Loose = NOTICES[id];
    const render = entry.kind === 'progress' ? entry.title : entry.text;
    expect(render?.(pin.params)).toBe(pin.text);
    for (const [params, text] of pin.also ?? []) expect(render?.(params)).toBe(text);
    if (entry.kind === 'toast') expect(entry.severity).toBe(pin.severity);
    if (entry.kind === 'confirm') {
      expect(entry.detail?.(pin.params)).toBe(pin.detail);
      expect([LABELS[entry.action ?? 'continue']]).toEqual(pin.buttons);
    } else if (entry.kind === 'toast') {
      expect((entry.actions ?? []).map((key) => LABELS[key])).toEqual(pin.buttons ?? []);
    } else {
      expect(entry.location).toBe(pin.location);
      expect(entry.isCancellable).toBe(pin.isCancellable);
    }
  });

  it('pins the progress messages tasks report', () => {
    expect(PROGRESS_MESSAGES).toEqual({
      stopSending: 'Sending stop request…',
      stopWaiting: 'Waiting for session to stop…',
      replyApplying: 'Migent is applying the reply…',
      replyReceived: 'Reply received',
      replyWaiting: 'Waiting for the stage to resume…',
    });
  });

  it('defines every shared label once', () => {
    const labels = Object.values(LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

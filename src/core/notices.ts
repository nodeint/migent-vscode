import { describeQuotaReset, type QuotaFailure } from './replyFlow';
import { describeBlock, type WriteBlock } from './writeEligibility';

/**
 * The one catalog of notifications the extension shows (toasts, modal confirmations and progress titles). Every
 * entry has a stable id, a severity, its text as a function of typed params, and its buttons as action keys mapped
 * to labels. Callers name an id and its params and receive an action key back, never a label. No `vscode` import;
 * `src/vscode/notices.ts` is the only code that calls the notification API.
 */

/** Button labels used by more than one notification, or by one notification at several call sites. */
export const LABELS = {
  viewLog: 'View log',
  recheck: 'Recheck',
  refresh: 'Refresh',
  continue: 'Continue',
  delete: 'Delete',
  reply: 'Reply',
  stopWaiting: 'Stop waiting',
  openDraft: 'Open workflow.yaml',
  openOverview: 'Open overview',
  answerQuestions: 'Answer questions',
  failureReport: 'Open failure report',
  openVerify: 'Open verify',
  openResponse: 'Open response',
  openHandoff: 'Open handoff',
  initializeProject: 'Initialize project',
  runWorkflow: 'Run workflow',
  installCli: 'Install Migent CLI',
  updateCli: 'Update Migent CLI',
  viewChanges: 'View changes',
  keepSession: 'Use session version',
  adoptUpdated: 'Use updated workflow',
  moveToTrash: 'Move to Trash',
  discardReply: 'Discard reply',
  discardDraft: 'Discard draft',
  continueWithoutReply: 'Continue without reply',
  repair: 'Repair',
  complete: 'Complete',
} as const;

export type ActionKey = keyof typeof LABELS;

export type Severity = 'info' | 'warning' | 'error';

/** Ordered action keys of an entry; labels come from `LABELS`, so a label is defined once. */
function keys<const K extends ActionKey>(...actions: K[]): readonly K[] {
  return actions;
}

export interface ToastNotice<P, K extends ActionKey> {
  kind: 'toast';
  severity: Severity;
  text: (params: P) => string;
  actions: readonly K[];
}

export interface ConfirmNotice<P> {
  kind: 'confirm';
  text: (params: P) => string;
  detail?: (params: P) => string;
  /** The one confirming action; the dialog's own Cancel is not an action of the entry. */
  action: ActionKey;
}

export interface ProgressNotice<P> {
  kind: 'progress';
  location: 'window' | 'notification';
  isCancellable: boolean;
  title: (params: P) => string;
}

function toast<P, K extends ActionKey = never>(
  severity: Severity,
  text: (params: P) => string,
  actions: readonly K[] = [],
): ToastNotice<P, K> {
  return { kind: 'toast', severity, text, actions };
}

function confirm<P>(
  text: (params: P) => string,
  action: ActionKey,
  detail?: (params: P) => string,
): ConfirmNotice<P> {
  return { kind: 'confirm', text, detail, action };
}

function progress<P>(
  location: 'window' | 'notification',
  title: (params: P) => string,
  isCancellable = false,
): ProgressNotice<P> {
  return { kind: 'progress', location, isCancellable, title };
}

interface Label {
  label: string;
}
interface Detail {
  detail: string;
}
interface Message {
  message: string;
}

export interface FailureParams {
  label: string;
  /** Stage and attempt, already joined; empty when unknown. */
  where: string;
  /** The recorded cause, or null for the generic sentence. */
  cause: string | null;
  quota: QuotaFailure | null;
}

const STOP_NOT_CONFIRMED = 'Stop not confirmed. The session may still be running.';
const WORKFLOW_INVALID = 'This workflow is not valid, so it cannot be run.';
const NO_CAUSE = 'The cause is in the response or log.';

function quotaCause(quota: QuotaFailure): string {
  return `Client quota was exhausted; ${describeQuotaReset(quota)}. Continue reruns the stage.`;
}

export const NOTICES = {
  // State notifications
  'notify.completed': toast('info', ({ label }: Label) => `Session ${label} completed.`, keys('openOverview')),
  'notify.blocked': toast('warning', ({ label, stage }: Label & { stage: string }) => `Session ${label}: ${stage} is blocked and needs a reply.`, keys('reply')),
  'notify.failed': toast(
    'error',
    ({ label, where, cause, quota }: FailureParams) => {
      const reason = quota === null ? (cause ?? NO_CAUSE) : quotaCause(quota);
      return `Session ${label} failed${where === '' ? '' : ` (${where})`}. ${reason}`;
    },
    keys('continue', 'failureReport', 'openVerify', 'openResponse', 'openHandoff', 'viewLog'),
  ),
  'notify.questions': toast(
    'info',
    ({ label, stage, count }: Label & { stage: string; count: number }) =>
      `Session ${label}: ${stage} is waiting for ${count} answer${count === 1 ? '' : 's'}.`,
    keys('answerQuestions'),
  ),

  // Control
  'control.writeBlocked': toast('warning', ({ block }: { block: WriteBlock }) => describeBlock(block), keys('recheck', 'refresh', 'viewLog')),
  'control.stopNotConfirmed': toast(
    'warning',
    ({ detail }: { detail: string | null }) => detail ?? STOP_NOT_CONFIRMED,
    keys('refresh', 'viewLog'),
  ),
  'control.statusNotConfirmed': toast('warning', () => 'Status not confirmed.', keys('refresh', 'viewLog')),
  'control.completedWithWarnings': toast(
    'warning',
    ({ label, warnings }: Label & { warnings: string }) => `Completed ${label} with warnings: ${warnings}`,
    keys('viewLog'),
  ),
  'control.prepareFailed': toast('error', ({ detail }: Detail) => `Could not prepare the session: ${detail}`),
  'control.prepareUnexpected': toast('error', () => 'Could not prepare the session: unexpected CLI output.'),
  'control.taskNotWritten': toast('error', ({ detail }: Detail) => `The session was prepared but task.md was not written: ${detail}`),
  'control.spawnFailed': toast('error', ({ detail }: Detail) => `Could not start the Migent CLI: ${detail}`),
  'control.repairFailed': toast('error', ({ detail }: Detail) => `Could not repair the session: ${detail}`, keys('viewLog')),
  'control.completeFailed': toast('error', ({ detail }: Detail) => `Could not complete the session: ${detail}`, keys('viewLog')),
  'control.renameFailed': toast('error', ({ detail }: Detail) => `Could not rename the session: ${detail}`, keys('viewLog')),
  'control.doctorFailed': toast('error', ({ detail }: Detail) => `Doctor could not run: ${detail}`, keys('viewLog')),
  'control.workflowChanged': toast(
    'warning',
    () =>
      'The workflow changed since this session started. Continue resets revision counts. ' +
      'Choose which definition to use.',
    keys('viewChanges', 'keepSession', 'adoptUpdated'),
  ),
  'control.repairing': progress('window', ({ label }: Label) => `Repairing ${label}`),
  'control.completing': progress('window', ({ label }: Label) => `Completing ${label}`),
  'control.renaming': progress('window', ({ label }: Label) => `Renaming ${label}`),
  'control.stopping': progress('window', ({ label }: Label) => `Stopping ${label}`),
  'control.doctorRunning': progress('window', () => 'Running Migent doctor'),
  'control.running': progress('window', ({ title }: { title: string }) => `${title} — continues after closing VS Code`),
  'control.noTaskSaved': toast('error', () => 'The task.md file was not saved, so the session was not started.'),
  'control.taskEmpty': toast('error', () => 'The task.md file is empty. Write the task, then run again.'),
  'control.workflowNotSaved': toast('error', () => 'The workflow was not saved, so it was not run.'),
  'control.workflowInvalid': toast(
    'error',
    ({ error }: { error: string | null }) => error ?? WORKFLOW_INVALID,
  ),
  'control.draftUnsaved': toast(
    'error',
    () =>
      'The session workflow.yaml has unsaved changes, so the session was not started. ' +
      'Save it, or discard the changes, then run again.',
  ),
  'control.noWorkflowRecorded': toast('error', () => 'The session does not record which workflow to run.'),
  'command.failed': toast('error', ({ message }: Message) => message, keys('openDraft', 'viewLog')),

  // Reply
  'reply.draftFailed': toast('error', ({ detail }: Detail) => `Could not create the reply draft: ${detail}`),
  'reply.statusNotConfirmed': toast('warning', () => 'Status not confirmed. Your draft was kept.', keys('refresh', 'stopWaiting', 'viewLog')),
  'reply.blocked': toast('warning', ({ reason }: { reason: string }) => reason, keys('viewLog')),
  'reply.sendFailed': toast('warning', ({ detail }: Detail) => `Could not send the reply: ${detail} Your draft was kept.`, keys('viewLog')),
  'reply.sending': progress('notification', () => 'Sending reply'),
  'reply.discardConfirm': confirm(() => 'Discard this reply draft? The text is deleted.', 'discardReply'),
  'reply.continueWithoutConfirm': confirm(
    ({ label }: Label) => `Continue ${label} without a reply? The agent is told to continue with the blocker unanswered.`,
    'continueWithoutReply',
  ),
  'reply.repairConfirm': confirm(
    ({ label }: Label) => `Repair ${label}? This rebuilds status.json from the session directory.`,
    'repair',
  ),
  'reply.completeConfirm': confirm(
    ({ label }: Label) => `Complete ${label}? No further stage runs, and its outputs are published as they are.`,
    'complete',
  ),

  // Sessions and files
  'file.notFound': toast('warning', ({ what, file }: { what: string; file: string }) => `Could not find ${what}: ${file}`),
  'session.outputNotFound': toast('warning', ({ name }: { name: string }) => `Output not found: ${name}`),
  'session.handoffNotFound': toast('warning', ({ name }: { name: string }) => `Handoff file not found: ${name}`),
  'session.workflowNotFound': toast('warning', ({ workflow }: { workflow: string }) => `No workflow with id ${workflow} in this project.`),
  'draft.missing': toast('warning', () => 'This session no longer has a workflow.yaml.'),
  'draft.openFailed': toast('error', ({ detail }: Detail) => `Could not open workflow.yaml: ${detail}`),
  'draft.prepared': toast('info', () => 'Session prepared. Its workflow can be edited before it runs.', keys('openDraft')),
  'deleteSession.confirm': confirm(
    ({ label }: Label) => `Delete session ${label}?`,
    'delete',
    () => 'The session folder and its contents will be deleted. VS Code uses the trash when available.',
  ),
  'deleteSession.busy': toast('error', () => 'Cannot delete a session while an operation is in progress.'),
  'deleteSession.running': toast('error', () => 'Cannot delete a running session. Stop it first.'),
  'deleteSession.failed': toast('error', ({ detail }: Detail) => `Could not delete session: ${detail}`),

  // Workflows and configuration
  'workflow.duplicateFailed': toast('error', ({ message }: Message) => `Workflow not duplicated. ${message}`),
  'workflow.deleteConfirm': confirm(
    ({ file }: { file: string }) => `Delete workflow ${file}?`,
    'moveToTrash',
    () => 'The file is moved to the Trash. Existing sessions keep their own frozen copy.',
  ),
  'workflow.deleteFailed': toast('error', ({ detail }: Detail) => `Workflow not deleted. ${detail}`),
  'workflow.saveFailed': toast('error', ({ message }: Message) => `Workflow not saved. ${message}`),
  'config.saveFailed': toast('error', ({ message }: Message) => `Configuration not saved. ${message}`),
  'questions.discardConfirm': confirm(() => 'Discard the saved answers for this batch?', 'discardDraft'),

  // Init and CLI
  'init.cliUnavailable': toast(
    'warning',
    ({ kind }: { kind: string }) => `The Migent CLI is unavailable (${kind}).`,
    keys('recheck', 'installCli', 'updateCli'),
  ),
  'init.noClients': toast('error', () => 'No client with models is available. Install an agent CLI first.'),
  'init.running': progress('notification', () => 'Initializing Migent'),
  'init.failed': toast('error', ({ detail }: Detail) => `Could not initialize Migent: ${detail}`),
  'init.done': toast('info', ({ name }: { name: string }) => `Initialized Migent in ${name}.`, keys('runWorkflow')),
  'init.loadingClients': progress('notification', () => 'Migent: loading clients…', true),
  'install.waiting': toast(
    'info',
    () => 'Installing the Migent CLI in the terminal. Use Recheck if this does not update by itself.',
    keys('recheck'),
  ),
  'install.ready': toast('info', ({ message }: Message) => message, keys('initializeProject')),
  'install.failed': toast('error', ({ message }: Message) => message),
  'install.notReady': toast('warning', ({ message }: Message) => message, keys('recheck')),

  // Next step
  'nextStep.projectClosed': toast('error', () => 'The project is no longer open.'),
  'nextStep.blocked': toast('warning', ({ workflow, reason }: { workflow: string; reason: string }) => `Next step ${workflow}: ${reason}`),
  'nextStep.resolveBlocked': toast('warning', ({ reason }: { reason: string }) => reason),
  'nextStep.notSaved': toast('warning', () => 'The workflow was not saved, so it was not started.'),
} as const;

export type NoticeId = keyof typeof NOTICES;

/** Progress messages the task reports itself, looked up by key. */
export const PROGRESS_MESSAGES = {
  stopSending: 'Sending stop request…',
  stopWaiting: 'Waiting for session to stop…',
  replyApplying: 'Migent is applying the reply…',
  replyReceived: 'Reply received',
  replyWaiting: 'Waiting for the stage to resume…',
} as const;

type EntryParams<E> = E extends { text: (params: infer P) => string }
  ? P
  : E extends { title: (params: infer P) => string }
    ? P
    : never;

/** The params of a notice; entries whose text has no values take none. */
export type NoticeParams<Id extends NoticeId> = EntryParams<(typeof NOTICES)[Id]>;

/** The action keys a notice can offer. */
export type NoticeAction<Id extends NoticeId> = (typeof NOTICES)[Id] extends { actions: readonly (infer K)[] }
  ? K & ActionKey
  : never;


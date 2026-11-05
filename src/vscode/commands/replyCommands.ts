import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import {
  type BlockedTarget,
  blockedTargets,
  blockKind,
  describeQuotaWait,
  quotaWait,
} from '../../core/replyFlow';
import { sessionLabel } from '../../core/sessionPresentation';
import type { ControlService } from '../control';
import { pickProject } from '../pick';
import type { ProjectContext } from '../projects';
import type { ReplyService, SendResult } from '../reply';
import { chooseWorkflow, CONTINUABLE } from './controlCommands';
import { initializeProject } from './initCommand';
import { type CommandHost, resolveWith } from './sessionCommands';

const INFO_MESSAGE_MS = 5000;

const isOrdinaryBlocker = (snapshot: SessionSnapshot): boolean => blockKind(snapshot) === 'blocker';
const isQuota = (snapshot: SessionSnapshot): boolean => blockKind(snapshot) === 'quota';
/** Run next stage once: any resumable session, including an ordinary blocker; never a pending human question. */
const canRunOnce = (snapshot: SessionSnapshot): boolean =>
  blockKind(snapshot) !== 'question' && (CONTINUABLE.has(snapshot.displayState.state) || isOrdinaryBlocker(snapshot));
const isRepairable = (snapshot: SessionSnapshot): boolean => snapshot.displayState.state !== 'running';

async function pickBlocked(targets: BlockedTarget[]): Promise<BlockedTarget | undefined> {
  const [only] = targets;
  if (targets.length === 1) return only;
  const picked = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: target.stageId,
      description: `attempt ${target.attempt}`,
      detail: target.executionId,
      target,
    })),
    { title: 'Reply to which blocked stage?' },
  );
  return picked?.target;
}

/** Explain why a session has no Reply and what to use instead. */
function explainNoReply(snapshot: SessionSnapshot): void {
  const kind = blockKind(snapshot);
  const label = sessionLabel(snapshot);
  if (kind === 'question') {
    vscode.window.setStatusBarMessage(`Session ${label} is waiting for answers. Use Answer questions.`, INFO_MESSAGE_MS);
  } else if (kind === 'quota') {
    vscode.window.setStatusBarMessage(`Session ${label} is waiting for provider quota. Use Retry once the wait is over.`, INFO_MESSAGE_MS);
  } else {
    vscode.window.setStatusBarMessage(`Session ${label} is not blocked, so there is nothing to reply to.`, INFO_MESSAGE_MS);
  }
}

async function reply(host: CommandHost, replies: ReplyService, arg: unknown): Promise<void> {
  const resolved = await resolveWith(host, arg, { title: 'Reply to which session?', isEligible: isOrdinaryBlocker });
  if (resolved === undefined) return;
  const { context, snapshot } = resolved;
  const targets = blockedTargets(snapshot);
  if (targets.length === 0) {
    explainNoReply(snapshot);
    return;
  }
  // A notification names the execution it announced; otherwise the user picks among several.
  const named =
    typeof arg === 'object' && arg !== null && 'executionId' in arg
      ? targets.find((target) => target.executionId === arg.executionId)
      : undefined;
  const target = named ?? (await pickBlocked(targets));
  if (target !== undefined) await replies.open(context, snapshot, target);
}

async function sendReply(replies: ReplyService, arg: unknown): Promise<void> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const meta = uri === undefined ? undefined : replies.identityOf(uri);
  if (meta === undefined) {
    vscode.window.setStatusBarMessage('Open a Migent reply draft to send it.', INFO_MESSAGE_MS);
    return;
  }
  // The click has no other sign of life: a notification names what the send is doing until it settles. It is not
  // cancellable, because once the CLI is running a reply cannot be taken back.
  const run = async (progress: vscode.Progress<{ message?: string }>): Promise<SendResult> => {
    const onPhase = (message: string): void => progress.report({ message });
    return replies.send(meta, onPhase);
  };
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Sending reply' }, run);
  await replies.report(meta, undefined, result);
}

async function discardReply(replies: ReplyService, arg: unknown): Promise<void> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const meta = uri === undefined ? undefined : replies.identityOf(uri);
  if (meta === undefined) return;
  const picked = await vscode.window.showWarningMessage(
    'Discard this reply draft? The text is deleted.',
    { modal: true },
    'Discard reply',
  );
  if (picked === 'Discard reply') await replies.discard(meta);
}

async function continueOnce(
  control: ControlService,
  context: ProjectContext,
  snapshot: SessionSnapshot,
): Promise<void> {
  if (!canRunOnce(snapshot)) {
    vscode.window.setStatusBarMessage(`Session ${sessionLabel(snapshot)} has no stage to run once.`, INFO_MESSAGE_MS);
    return;
  }
  if (!(await control.ensureWritable(context, snapshot))) return;
  await control.continueOnce(context, snapshot);
}

async function continueWithoutReply(
  control: ControlService,
  context: ProjectContext,
  snapshot: SessionSnapshot,
): Promise<void> {
  // An unanswered human question cannot be bypassed: the CLI keeps it pending.
  if (!isOrdinaryBlocker(snapshot)) {
    explainNoReply(snapshot);
    return;
  }
  if (!(await control.ensureWritable(context, snapshot))) return;
  const picked = await vscode.window.showWarningMessage(
    `Continue ${sessionLabel(snapshot)} without a reply? The agent is told to continue with the blocker unanswered.`,
    { modal: true },
    'Continue without reply',
  );
  if (picked !== 'Continue without reply') return;
  const choice = await chooseWorkflow(control, context, snapshot);
  if (choice !== undefined) await control.continueSession(context, snapshot, choice);
}

/** Retry after a quota wait: never automatic, enabled at `retry_at` or on an explicit retry without one. */
async function retryQuota(control: ControlService, context: ProjectContext, snapshot: SessionSnapshot): Promise<void> {
  const wait = quotaWait(snapshot, Date.now());
  if (wait === null) {
    vscode.window.setStatusBarMessage(`Session ${sessionLabel(snapshot)} is not waiting for provider quota.`, INFO_MESSAGE_MS);
    return;
  }
  if (wait.retryAt !== null && !wait.isReady) {
    vscode.window.setStatusBarMessage(`Retry is available later: ${describeQuotaWait(wait, Date.now())}.`, INFO_MESSAGE_MS);
    return;
  }
  if (!(await control.ensureWritable(context, snapshot))) return;
  if (wait.retryAt === null) {
    const picked = await vscode.window.showWarningMessage(
      'No retry time was recorded for this quota wait. Retry now?',
      { modal: true },
      'Retry',
    );
    if (picked !== 'Retry') return;
  }
  const choice = await chooseWorkflow(control, context, snapshot);
  if (choice !== undefined) await control.continueSession(context, snapshot, choice);
}

async function repair(control: ControlService, context: ProjectContext, snapshot: SessionSnapshot): Promise<void> {
  if (!isRepairable(snapshot)) {
    vscode.window.setStatusBarMessage('A running session cannot be repaired. Stop it first.', INFO_MESSAGE_MS);
    return;
  }
  if (!(await control.ensureWritable(context, snapshot))) return;
  const picked = await vscode.window.showWarningMessage(
    `Repair ${sessionLabel(snapshot)}? This rebuilds status.json from the session directory.`,
    { modal: true },
    'Repair',
  );
  if (picked === 'Repair') await control.repair(context, snapshot);
}

async function runAction(
  deps: { host: CommandHost; control: ControlService },
  action: SessionAction,
  arg: unknown,
): Promise<void> {
  const resolved = await resolveWith(deps.host, arg, { title: action.title, isEligible: action.isEligible });
  if (resolved !== undefined) await action.act(deps.control, resolved.context, resolved.snapshot);
}

interface Deps {
  host: CommandHost;
  control: ControlService;
  replies: ReplyService;
}

type Act = (control: ControlService, context: ProjectContext, snapshot: SessionSnapshot) => Promise<void>;

interface SessionAction {
  id: string;
  title: string;
  isEligible: (snapshot: SessionSnapshot) => boolean;
  act: Act;
}

const SESSION_ACTIONS: readonly SessionAction[] = [
  { id: 'migent.session.continueOnce', title: 'Run the next stage of which session?', isEligible: canRunOnce, act: continueOnce },
  {
    id: 'migent.session.continueWithoutReply',
    title: 'Continue which blocked session?',
    isEligible: isOrdinaryBlocker,
    act: continueWithoutReply,
  },
  { id: 'migent.session.retryQuota', title: 'Retry which session?', isEligible: isQuota, act: retryQuota },
  { id: 'migent.session.repair', title: 'Repair which session?', isEligible: isRepairable, act: repair },
];

/** Reply, secondary actions, quota retry and Doctor. Every write goes through `ControlService`'s runner and gate. */
export function registerReplyCommands({ host, control, replies }: Deps): vscode.Disposable[] {
  const register = (id: string, run: (arg: unknown) => Promise<void>): vscode.Disposable =>
    vscode.commands.registerCommand(id, run);
  const actions: vscode.Disposable[] = [];
  for (const action of SESSION_ACTIONS) {
    actions.push(register(action.id, (arg) => runAction({ host, control }, action, arg)));
  }
  return [
    register('migent.session.reply', (arg) => reply(host, replies, arg)),
    register('migent.session.sendReply', (arg) => sendReply(replies, arg)),
    register('migent.session.discardReply', (arg) => discardReply(replies, arg)),
    ...actions,
    register('migent.init', () => initializeProject(control.gate)),
    register('migent.doctor', async () => {
      const context = await pickProject(host.registry);
      if (context !== undefined) await control.doctor(context);
    }),
  ];
}

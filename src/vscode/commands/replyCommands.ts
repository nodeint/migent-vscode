import * as vscode from 'vscode';

import { isCompletable } from '../../core/completeEligibility';
import type { SessionSnapshot } from '../../core/model';
import type { ReplyTarget } from '../../core/model';
import { blockKind, replyPrompt } from '../../core/replyFlow';
import { sessionLabel } from '../../core/sessionPresentation';
import type { CapabilityService } from '../capability';
import type { ControlService } from '../control';
import { pickProject } from '../pick';
import type { ProjectContext } from '../projects';
import type { DraftSource, ReplyService, SendResult } from '../reply';
import { chooseWorkflow, CONTINUABLE } from './controlCommands';
import { initializeProject } from './initCommand';
import { type CommandHost, resolveWith } from './sessionCommands';

const INFO_MESSAGE_MS = 5000;

const isOrdinaryBlocker = (snapshot: SessionSnapshot): boolean => blockKind(snapshot) === 'blocker';
/** Run next stage once: any resumable session, including an ordinary blocker; never a pending human question. */
const canRunOnce = (snapshot: SessionSnapshot): boolean =>
  blockKind(snapshot) !== 'question' && (CONTINUABLE.has(snapshot.displayState.state) || isOrdinaryBlocker(snapshot));
const isRepairable = (snapshot: SessionSnapshot): boolean => snapshot.displayState.state !== 'running';
const hasReplyTargets = (snapshot: SessionSnapshot): boolean => snapshot.replyTargets.length > 0;

const KIND_LABEL: Record<ReplyTarget['kind'], string> = {
  blocker: 'blocked',
  cancelled: 'interrupted',
  roleTurn: 'role turn',
};

async function pickTarget(targets: readonly ReplyTarget[]): Promise<ReplyTarget | undefined> {
  const [only] = targets;
  if (targets.length === 1) return only;
  const picked = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: target.stageId ?? target.executionId,
      description: `attempt ${target.attempt} · ${KIND_LABEL[target.kind]}`,
      detail: target.executionId,
      target,
    })),
    { title: 'Reply to which stage?' },
  );
  return picked?.target;
}

/** Explain why a session has no Reply and what to use instead. */
function explainNoReply(snapshot: SessionSnapshot): void {
  const label = sessionLabel(snapshot);
  if (blockKind(snapshot) === 'question') {
    vscode.window.setStatusBarMessage(`Session ${label} is waiting for answers. Use Answer questions.`, INFO_MESSAGE_MS);
  } else {
    vscode.window.setStatusBarMessage(`Session ${label} has nothing to reply to.`, INFO_MESSAGE_MS);
  }
}

type QuickReply = { kind: 'send'; text: string } | { kind: 'editor'; text: string };

/** The quick reply box: short text is sent as typed, and its button moves the typed text into the draft editor. */
function promptReply(prompt: string): Promise<QuickReply | undefined> {
  return new Promise((resolve) => {
    const box = vscode.window.createInputBox();
    box.title = 'Reply';
    box.prompt = prompt;
    box.placeholder = 'Write a short reply, or open the editor for a long one';
    box.ignoreFocusOut = true;
    box.buttons = [{ iconPath: new vscode.ThemeIcon('edit'), tooltip: 'Open in editor' }];
    let result: QuickReply | undefined;
    box.onDidChangeValue(() => {
      box.validationMessage = undefined;
    });
    box.onDidAccept(() => {
      if (box.value.trim() === '') {
        box.validationMessage = 'Write a reply, or open the editor.';
        return;
      }
      result = { kind: 'send', text: box.value.trim() };
      box.hide();
    });
    box.onDidTriggerButton(() => {
      result = { kind: 'editor', text: box.value.trim() };
      box.hide();
    });
    box.onDidHide(() => {
      box.dispose();
      resolve(result);
    });
    box.show();
  });
}

async function reply(host: CommandHost, replies: ReplyService, arg: unknown): Promise<void> {
  const resolved = await resolveWith(host, arg, { title: 'Reply to which session?', isEligible: hasReplyTargets });
  if (resolved === undefined) return;
  const { context, snapshot } = resolved;
  const targets = snapshot.replyTargets;
  if (targets.length === 0) {
    explainNoReply(snapshot);
    return;
  }
  // A notification names the execution it announced; otherwise the user picks among several.
  const named =
    typeof arg === 'object' && arg !== null && 'executionId' in arg
      ? targets.find((target) => target.executionId === arg.executionId)
      : undefined;
  const target = named ?? (await pickTarget(targets));
  if (target === undefined) return;
  await replyTo({ context, snapshot, target }, replies);
}

/** Quick box for new text; the editor when a draft already holds the user's text, so nothing is dropped. */
async function replyTo(source: DraftSource, replies: ReplyService): Promise<void> {
  const { context, snapshot, target } = source;
  const identity = { project: context.key, sessionId: snapshot.sessionId, executionId: target.executionId };
  if (replies.hasDraft(identity)) {
    await replies.open(source);
    return;
  }
  const entered = await promptReply(replyPrompt(target, snapshot.manifest?.role ?? null));
  if (entered === undefined) return;
  if (entered.kind === 'editor') {
    await replies.open(source, entered.text);
    return;
  }
  const meta = await replies.prepare(source, entered.text);
  if (meta !== undefined) await runSend(replies, meta);
}

async function runSend(replies: ReplyService, meta: Parameters<ReplyService['send']>[0]): Promise<void> {
  // The click has no other sign of life: a notification names what the send is doing until it settles. It is not
  // cancellable, because once the CLI is running a reply cannot be taken back.
  const run = async (progress: vscode.Progress<{ message?: string }>): Promise<SendResult> => {
    const onPhase = (message: string): void => progress.report({ message });
    return replies.send(meta, onPhase);
  };
  const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Sending reply' }, run);
  await replies.report(meta, undefined, result);
}

async function sendReply(replies: ReplyService, arg: unknown): Promise<void> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const meta = uri === undefined ? undefined : replies.identityOf(uri);
  if (meta === undefined) {
    vscode.window.setStatusBarMessage('Open a Migent reply draft to send it.', INFO_MESSAGE_MS);
    return;
  }
  await runSend(replies, meta);
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

async function complete(control: ControlService, context: ProjectContext, snapshot: SessionSnapshot): Promise<void> {
  if (!isCompletable(snapshot)) {
    vscode.window.setStatusBarMessage(`Session ${sessionLabel(snapshot)} is not a stopped workflow session, so it cannot be completed.`, INFO_MESSAGE_MS);
    return;
  }
  if (!(await control.ensureWritable(context, snapshot))) return;
  const picked = await vscode.window.showWarningMessage(
    `Complete ${sessionLabel(snapshot)}? No further stage runs, and its outputs are published as they are.`,
    { modal: true },
    'Complete',
  );
  if (picked === 'Complete') await control.complete(context, snapshot);
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
  capability: CapabilityService;
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
  { id: 'migent.session.complete', title: 'Complete which session?', isEligible: isCompletable, act: complete },
  { id: 'migent.session.repair', title: 'Repair which session?', isEligible: isRepairable, act: repair },
];

/** Reply, secondary actions and Doctor. Every write goes through `ControlService`'s runner and gate. */
export function registerReplyCommands({ host, control, replies, capability }: Deps): vscode.Disposable[] {
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
    register('migent.init', () => initializeProject(control.gate, capability)),
    register('migent.doctor', async () => {
      const context = await pickProject(host.registry);
      if (context !== undefined) await control.doctor(context);
    }),
  ];
}

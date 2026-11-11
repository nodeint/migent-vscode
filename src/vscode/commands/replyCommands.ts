import * as vscode from 'vscode';

import { isCompletable } from '../../core/completeEligibility';
import type { SessionSnapshot } from '../../core/model';
import type { ReplyTarget } from '../../core/model';
import { blockKind, replyPrompt } from '../../core/replyFlow';
import { sessionLabel, sessionTitle } from '../../core/sessionPresentation';
import { normalizeRenameTitle, validateRenameTitle } from '../../core/sessionTitle';
import { text, type TextId } from '../../text';
import type { CapabilityService } from '../capability';
import type { ControlService } from '../control';
import { confirm, progress } from '../notices';
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

const KIND_TEXT = {
  blocker: 'prompts.kindBlocked',
  cancelled: 'prompts.kindInterrupted',
  roleTurn: 'prompts.kindRoleTurn',
} as const satisfies Record<ReplyTarget['kind'], TextId>;

async function pickTarget(targets: readonly ReplyTarget[]): Promise<ReplyTarget | undefined> {
  const [only] = targets;
  if (targets.length === 1) return only;
  const picked = await vscode.window.showQuickPick(
    targets.map((target) => ({
      label: target.stageId ?? target.executionId,
      description: text('prompts.attemptKind', { attempt: target.attempt, kind: text(KIND_TEXT[target.kind]) }),
      detail: target.executionId,
      target,
    })),
    { title: text('prompts.replyWhichStage') },
  );
  return picked?.target;
}

/** Explain why a session has no Reply and what to use instead. */
function explainNoReply(snapshot: SessionSnapshot): void {
  const label = sessionLabel(snapshot);
  if (blockKind(snapshot) === 'question') {
    vscode.window.setStatusBarMessage(text('prompts.waitingForAnswers', { label }), INFO_MESSAGE_MS);
  } else {
    vscode.window.setStatusBarMessage(text('prompts.nothingToReply', { label }), INFO_MESSAGE_MS);
  }
}

type QuickReply = { kind: 'send'; text: string } | { kind: 'editor'; text: string };

/** The quick reply box: short text is sent as typed, and its button moves the typed text into the draft editor. */
function promptReply(prompt: string): Promise<QuickReply | undefined> {
  return new Promise((resolve) => {
    const box = vscode.window.createInputBox();
    box.title = text('prompts.reply');
    box.prompt = prompt;
    box.placeholder = text('prompts.replyPlaceholder');
    box.ignoreFocusOut = true;
    box.buttons = [{ iconPath: new vscode.ThemeIcon('edit'), tooltip: text('prompts.openInEditor') }];
    let result: QuickReply | undefined;
    box.onDidChangeValue(() => {
      box.validationMessage = undefined;
    });
    box.onDidAccept(() => {
      if (box.value.trim() === '') {
        box.validationMessage = text('prompts.writeReply');
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
  const resolved = await resolveWith(host, arg, { title: text('prompts.replyWhichSession'), isEligible: hasReplyTargets });
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
  const run = async (reporter: vscode.Progress<{ message?: string }>): Promise<SendResult> => {
    const onPhase = (message: string): void => reporter.report({ message });
    return replies.send(meta, onPhase);
  };
  const result = await progress('reply.sending', undefined, run);
  await replies.report(meta, undefined, result);
}

async function sendReply(replies: ReplyService, arg: unknown): Promise<void> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const meta = uri === undefined ? undefined : replies.identityOf(uri);
  if (meta === undefined) {
    vscode.window.setStatusBarMessage(text('prompts.openReplyDraft'), INFO_MESSAGE_MS);
    return;
  }
  await runSend(replies, meta);
}

async function discardReply(replies: ReplyService, arg: unknown): Promise<void> {
  const uri = arg instanceof vscode.Uri ? arg : vscode.window.activeTextEditor?.document.uri;
  const meta = uri === undefined ? undefined : replies.identityOf(uri);
  if (meta === undefined) return;
  if (await confirm('reply.discardConfirm')) await replies.discard(meta);
}

async function continueOnce(
  control: ControlService,
  context: ProjectContext,
  snapshot: SessionSnapshot,
): Promise<void> {
  if (!canRunOnce(snapshot)) {
    vscode.window.setStatusBarMessage(text('prompts.noStageOnce', { label: sessionLabel(snapshot) }), INFO_MESSAGE_MS);
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
  if (!(await confirm('reply.continueWithoutConfirm', { label: sessionLabel(snapshot) }))) return;
  const choice = await chooseWorkflow(control, context, snapshot);
  if (choice !== undefined) await control.continueSession(context, snapshot, choice);
}

async function repair(control: ControlService, context: ProjectContext, snapshot: SessionSnapshot): Promise<void> {
  if (!isRepairable(snapshot)) {
    vscode.window.setStatusBarMessage(text('prompts.stopFirst'), INFO_MESSAGE_MS);
    return;
  }
  if (!(await control.ensureWritable(context, snapshot))) return;
  if (await confirm('reply.repairConfirm', { label: sessionLabel(snapshot) })) await control.repair(context, snapshot);
}

async function complete(control: ControlService, context: ProjectContext, snapshot: SessionSnapshot): Promise<void> {
  if (!isCompletable(snapshot)) {
    vscode.window.setStatusBarMessage(text('prompts.notCompletable', { label: sessionLabel(snapshot) }), INFO_MESSAGE_MS);
    return;
  }
  if (!(await control.ensureWritable(context, snapshot))) return;
  if (await confirm('reply.completeConfirm', { label: sessionLabel(snapshot) })) await control.complete(context, snapshot);
}

async function rename(control: ControlService, context: ProjectContext, snapshot: SessionSnapshot): Promise<void> {
  if (!(await control.ensureWritable(context))) return;
  const current = sessionTitle(snapshot);
  const entered = await vscode.window.showInputBox({
    title: text('prompts.renameSession'),
    prompt: text('prompts.renamePrompt'),
    value: current,
    validateInput: (input) => validateRenameTitle(input) ?? undefined,
  });
  if (entered === undefined) return;
  const title = normalizeRenameTitle(entered);
  if (title === null || title === current) return;
  await control.rename(context, snapshot, title);
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
  { id: 'migent.session.continueOnce', title: text('prompts.runNextStageWhich'), isEligible: canRunOnce, act: continueOnce },
  {
    id: 'migent.session.continueWithoutReply',
    title: text('prompts.continueBlockedWhich'),
    isEligible: isOrdinaryBlocker,
    act: continueWithoutReply,
  },
  { id: 'migent.session.complete', title: text('prompts.completeWhich'), isEligible: isCompletable, act: complete },
  { id: 'migent.session.rename', title: text('prompts.renameWhich'), isEligible: () => true, act: rename },
  { id: 'migent.session.repair', title: text('prompts.repairWhich'), isEligible: isRepairable, act: repair },
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

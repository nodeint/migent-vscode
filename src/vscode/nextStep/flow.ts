import path from 'node:path';

import * as vscode from 'vscode';

import {
  type NextStepInput,
  previewNextStep,
  type ResolvedLaunch,
  resolveLaunch,
  storedTask,
} from '../../core/nextStep';
import { sessionDir, workflowsDir } from '../../core/paths';
import { text } from '../../text';
import type { ProjectKey } from '../changes';
import type { ControlService } from '../control';
import { askTask, askTitle, LAUNCH_MODE_ITEMS, type TaskInput, titleOf } from '../launchPrompts';
import { notify } from '../notices';
import { openFile } from '../openFile';
import type { ProjectContext, ProjectRegistry } from '../projects';
import { offerWorkflowDraft } from '../workflowDraft';

const INFO_MESSAGE_MS = 5000;

/** A next step: the source session and the target workflow it prepares. */
export interface NextStepIdentity {
  project: ProjectKey;
  sessionId: string;
  workflow: string;
}

export type LaunchMode = 'run' | 'prepare';

/** `task` defaults to the suggestion's task; `title` (Prepare only) defaults to the task's first line. */
export interface LaunchOptions {
  task?: string;
  title?: string;
}

export function isNextStepIdentity(value: unknown): value is NextStepIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const { project, sessionId, workflow } = value as Partial<NextStepIdentity>;
  return [project, sessionId, workflow].every((part) => typeof part === 'string' && part !== '');
}

type Choice = { kind: LaunchMode } | { kind: 'openSession'; sessionId: string };

interface ChoiceItem extends vscode.QuickPickItem {
  choice: Choice;
}

/** The prompts of the flow, shared with New session; replaceable so a test can answer them. */
export interface NextStepUi {
  askTask: (title: string, value: string) => Thenable<TaskInput | undefined>;
  askTitle: (title: string, value: string) => Thenable<string | undefined>;
  pick: (items: ChoiceItem[], options: vscode.QuickPickOptions) => Thenable<ChoiceItem | undefined>;
}

const vscodeUi: NextStepUi = {
  askTask,
  askTitle,
  pick: (items, options) => vscode.window.showQuickPick(items, options),
};

const TASK_PREFIX = 'migent.nextStep.task';

/**
 * The Next step flow for a Completed session's suggestion, asked the way New session asks: a quick pick for Run now,
 * Prepare or opening the target workflow, then the task (with Compose in editor) for Run now or the title for
 * Prepare. Project, source, target, argv and files are derived by the host from the identity and
 * fresh store data immediately before dispatch (plans/03b-downstream-handoff.md §5).
 */
export class NextStepFlow {
  readonly #registry: ProjectRegistry;
  readonly #control: ControlService;
  readonly #memento: vscode.Memento;
  readonly #openSession: (project: ProjectKey, sessionId: string) => void;
  /** Replaced by tests. */
  public ui: NextStepUi = vscodeUi;

  constructor(
    registry: ProjectRegistry,
    deps: {
      control: ControlService;
      memento: vscode.Memento;
      openSession: (project: ProjectKey, sessionId: string) => void;
    },
  ) {
    this.#registry = registry;
    this.#control = deps.control;
    this.#memento = deps.memento;
    this.#openSession = deps.openSession;
  }

  /** The task the user last chose for this source and target, if it differs from the suggestion. */
  public rememberedTask(identity: NextStepIdentity): string | undefined {
    return storedTask(this.#memento.get<unknown>(this.#taskKey(identity)));
  }

  #taskKey(identity: NextStepIdentity): string {
    return `${TASK_PREFIX}.${JSON.stringify([identity.project, identity.sessionId, identity.workflow])}`;
  }

  async #remember(identity: NextStepIdentity, task: string, suggested: string): Promise<void> {
    const trimmed = task.trim();
    const isDefault = trimmed === suggested;
    await this.#memento.update(this.#taskKey(identity), isDefault ? undefined : trimmed);
  }

  /** Ask for the action, then for what it needs, and carry it out. Cancelling any step ends the flow. */
  public async start(identity: NextStepIdentity): Promise<void> {
    const context = this.#registry.project(identity.project);
    if (context === undefined) {
      notify('nextStep.projectClosed');
      return;
    }
    const preview = previewNextStep(this.#inputFor(context, identity));
    if (preview.launchBlock !== null) {
      notify('nextStep.blocked', { workflow: identity.workflow, reason: preview.launchBlock });
      return;
    }
    const existing: ChoiceItem[] = preview.activeChildren.map((child) => ({
      label: text('prompts.openExisting'),
      description: text('prompts.existingDescription', { title: child.title, state: child.state }),
      choice: { kind: 'openSession', sessionId: child.sessionId },
    }));
    const modes: ChoiceItem[] = LAUNCH_MODE_ITEMS.map((item) => ({
      ...item,
      choice: { kind: item.mode },
    }));
    const picked = await this.ui.pick(
      [
        ...existing,
        ...modes,
      ],
      {
        title: text('prompts.nextStepTitle', { workflow: identity.workflow }),
        placeHolder: text('prompts.runOrPrepareFrom', { source: preview.sourceTitle }),
      },
    );
    if (picked === undefined) return;
    const { choice } = picked;
    if (choice.kind === 'openSession') this.#openSession(identity.project, choice.sessionId);
    else if (choice.kind === 'run') await this.#askRun(identity, preview.suggestedTask ?? '');
    else await this.#askPrepare(identity, preview.suggestedTask ?? '');
  }

  /** Run now: a one-line task runs; Compose in editor prepares the session and opens its `task.md`. */
  async #askRun(identity: NextStepIdentity, suggested: string): Promise<void> {
    const input = await this.ui.askTask(`${text('prompts.runNow')} ${identity.workflow}`, this.rememberedTask(identity) ?? suggested);
    if (input === undefined) return;
    if (input.text.trim().length > 0) await this.#remember(identity, input.text, suggested);
    await this.launch(identity, input.kind === 'task' ? 'run' : 'prepare', { task: input.text });
  }

  /** Prepare: a title; `task.md` starts from the remembered or suggested task. */
  async #askPrepare(identity: NextStepIdentity, suggested: string): Promise<void> {
    const task = this.rememberedTask(identity) ?? suggested;
    const title = await this.ui.askTitle(`${text('prompts.prepare')} ${identity.workflow}`, titleOf(task, text('prompts.nextStepFallbackTitle')));
    if (title === undefined) return;
    await this.launch(identity, 'prepare', { task, title });
  }

  /** Run or Prepare. */
  public async launch(identity: NextStepIdentity, mode: LaunchMode, options: LaunchOptions = {}): Promise<void> {
    const context = this.#registry.project(identity.project);
    if (context === undefined) {
      notify('nextStep.projectClosed');
      return;
    }
    if (this.#control.isDownstreamBusy(context, identity.workflow, identity.sessionId)) {
      vscode.window.setStatusBarMessage(text('prompts.starting', { workflow: identity.workflow }), INFO_MESSAGE_MS);
      return;
    }
    const requested = options.task ?? previewNextStep(this.#inputFor(context, identity)).suggestedTask ?? '';
    const launch = await this.#prepareLaunch(context, identity, { mode, task: requested });
    if (launch === undefined) return;
    await (mode === 'run' ? this.#run(context, launch) : this.#prepare(context, launch, options.title));
  }

  /** Validate and save the target workflow; every failure is shown as a message. */
  async #prepareLaunch(
    context: ProjectContext,
    identity: NextStepIdentity,
    request: { mode: LaunchMode; task: string },
  ): Promise<ResolvedLaunch | undefined> {
    // Re-resolve everything from the identity immediately before dispatch.
    const resolved = resolveLaunch(this.#inputFor(context, identity), request.task, { allowEmpty: request.mode === 'prepare' });
    if (resolved.kind === 'blocked') {
      notify('nextStep.resolveBlocked', { reason: resolved.reason });
      return undefined;
    }
    if (!(await this.#saveTargetWorkflow(context, resolved.launch))) {
      notify('nextStep.notSaved');
      return undefined;
    }
    // Saving may have changed the target: resolve once more, so the launch matches the saved file.
    context.catalog.reloadWorkflow(resolved.launch.workflowFile);
    const fresh = resolveLaunch(this.#inputFor(context, identity), resolved.launch.taskText, {
      allowEmpty: request.mode === 'prepare',
    });
    if (fresh.kind === 'blocked') {
      notify('nextStep.resolveBlocked', { reason: fresh.reason });
      return undefined;
    }
    return fresh.launch;
  }

  async #run(context: ProjectContext, launch: ResolvedLaunch): Promise<void> {
    await this.#control.runDownstream(context, {
      workflowId: launch.workflowId,
      priorSessionId: launch.priorSessionId,
      task: launch.task,
    });
  }

  async #prepare(context: ProjectContext, launch: ResolvedLaunch, title?: string): Promise<void> {
    const prepared = await this.#control.prepare(context, {
      workflowId: launch.workflowId,
      priorSessionId: launch.priorSessionId,
      title: title ?? titleOf(launch.taskText, text('prompts.nextStepFallbackTitle')),
      taskText: launch.taskText,
    });
    if (prepared === undefined) return;
    await openFile(prepared.taskFile, 'task.md');
    offerWorkflowDraft(context, prepared);
  }

  /** Save the dirty target workflow document of this launch only; never Save All. */
  async #saveTargetWorkflow(context: ProjectContext, launch: ResolvedLaunch): Promise<boolean> {
    const file = path.join(workflowsDir(context.root), launch.workflowFile);
    const document = vscode.workspace.textDocuments.find((open) => open.uri.fsPath === file);
    return document?.isDirty !== true || (await document.save());
  }

  #inputFor(context: ProjectContext, identity: NextStepIdentity): NextStepInput {
    return {
      sourceId: identity.sessionId,
      sessionDirPath: sessionDir(context.root, identity.sessionId),
      snapshots: context.store.all(),
      workflows: context.catalog.workflows().entries,
      targetWorkflow: identity.workflow,
    };
  }
}

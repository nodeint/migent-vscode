import type { SessionWorkflowModel } from '../../core/sessionWorkflow';
import {
  duplicateArtifactProblem,
  workflowDraftFromForm,
  type WorkflowForm,
  workflowFormFromClient,
} from '../../core/workflowEditor';
import { text } from '../../text';
import {
  EMPTY_VALIDATION,
  runAuthoringSave,
  type SaveOutcome,
  splitDiagnostics,
  usableLaunch,
} from '../authoringSave';
import type { CapabilityService } from '../capability';
import { notify } from '../notices';
import type { ProjectRegistry } from '../projects';
import { type Entry, type Transient, transient } from './entry';


export interface SaveRequest {
  rawForm: unknown;
  baseHash: string;
}

/** What the saver needs from the Session panel set. */
export interface WorkflowSaverHost {
  registry: ProjectRegistry;
  capability: CapabilityService;
  isCurrent: (entry: Entry) => boolean;
  /** Repost the workflow tab from disk, with an optional transient save state. */
  send: (entry: Entry, state?: Transient) => void;
  /** Repost the last shown workflow model with the current diagnostics and a transient state. */
  publishLast: (entry: Entry, state: Transient) => void;
}

function saveRefusal(model: SessionWorkflowModel | null, form: WorkflowForm): string | null {
  if (model === null || model.isLocked) return text('prompts.workflowLocked');
  if (!model.canSave) return text('prompts.workflowUnsavable');
  return duplicateArtifactProblem(form);
}

function notifySaveFailed(message: string): void {
  notify('workflow.saveFailed', { message });
}

function saveArgs(sessionId: string, baseHash: string): string[] {
  return [
    'workflow',
    'save',
    '-',
    '--session',
    sessionId,
    '--format',
    'yaml',
    '--base-hash',
    baseHash,
    '--preserve-comments',
    '--json',
  ];
}

/** Saves the session's `workflow.yaml` through the CLI, one save at a time, and reports the diagnostics. */
export class WorkflowSaver {
  readonly #host: WorkflowSaverHost;

  constructor(host: WorkflowSaverHost) {
    this.#host = host;
  }

  public async save(entry: Entry, request: SaveRequest): Promise<void> {
    if (!entry.beginSave()) return;
    try {
      await this.#run(entry, request);
    } finally {
      entry.endSave();
    }
  }

  async #run(entry: Entry, request: SaveRequest): Promise<void> {
    const context = this.#host.registry.project(entry.project);
    if (context === undefined) {
      this.#fail(entry, text('prompts.projectGone'));
      return;
    }
    const form = workflowFormFromClient(request.rawForm);
    const current = this.#workflowOf(entry);
    const refusal = saveRefusal(current, form);
    if (refusal !== null) {
      this.#fail(entry, refusal);
      return;
    }
    const launched = await usableLaunch(this.#host.capability, entry.project);
    if ('message' in launched) {
      this.#fail(entry, launched.message);
      return;
    }
    this.#host.publishLast(entry, transient(null, true));
    const outcome = await runAuthoringSave(launched.launch, saveArgs(entry.sessionId, request.baseHash), {
      cwd: context.root,
      input: workflowDraftFromForm(form, current?.schemaVersion ?? null),
    });
    if (!this.#host.isCurrent(entry)) return;
    this.#settle(entry, outcome);
  }

  #settle(entry: Entry, outcome: SaveOutcome): void {
    switch (outcome.kind) {
      case 'written':
        entry.setValidation(splitDiagnostics(outcome.envelope.diagnostics), outcome.envelope.hash);
        this.#host.send(entry, transient(null));
        return;
      case 'unconfirmed':
        this.#fail(entry, text('prompts.saveNotConfirmed'));
        return;
      case 'conflict':
        entry.setValidation(splitDiagnostics(outcome.envelope.diagnostics), this.#workflowOf(entry)?.savedHash ?? null);
        notifySaveFailed(text('prompts.fileChanged'));
        this.#host.publishLast(entry, transient(text('prompts.fileChanged')));
        return;
      case 'invalid': {
        entry.setValidation(splitDiagnostics(outcome.envelope.diagnostics), this.#workflowOf(entry)?.savedHash ?? null);
        const count = entry.validation.errors.length;
        notifySaveFailed(text('states.problemsFound', { count }));
        this.#host.publishLast(entry, transient(null));
        return;
      }
      case 'failed':
        this.#fail(entry, outcome.message);
    }
  }

  #workflowOf(entry: Entry): SessionWorkflowModel | null {
    return entry.lastModel?.tab === 'workflow' ? entry.lastModel.workflow : null;
  }

  #fail(entry: Entry, message: string): void {
    notifySaveFailed(message);
    entry.setValidation(EMPTY_VALIDATION, null);
    this.#host.publishLast(entry, transient(message));
  }
}

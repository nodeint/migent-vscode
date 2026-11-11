import * as vscode from 'vscode';

import type { SessionSnapshot } from '../core/model';
import { NotificationGate } from '../core/notificationGate';
import { sessionDir } from '../core/paths';
import { quotaFailure } from '../core/replyFlow';
import { sessionLabel } from '../core/sessionPresentation';
import {
  currentTransition,
  type FailureActionKey,
  failureButtons,
  type FailureDetails,
  failureDetails,
  type Transition,
  TransitionTracker,
} from '../core/transitions';
import type { MigentChange } from './changes';
import { show } from './notices';
import type { ProjectRegistry } from './projects';

interface SessionTarget {
  project: string;
  sessionId: string;
}

/** Shows one notification, built from the session's state at the moment it is shown, and acts on the pick. */
type Spec = () => Promise<void>;

/** Builds a notification from current state; null when it no longer applies. */
type Build = () => Spec | null;

interface FailureAction {
  target: SessionTarget;
  executionId: string | null;
  failureReport: string | null;
  file: FailureDetails['file'];
}

/** Run the failure notification button the user picked; each button names its own target. */
function actOnFailure(picked: FailureActionKey, action: FailureAction): void {
  if (picked === 'continue') {
    void vscode.commands.executeCommand('migent.session.continue', action.target);
  } else if (picked === 'viewLog') {
    void vscode.commands.executeCommand('migent.session.showLog', action.target);
  } else if (picked === 'failureReport') {
    if (action.failureReport !== null) {
      void vscode.commands.executeCommand('migent.session.openFailure', {
        ...action.target,
        executionId: action.executionId,
      });
    }
  } else if (action.file !== null) {
    void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(action.file.absolutePath));
  }
}

function failureWhere(details: FailureDetails | undefined, snapshot: SessionSnapshot): string {
  const attempt = details?.attempt ?? null;
  const parts = [details?.stageId ?? snapshot.status?.latestStageId, attempt === null ? null : `attempt ${attempt}`];
  return parts.filter((part): part is string => typeof part === 'string').join(' ');
}

/**
 * State-transition notifications for Blocked, Failed and Completed sessions
 * (plans/03c-reply-notifications.md §3-4). Only transitions observed after activation notify: whatever exists at
 * startup, refresh or project discovery is recorded silently, so a reload never replays old notifications. Each
 * `(session, execution, kind)` notifies once, and a session shows one notification at a time: later ones queue
 * (latest wins) and are built from fresh state when the open one is dismissed. One session never affects another.
 * A notification opens nothing by itself; its buttons act on the session it captured.
 */
export class StateNotifier implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #tracker = new TransitionTracker();
  readonly #gate = new NotificationGate<Build>();
  readonly #subscription: vscode.Disposable;

  constructor(registry: ProjectRegistry) {
    this.#registry = registry;
    this.#subscription = registry.onDidChange((change) => {
      this.#onChange(change);
    });
  }

  public dispose(): void {
    this.#subscription.dispose();
  }

  #seedAll(): void {
    for (const context of this.#registry.projects()) {
      for (const snapshot of context.store.all()) {
        this.#tracker.observe(context.key, snapshot, true);
      }
    }
  }

  #onChange(change: MigentChange): void {
    if (change.type === 'projects' || change.type === 'refresh' || !this.#registry.isLoaded) {
      this.#seedAll();
      return;
    }
    if (change.type !== 'session' && change.type !== 'files') return;
    const context = this.#registry.project(change.project);
    if (context === undefined) return;
    if (change.type === 'session' && change.kind === 'removed') return;
    const snapshot = context.store.snapshot(change.sessionId);
    if (snapshot === undefined) return;
    const transition = this.#tracker.observe(context.key, snapshot, false);
    if (transition !== null && this.#isEnabled(transition.project, transition.kind)) {
      this.#enqueue(transition, () => this.#buildTransition(transition));
    }
  }

  #isEnabled(project: string, setting: string): boolean {
    const context = this.#registry.project(project);
    return vscode.workspace
      .getConfiguration('migent.notifications', context?.folder.uri)
      .get<boolean>(setting, true);
  }

  /** Show now, or queue behind the session's open notification. */
  #enqueue(target: SessionTarget, build: Build): void {
    const key = `${target.project}#${target.sessionId}`;
    if (this.#gate.request(key, build)) this.#present(key, build);
  }

  #present(key: string, build: Build): void {
    const spec = build();
    if (spec === null) {
      this.#next(key);
      return;
    }
    void spec().then(() => {
      this.#next(key);
    });
  }

  #next(key: string): void {
    const queued = this.#gate.release(key);
    if (queued !== undefined && this.#gate.request(key, queued)) this.#present(key, queued);
  }

  #snapshotOf(target: SessionTarget): SessionSnapshot | undefined {
    return this.#registry.project(target.project)?.store.snapshot(target.sessionId);
  }

  /** The notification for a transition, or null when the session has since moved on. */
  #buildTransition(transition: Transition): Spec | null {
    const snapshot = this.#snapshotOf(transition);
    const now = snapshot === undefined ? null : currentTransition(transition.project, snapshot);
    if (snapshot === undefined || now?.kind !== transition.kind || now.executionId !== transition.executionId) {
      return null;
    }
    const target = { project: transition.project, sessionId: transition.sessionId };
    switch (transition.kind) {
      case 'blocked':
        return this.#blocked(transition, snapshot, target);
      case 'failed':
        return this.#failed(transition, snapshot, target);
      case 'completed':
        return async () => {
          const picked = await show('notify.completed', { label: sessionLabel(snapshot) });
          if (picked === 'openOverview') {
            void vscode.commands.executeCommand('migent.session.open', { ...target, tab: 'overview' });
          }
        };
    }
  }

  #blocked(transition: Transition, snapshot: SessionSnapshot, target: SessionTarget): Spec {
    const stage = snapshot.status?.latestStageId ?? 'A stage';
    return async () => {
      const picked = await show('notify.blocked', { label: sessionLabel(snapshot), stage });
      if (picked === 'reply') {
        void vscode.commands.executeCommand('migent.session.reply', { ...target, executionId: transition.executionId });
      }
    };
  }

  #failureDetailsFor(transition: Transition): FailureDetails | undefined {
    const context = this.#registry.project(transition.project);
    if (context === undefined) return undefined;
    return failureDetails(sessionDir(context.root, transition.sessionId), transition.executionId);
  }

  #failed(transition: Transition, snapshot: SessionSnapshot, target: SessionTarget): Spec {
    const details = this.#failureDetailsFor(transition);
    const params = {
      label: sessionLabel(snapshot),
      where: failureWhere(details, snapshot),
      cause: details?.cause ?? null,
      quota: quotaFailure(snapshot),
    };
    const file = details?.file ?? null;
    const failureReport = details?.failureReport ?? null;
    return async () => {
      const picked = await show('notify.failed', params, failureButtons(details));
      if (picked !== undefined) {
        actOnFailure(picked, { target, executionId: transition.executionId, failureReport, file });
      }
    };
  }
}

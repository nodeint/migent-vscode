import * as vscode from 'vscode';

import type { SessionSnapshot } from '../core/model';
import { NotificationGate } from '../core/notificationGate';
import { sessionDir } from '../core/paths';
import { describeQuotaWait, quotaWait } from '../core/replyFlow';
import { sessionLabel } from '../core/sessionPresentation';
import { currentTransition, failureDetails, type Transition, TransitionTracker } from '../core/transitions';
import type { MigentChange } from './changes';
import type { ProjectRegistry } from './projects';

/** `setTimeout` cannot wait longer than a signed 32-bit number of milliseconds. */
const MAX_TIMER_MS = 2_147_000_000;
const REMINDED_KEY = 'migent.quotaReminded';
const REMINDED_LIMIT = 200;

interface SessionTarget {
  project: string;
  sessionId: string;
}

/** What one notification shows, built from the session's state at the moment it is shown. */
interface Spec {
  severity: 'info' | 'warning' | 'error';
  text: string;
  buttons: string[];
  act: (picked: string) => void;
}

/** Builds a notification from current state; null when it no longer applies. */
type Build = () => Spec | null;

interface Action {
  label: string;
  command: string;
  target: SessionTarget;
}

function showSpec(spec: Spec): Thenable<string | undefined> {
  if (spec.severity === 'error') return vscode.window.showErrorMessage(spec.text, ...spec.buttons);
  if (spec.severity === 'warning') return vscode.window.showWarningMessage(spec.text, ...spec.buttons);
  return vscode.window.showInformationMessage(spec.text, ...spec.buttons);
}

/**
 * State-transition notifications for Blocked, Failed, Quota and Completed sessions
 * (plans/03c-reply-notifications.md §3-4). Only transitions observed after activation notify: whatever exists at
 * startup, refresh or project discovery is recorded silently, so a reload never replays old notifications. Each
 * `(session, execution, kind)` notifies once, and a session shows one notification at a time: later ones queue
 * (latest wins) and are built from fresh state when the open one is dismissed. One session never affects another.
 * A quota wait that expired is reminded once, also after a reload; the reminded set is kept in workspace state.
 * A notification opens nothing by itself; its buttons act on the session it captured.
 */
export class StateNotifier implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #state: vscode.Memento;
  readonly #tracker = new TransitionTracker();
  readonly #gate = new NotificationGate<Build>();
  readonly #subscription: vscode.Disposable;
  /** One pending expiry reminder per session, keyed `project#session`. */
  readonly #timers = new Map<string, { retryAt: number; timer: NodeJS.Timeout }>();
  /** `project#session#retryAt` values already reminded, so expiry notifies once. */
  readonly #reminded: Set<string>;

  constructor(registry: ProjectRegistry, state: vscode.Memento) {
    this.#registry = registry;
    this.#state = state;
    this.#reminded = new Set(state.get<string[]>(REMINDED_KEY, []));
    this.#subscription = registry.onDidChange((change) => {
      this.#onChange(change);
    });
  }

  public dispose(): void {
    this.#subscription.dispose();
    for (const { timer } of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }

  #seedAll(): void {
    for (const context of this.#registry.projects()) {
      for (const snapshot of context.store.all()) {
        this.#tracker.observe(context.key, snapshot, true);
        this.#scheduleReminder(context.key, snapshot);
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
    if (change.type === 'session' && change.kind === 'removed') {
      this.#clearTimer(change.project, change.sessionId);
      return;
    }
    const snapshot = context.store.snapshot(change.sessionId);
    if (snapshot === undefined) return;
    this.#scheduleReminder(context.key, snapshot);
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
    void showSpec(spec).then((picked) => {
      if (picked !== undefined) spec.act(picked);
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
      case 'quota':
        return this.#quota(snapshot, target);
      case 'completed':
        return this.#single(`Session ${sessionLabel(snapshot)} completed.`, 'info', {
          label: 'Open result',
          command: 'migent.session.openResult',
          target,
        });
    }
  }

  #single(text: string, severity: Spec['severity'], action: Action): Spec {
    return {
      severity,
      text,
      buttons: [action.label],
      act: () => void vscode.commands.executeCommand(action.command, action.target),
    };
  }

  #blocked(transition: Transition, snapshot: SessionSnapshot, target: SessionTarget): Spec {
    const stage = snapshot.status?.latestStageId ?? 'A stage';
    return {
      severity: 'warning',
      text: `Session ${sessionLabel(snapshot)}: ${stage} is blocked and needs a reply.`,
      buttons: ['Reply'],
      act: () =>
        void vscode.commands.executeCommand('migent.session.reply', { ...target, executionId: transition.executionId }),
    };
  }

  #failed(transition: Transition, snapshot: SessionSnapshot, target: SessionTarget): Spec {
    const context = this.#registry.project(transition.project);
    const details =
      context === undefined
        ? undefined
        : failureDetails(sessionDir(context.root, transition.sessionId), transition.executionId);
    const attempt = details?.attempt ?? null;
    const where = [details?.stageId ?? snapshot.status?.latestStageId, attempt === null ? null : `attempt ${attempt}`]
      .filter((part): part is string => typeof part === 'string')
      .join(' ');
    const cause = details?.cause ?? 'The cause is in the response or log.';
    const file = details?.file ?? null;
    const fileButton = file === null ? [] : [file.kind === 'verify' ? 'Open verify' : 'Open response'];
    return {
      severity: 'error',
      text: `Session ${sessionLabel(snapshot)} failed${where === '' ? '' : ` (${where})`}. ${cause}`,
      buttons: ['Continue', ...fileButton, 'View log'],
      act: (picked) => {
        if (picked === 'Continue') void vscode.commands.executeCommand('migent.session.continue', target);
        else if (picked === 'View log') void vscode.commands.executeCommand('migent.session.showLog', target);
        else if (file !== null) void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file.absolutePath));
      },
    };
  }

  #quota(snapshot: SessionSnapshot, target: SessionTarget): Spec | null {
    const now = Date.now();
    const wait = quotaWait(snapshot, now);
    if (wait === null) return null;
    const text = `Session ${sessionLabel(snapshot)} is waiting for provider quota. ${describeQuotaWait(wait, now)}`;
    // Without a recorded time the user may retry explicitly; with one, Retry is offered when it expires.
    if (wait.retryAt === null) {
      return this.#single(text, 'info', { label: 'Retry', command: 'migent.session.retryQuota', target });
    }
    return { severity: 'info', text, buttons: [], act: () => undefined };
  }

  #timerKey(project: string, sessionId: string): string {
    return `${project}#${sessionId}`;
  }

  #clearTimer(project: string, sessionId: string): void {
    const key = this.#timerKey(project, sessionId);
    const existing = this.#timers.get(key);
    if (existing === undefined) return;
    clearTimeout(existing.timer);
    this.#timers.delete(key);
  }

  /**
   * Keep one expiry reminder per quota wait that has a `retry_at` and was not reminded yet. An overdue wait (found
   * after a reload or a late file event) is reminded promptly, and a file event never cancels a pending reminder
   * for the same `retry_at`.
   */
  #scheduleReminder(project: string, snapshot: SessionSnapshot): void {
    const retryAt = quotaWait(snapshot, Date.now())?.retryAt ?? null;
    const existing = this.#timers.get(this.#timerKey(project, snapshot.sessionId));
    if (retryAt === null) {
      this.#clearTimer(project, snapshot.sessionId);
    } else if (existing?.retryAt !== retryAt) {
      this.#clearTimer(project, snapshot.sessionId);
      if (!this.#reminded.has(`${project}#${snapshot.sessionId}#${retryAt}`)) this.#arm(project, snapshot.sessionId, retryAt);
    }
  }

  #arm(project: string, sessionId: string, retryAt: number): void {
    const delay = Math.min(Math.max(retryAt - Date.now(), 0), MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.#timers.delete(this.#timerKey(project, sessionId));
      this.#expire(project, sessionId, retryAt);
    }, delay);
    this.#timers.set(this.#timerKey(project, sessionId), { retryAt, timer });
  }

  /** Reconcile eligibility from disk before reminding: the wait may have been retried or changed meanwhile. */
  #expire(project: string, sessionId: string, retryAt: number): void {
    if (Date.now() < retryAt) {
      this.#arm(project, sessionId, retryAt);
      return;
    }
    const context = this.#registry.project(project);
    if (context === undefined) return;
    context.store.refreshSession(sessionId);
    const reminderKey = `${project}#${sessionId}#${retryAt}`;
    const snapshot = context.store.snapshot(sessionId);
    const wait = snapshot === undefined ? null : quotaWait(snapshot, Date.now());
    if (wait?.retryAt !== retryAt || this.#reminded.has(reminderKey)) return;
    this.#reminded.add(reminderKey);
    void this.#state.update(REMINDED_KEY, [...this.#reminded].slice(-REMINDED_LIMIT));
    if (!this.#isEnabled(project, 'quota')) return;
    const target = { project, sessionId };
    this.#enqueue(target, () => {
      const current = this.#snapshotOf(target);
      if (current === undefined || quotaWait(current, Date.now())?.retryAt !== retryAt) return null;
      return this.#single(`Session ${sessionLabel(current)}: the provider quota wait is over. You can retry now.`, 'info', {
        label: 'Retry',
        command: 'migent.session.retryQuota',
        target,
      });
    });
  }
}

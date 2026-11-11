import * as vscode from 'vscode';

import {
  type ActionKey,
  LABELS,
  type NoticeAction,
  type NoticeId,
  type NoticeParams,
  NOTICES,
  type Severity,
} from '../core/notices';

/**
 * The only module that calls the VS Code notification API (`show*Message`, `withProgress`); an ESLint rule
 * enforces it. Callers name a catalog id and its params and get an action key back, never a label. `vscode.window`
 * is read at call time so tests that replace it keep working.
 */

type KindOf<Id extends NoticeId, K extends string> = (typeof NOTICES)[Id] extends { kind: K } ? Id : never;
type ToastId = { [Id in NoticeId]: KindOf<Id, 'toast'> }[NoticeId];
type ConfirmId = { [Id in NoticeId]: KindOf<Id, 'confirm'> }[NoticeId];
type ProgressId = { [Id in NoticeId]: KindOf<Id, 'progress'> }[NoticeId];

/** An entry whose text takes no values has `unknown`-free params and is passed `undefined`. */
type Arg<Id extends NoticeId> = unknown extends NoticeParams<Id> ? undefined : NoticeParams<Id>;
type Rest<Id extends NoticeId> = unknown extends NoticeParams<Id> ? [] : [params: NoticeParams<Id>];

/** Method syntax makes the parameters bivariant, so every typed entry is assignable without an assertion. */
interface Entry {
  kind: 'toast' | 'confirm' | 'progress';
  severity?: Severity;
  location?: 'window' | 'notification';
  isCancellable?: boolean;
  actions?: readonly ActionKey[];
  action?: ActionKey;
  text?(params: unknown): string;
  title?(params: unknown): string;
  detail?(params: unknown): string;
}

const ENTRIES: Record<NoticeId, Entry> = NOTICES;

function toast(severity: Severity, text: string, labels: string[]): Thenable<string | undefined> {
  const { window } = vscode;
  if (severity === 'error') return window.showErrorMessage(text, ...labels);
  if (severity === 'warning') return window.showWarningMessage(text, ...labels);
  return window.showInformationMessage(text, ...labels);
}

/**
 * Show a toast. `actions` is the ordered subset of the entry's action keys to offer (default: all of them, in the
 * entry's order). Resolves to the picked action key, or undefined when dismissed.
 */
export function show<Id extends ToastId>(
  id: Id,
  params: Arg<Id>,
  actions?: readonly NoticeAction<Id>[],
): Promise<NoticeAction<Id> | undefined>;
export function show(id: NoticeId, params: unknown, actions?: readonly ActionKey[]): Promise<ActionKey | undefined> {
  return present(id, params, actions);
}

async function present(id: NoticeId, params: unknown, actions?: readonly ActionKey[]): Promise<ActionKey | undefined> {
  const entry = ENTRIES[id];
  const keys = actions ?? entry.actions ?? [];
  const labels = keys.map((key) => LABELS[key]);
  const picked = await toast(entry.severity ?? 'info', entry.text?.(params) ?? '', labels);
  return keys.find((key) => LABELS[key] === picked);
}

/** Show a toast for its text only and ignore the result. */
export function notify<Id extends ToastId>(id: Id, ...rest: Rest<Id>): void;
export function notify(id: NoticeId, params?: unknown): void {
  void present(id, params);
}

/** Ask a modal confirmation. True only when the entry's confirming action was picked. */
export function confirm<Id extends ConfirmId>(id: Id, ...rest: Rest<Id>): Promise<boolean>;
export async function confirm(id: NoticeId, params?: unknown): Promise<boolean> {
  const entry = ENTRIES[id];
  const label = entry.action === undefined ? '' : LABELS[entry.action];
  const detail = entry.detail?.(params);
  const picked = await vscode.window.showWarningMessage(
    entry.text?.(params) ?? '',
    detail === undefined ? { modal: true } : { modal: true, detail },
    label,
  );
  return picked === label;
}

type Reporter = vscode.Progress<{ message?: string; increment?: number }>;

/** Title, location and the cancellable flag come from the entry; the task gets VS Code's reporter and token. */
export function progress<Id extends ProgressId, T>(
  id: Id,
  params: Arg<Id>,
  task: (reporter: Reporter, token: vscode.CancellationToken) => Thenable<T>,
): Thenable<T>;
export function progress<T>(
  id: NoticeId,
  params: unknown,
  task: (reporter: Reporter, token: vscode.CancellationToken) => Thenable<T>,
): Thenable<T> {
  const entry = ENTRIES[id];
  const location =
    entry.location === 'window' ? vscode.ProgressLocation.Window : vscode.ProgressLocation.Notification;
  const options: vscode.ProgressOptions = { location, title: entry.title?.(params) };
  if (entry.isCancellable === true) options.cancellable = true;
  return vscode.window.withProgress(options, task);
}

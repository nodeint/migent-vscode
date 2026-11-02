import * as vscode from 'vscode';

import { formatTimeline } from '../../core/timelineFormat';
import type { ProjectKey } from '../changes';
import type { TailHandle, TailManager } from '../tails';

export const SESSION_DOC_SCHEME = 'migent-session';

const EMPTY_TEXT = 'No events yet.';

/** `migent-session:/<sessionId>/timeline?project=<ProjectKey>` (plans/02-monitoring.md §6.8, C7). */
export function timelineUri(project: ProjectKey, sessionId: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: SESSION_DOC_SCHEME,
    path: `/${sessionId}/timeline`,
    query: new URLSearchParams({ project }).toString(),
  });
}

function parseTimelineUri(uri: vscode.Uri): { project: ProjectKey; sessionId: string } | undefined {
  const match = /^\/([^/]+)\/timeline$/.exec(uri.path);
  const project = new URLSearchParams(uri.query).get('project');
  if (match?.[1] === undefined || project === null) return undefined;
  return { project, sessionId: match[1] };
}

interface Open {
  handle: TailHandle;
  subscription: vscode.Disposable;
}

/**
 * Serves timeline documents. An open document holds tail interest; its content is rebuilt
 * from the tail history and `onDidChange` fires when events arrive or the file is rewritten.
 * Closing the document releases the interest.
 */
export class SessionDocsProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  readonly #tails: TailManager;
  readonly #emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly #open = new Map<string, Open>();
  readonly #subscriptions: vscode.Disposable[];

  constructor(tails: TailManager) {
    this.#tails = tails;
    this.#subscriptions = [
      this.#emitter,
      vscode.workspace.registerTextDocumentContentProvider(SESSION_DOC_SCHEME, this),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme === SESSION_DOC_SCHEME) this.#release(document.uri.toString());
      }),
      // VS Code keeps a virtual document's model alive for a long time after its last editor
      // closes, so the tabs decide when the tail interest ends and when it resumes.
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        this.#onTabs(event);
      }),
    ];
  }

  public get onDidChange(): vscode.Event<vscode.Uri> {
    return this.#emitter.event;
  }

  /** Number of open timeline documents (tests, idle guarantee). */
  public get openCount(): number {
    return this.#open.size;
  }

  public provideTextDocumentContent(uri: vscode.Uri): string {
    const key = uri.toString();
    let open = this.#open.get(key);
    if (open === undefined) {
      const target = parseTimelineUri(uri);
      const handle = target === undefined ? undefined : this.#tails.acquire(target.project, target.sessionId);
      if (handle === undefined) return 'This session is not available in the open projects.';
      open = {
        handle,
        subscription: handle.onDidUpdate(() => {
          this.#emitter.fire(uri);
        }),
      };
      this.#open.set(key, open);
    }
    const lines = formatTimeline(open.handle.history, open.handle.droppedCount);
    return lines.length === 0 ? EMPTY_TEXT : `${lines.join('\n')}\n`;
  }

  public dispose(): void {
    for (const key of [...this.#open.keys()]) this.#release(key);
    for (const subscription of this.#subscriptions) subscription.dispose();
  }

  #timelineTabs(): Set<string> {
    const uris = new Set<string>();
    for (const tab of vscode.window.tabGroups.all.flatMap((group) => group.tabs)) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === SESSION_DOC_SCHEME) {
        uris.add(tab.input.uri.toString());
      }
    }
    return uris;
  }

  #onTabs(event: vscode.TabChangeEvent): void {
    const visible = this.#timelineTabs();
    for (const key of [...this.#open.keys()]) {
      if (!visible.has(key)) this.#release(key);
    }
    // A reopened tab whose model survived has stale text and no tail: ask VS Code to read it again.
    for (const tab of event.opened) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === SESSION_DOC_SCHEME) {
        if (!this.#open.has(tab.input.uri.toString())) this.#emitter.fire(tab.input.uri);
      }
    }
  }

  #release(key: string): void {
    const open = this.#open.get(key);
    if (open === undefined) return;
    this.#open.delete(key);
    open.subscription.dispose();
    open.handle.dispose();
  }
}

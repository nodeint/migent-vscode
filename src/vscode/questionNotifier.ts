import * as vscode from 'vscode';

import { BatchWatch } from '../core/batchWatch';
import { sessionLabel } from '../core/sessionPresentation';
import type { MigentChange } from './changes';
import { show } from './notices';
import type { ProjectRegistry } from './projects';

/**
 * Notifies once per newly observed pending question batch after activation (`migent.notifications.question`).
 * Batches present at startup, refresh or project discovery are recorded silently, and a repeated file event for
 * the same batch never notifies again. A notification never opens a panel by itself.
 */
export class QuestionNotifier implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #watch = new BatchWatch();
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
      for (const snapshot of context.store.all()) this.#watch.observe(context.key, snapshot, true);
    }
  }

  #onChange(change: MigentChange): void {
    if (change.type === 'projects' || change.type === 'refresh' || !this.#registry.isLoaded) {
      this.#seedAll();
      return;
    }
    if (change.type !== 'session' && change.type !== 'files') return;
    const context = this.#registry.project(change.project);
    if (context === undefined || change.type === 'session' && change.kind === 'removed') return;
    const snapshot = context.store.snapshot(change.sessionId);
    const fresh = this.#watch.observe(context.key, snapshot, false);
    const isEnabled = vscode.workspace
      .getConfiguration('migent.notifications', context.folder.uri)
      .get<boolean>('question', true);
    if (!isEnabled || snapshot === undefined) return;
    for (const batch of fresh) {
      const params = { label: sessionLabel(snapshot), stage: batch.stageId ?? 'a role', count: batch.count };
      void show('notify.questions', params).then((picked) => {
        if (picked !== 'answerQuestions') return;
        void vscode.commands.executeCommand('migent.session.open', {
          project: context.key,
          sessionId: batch.sessionId,
          tab: 'questions',
          stageId: batch.stageId,
          executionId: batch.executionId,
        });
      });
    }
  }
}

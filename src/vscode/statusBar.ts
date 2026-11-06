import * as vscode from 'vscode';

import { summarize } from '../core/attention';
import { statusBarModel } from '../core/statusBarText';
import type { ProjectRegistry } from './projects';

/** Status bar summary of running and needs-attention sessions; click focuses the Sessions view. */
export class StatusBar implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #item: vscode.StatusBarItem;
  readonly #subscription: vscode.Disposable;
  #isVisible = false;

  constructor(registry: ProjectRegistry) {
    this.#registry = registry;
    this.#item = vscode.window.createStatusBarItem('migent.status', vscode.StatusBarAlignment.Left, 0);
    this.#item.name = 'Migent';
    this.#item.command = 'migent.sessions.focus';
    this.#subscription = registry.onDidChange((change) => {
      if (change.type !== 'files' && change.type !== 'capability' && change.type !== 'cliWindow') this.update();
    });
    this.update();
  }

  /** Whether the item is currently shown (for tests). */
  public get isVisible(): boolean {
    return this.#isVisible;
  }

  /** Command run on click (for tests). */
  public get command(): string | undefined {
    const { command } = this.#item;
    return typeof command === 'string' ? command : command?.command;
  }

  public get text(): string {
    return this.#item.text;
  }

  public get tooltip(): string {
    return typeof this.#item.tooltip === 'string' ? this.#item.tooltip : '';
  }

  public update(): void {
    const model = statusBarModel(
      this.#registry.projects().map((context) => ({
        name: context.folder.name,
        summary: summarize(context.store.all()),
      })),
    );
    if (model === null) {
      this.#item.hide();
      this.#isVisible = false;
      return;
    }
    this.#item.text = model.text;
    this.#item.tooltip = model.tooltip;
    this.#item.show();
    this.#isVisible = true;
  }

  public dispose(): void {
    this.#subscription.dispose();
    this.#item.dispose();
  }
}

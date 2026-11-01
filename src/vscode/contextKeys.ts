import * as vscode from 'vscode';

import { aggregateSessionsState } from '../core/attention';
import type { ProjectRegistry } from './projects';

/**
 * Window context keys for welcome content and menus. `migent.cliState` joins them with
 * the CLI capability service.
 */
export class ContextKeys implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #subscription: vscode.Disposable;
  readonly #values = new Map<string, boolean | string>();

  constructor(registry: ProjectRegistry) {
    this.#registry = registry;
    this.#subscription = registry.onDidChange((change) => {
      if (change.type === 'projects' || change.type === 'project' || change.type === 'refresh') this.update();
    });
    this.update();
  }

  public update(): void {
    const projects = this.#registry.projects();
    this.#set('migent.hasProjects', projects.length > 0);
    this.#set(
      'migent.sessionsState',
      aggregateSessionsState(
        projects.map((project) => project.store.scanOutcome),
        this.#registry.isLoaded,
      ),
    );
  }

  public dispose(): void {
    this.#subscription.dispose();
  }

  #set(key: string, value: boolean | string): void {
    if (this.#values.get(key) === value) return;
    this.#values.set(key, value);
    void vscode.commands.executeCommand('setContext', key, value);
  }
}

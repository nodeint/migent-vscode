import * as vscode from 'vscode';

import { aggregateSessionsState } from '../core/attention';
import type { CapabilityService } from './capability';
import type { ProjectRegistry } from './projects';

/**
 * Window context keys for welcome content and menus: `migent.hasProjects`, `migent.sessionsState`
 * and `migent.cliState` (the worst CLI capability across projects, or the window state without a project).
 */
export class ContextKeys implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #capability: CapabilityService;
  readonly #subscription: vscode.Disposable;
  readonly #values = new Map<string, boolean | string>();

  constructor(registry: ProjectRegistry, capability: CapabilityService) {
    this.#registry = registry;
    this.#capability = capability;
    this.#subscription = registry.onDidChange((change) => {
      if (change.type === 'projects' || change.type === 'project' || change.type === 'refresh' || change.type === 'capability' || change.type === 'cliWindow') this.update();
    });
    this.update();
  }

  public update(): void {
    const projects = this.#registry.projects();
    this.#set('migent.hasProjects', projects.length > 0);
    this.#set('migent.cliState', this.#capability.aggregate());
    this.#set('migent.cliInstalling', this.#capability.isInstalling);
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

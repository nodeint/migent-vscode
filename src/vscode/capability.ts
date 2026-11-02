import * as vscode from 'vscode';

import { nodeProbes } from '../cli/locate';
import {
  type CapabilityKind,
  type CapabilityState,
  MINIMUM_CLI_VERSION,
  probeCapability,
  type RunVersion,
  type VersionOutput,
} from '../cli/version';
import type { ProjectKey } from './changes';
import type { ProjectContext, ProjectRegistry } from './projects';

export const CLI_PATH_SETTING = 'migent.cli.path';
const DEFAULT_CLI_PATH = 'migent';

/** Problem kinds, most actionable first; used to pick the aggregate state. */
const WORST_FIRST: readonly CapabilityKind[] = ['missing', 'unsupported', 'unparsable', 'error', 'old', 'checking', 'ok'];

/** Window-level state: the worst project state, or `none` when there is no project. */
export type AggregateCapability = CapabilityKind | 'none';

export function aggregateCapability(kinds: readonly CapabilityKind[]): AggregateCapability {
  return WORST_FIRST.find((kind) => kinds.includes(kind)) ?? 'none';
}

/**
 * Per-project CLI capability (`migent.cli.path` is resource scoped). Checks run once per trigger:
 * a project appearing, a change of `migent.cli.*`, or Recheck. Capability never hides disk data;
 * it is the gate that phase 3 write commands consult.
 */
export class CapabilityService implements vscode.Disposable {
  readonly #registry: ProjectRegistry;
  readonly #run: RunVersion | undefined;
  readonly #states = new Map<ProjectKey, CapabilityState>();
  readonly #generation = new Map<ProjectKey, number>();
  #cache = new Map<string, Promise<VersionOutput>>();
  readonly #subscriptions: vscode.Disposable[] = [];

  constructor(registry: ProjectRegistry, run?: RunVersion) {
    this.#registry = registry;
    this.#run = run;
    this.#subscriptions.push(
      registry.onDidChange((change) => {
        if (change.type === 'projects') this.#syncProjects();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration('migent.cli')) return;
        for (const context of registry.projects()) {
          if (event.affectsConfiguration('migent.cli', context.folder.uri)) void this.#check(context);
        }
      }),
    );
    this.#syncProjects();
  }

  /** The last known state; `checking` until the first probe of the project finished. */
  public state(key: ProjectKey): CapabilityState {
    const known = this.#states.get(key);
    if (known !== undefined) return known;
    const context = this.#registry.project(key);
    return context === undefined ? this.#checking('') : this.#checking(this.#configured(context));
  }

  public aggregate(): AggregateCapability {
    return aggregateCapability(this.#registry.projects().map((context) => this.state(context.key).kind));
  }

  /** Probe every project again, including executables whose version was cached. */
  public async recheck(): Promise<void> {
    this.#cache = new Map();
    await Promise.all(this.#registry.projects().map((context) => this.#check(context)));
  }

  public dispose(): void {
    for (const subscription of this.#subscriptions.splice(0)) subscription.dispose();
  }

  #syncProjects(): void {
    const projects = this.#registry.projects();
    const keys = new Set(projects.map((context) => context.key));
    for (const key of [...this.#states.keys()]) {
      if (!keys.has(key)) this.#states.delete(key);
    }
    for (const context of projects) {
      if (!this.#states.has(context.key)) void this.#check(context);
    }
  }

  #configured(context: ProjectContext): string {
    return vscode.workspace.getConfiguration('migent', context.folder.uri).get<string>('cli.path', DEFAULT_CLI_PATH);
  }

  #checking(configured: string): CapabilityState {
    return { kind: 'checking', configured, required: MINIMUM_CLI_VERSION };
  }

  async #check(context: ProjectContext): Promise<void> {
    const { key } = context;
    const generation = (this.#generation.get(key) ?? 0) + 1;
    this.#generation.set(key, generation);
    const configured = this.#configured(context);
    this.#states.set(key, this.#checking(configured));
    this.#registry.announce({ type: 'capability', project: key });
    const state = await probeCapability({
      locate: {
        configured,
        platform: process.platform,
        env: process.env,
        workspaceRoot: context.root,
        probes: nodeProbes,
      },
      run: this.#run,
      cache: this.#cache,
    });
    // A newer check (or removal of the project) supersedes this result.
    if (this.#generation.get(key) !== generation || this.#registry.project(key) === undefined) return;
    this.#states.set(key, state);
    this.#registry.announce({ type: 'capability', project: key });
  }
}

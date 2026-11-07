import * as vscode from 'vscode';

import { invokeJson } from '../../cli/invoke';
import {
  availableClients,
  clientChoice,
  clientModelsArgs,
  clientOptionsArgs,
  clientsArgs,
  type ProviderChoice,
} from '../../core/controlArgs';
import type { CapabilityService } from '../capability';
import type { ProjectKey } from '../changes';
import type { ProjectContext } from '../projects';

/** Reading a client's models and native options runs its CLI, so it is slower than a version check. */
const PROVIDERS_TIMEOUT_MS = 60_000;

/**
 * One read per project (`get clients`, then `get models` and `get options --native` per client), shared by every
 * open page and refreshed on request.
 * The list describes this machine's CLIs, not the project files, so a failed read simply means no suggestions.
 */
export class ProviderCatalog {
  readonly #capability: CapabilityService;
  readonly #cache = new Map<ProjectKey, Promise<ProviderChoice[]>>();

  constructor(capability: CapabilityService) {
    this.#capability = capability;
  }

  /** The cached providers, reading them on first use; a failed read is cached as an empty list. */
  public get(context: ProjectContext): Promise<ProviderChoice[]> {
    let pending = this.#cache.get(context.key);
    if (pending === undefined) {
      pending = this.#read(context);
      this.#cache.set(context.key, pending);
    }
    return pending;
  }

  /** Drop the cached list so the next `get` asks the CLIs again. */
  public invalidate(key: ProjectKey): void {
    this.#cache.delete(key);
  }

  public dispose(): void {
    this.#cache.clear();
  }

  async #read(context: ProjectContext): Promise<ProviderChoice[]> {
    const state = await this.#capability.windowReady();
    if (state.kind !== 'ok' || state.launch === undefined) return [];
    const configuration = vscode.workspace.getConfiguration('migent', context.folder.uri);
    const env = { ...process.env, ...configuration.get<Record<string, string>>('env', {}) };
    const options = { cwd: context.root, env, timeoutMs: PROVIDERS_TIMEOUT_MS };
    const clients = await invokeJson(state.launch, clientsArgs(), options);
    if (clients.kind !== 'ok') return [];
    const { launch } = state;
    const choices = await Promise.all(
      availableClients(clients.value).map(async (client) => {
        const [models, native] = await Promise.all([
          invokeJson(launch, clientModelsArgs(client), options),
          invokeJson(launch, clientOptionsArgs(client), options),
        ]);
        if (models.kind !== 'ok') return null;
        return clientChoice(client, models.value, native.kind === 'ok' ? native.value : []);
      }),
    );
    return choices.filter((choice): choice is ProviderChoice => choice !== null);
  }
}

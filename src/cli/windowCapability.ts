import { type CapabilityState, MINIMUM_CLI_VERSION } from './version';

/**
 * The CLI state of the window, independent of any project. A newer check supersedes an older one, and `ready()`
 * resolves with the result of the check that is current when it settles. No `vscode` import.
 */
export class WindowCapability {
  readonly #probe: () => Promise<CapabilityState>;
  readonly #onChange: () => void;
  #state: CapabilityState = { kind: 'checking', required: MINIMUM_CLI_VERSION };
  #generation = 0;
  #pending: Promise<void> = Promise.resolve();

  constructor(probe: () => Promise<CapabilityState>, onChange: () => void) {
    this.#probe = probe;
    this.#onChange = onChange;
  }

  public get state(): CapabilityState {
    return this.#state;
  }

  /** Start a check; the state is `checking` until it settles. Resolves when this check settled or was superseded. */
  public check(): Promise<void> {
    const generation = ++this.#generation;
    this.#state = { kind: 'checking', required: MINIMUM_CLI_VERSION };
    this.#onChange();
    this.#pending = this.#run(generation);
    return this.#pending;
  }

  public async ready(): Promise<CapabilityState> {
    for (;;) {
      const generation = this.#generation;
      await this.#pending;
      if (generation === this.#generation) return this.#state;
    }
  }

  async #run(generation: number): Promise<void> {
    const state = await this.#probe();
    if (this.#generation !== generation) return;
    this.#state = state;
    this.#onChange();
  }
}

/** The outcome of waiting for the install command. */
export interface InstallEnd {
  exitCode: number | undefined;
}

/**
 * Waits for one specific install execution. Events for any other execution (for example a command that was still
 * running in a reused terminal) are ignored; closing the terminal ends the wait without an exit code.
 */
export class InstallWait<Execution, Terminal> {
  public readonly promise: Promise<InstallEnd>;
  #resolve!: (end: InstallEnd) => void;
  #execution: Execution | undefined;

  constructor() {
    this.promise = new Promise<InstallEnd>((resolve) => {
      this.#resolve = resolve;
    });
  }

  /** The execution that runs the install command. */
  public track(execution: Execution): void {
    this.#execution = execution;
  }

  public executionEnded(execution: Execution, exitCode: number | undefined): void {
    if (this.#execution !== undefined && execution === this.#execution) this.#resolve({ exitCode });
  }

  public terminalClosed(closed: Terminal, installTerminal: Terminal): void {
    if (closed === installTerminal) this.#resolve({ exitCode: undefined });
  }
}

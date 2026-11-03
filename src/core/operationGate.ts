/**
 * In-memory gate for operations this extension instance starts (plans/03-control.md §1). It is not a
 * lock on the session: `session.lock` stays authoritative for the CLI. It only stops two clicks from
 * submitting competing commands. No `vscode` import.
 */

/** An operation on an existing session. */
export interface SessionKey {
  kind: 'session';
  project: string;
  sessionId: string;
}

/** An operation that creates a session, held until the new session id is known. */
export interface LaunchKey {
  kind: 'launch';
  project: string;
  workflowId: string;
  priorSessionId?: string;
}

export type GateKey = SessionKey | LaunchKey;

export type OperationPhase = 'Starting' | 'Running' | 'Sending reply' | 'Repairing' | 'Stopping' | 'Deleting';

export interface GateEntry {
  key: GateKey;
  phase: OperationPhase;
}

export function gateId(key: GateKey): string {
  return key.kind === 'session'
    ? JSON.stringify(['session', key.project, key.sessionId])
    : JSON.stringify(['launch', key.project, key.workflowId, key.priorSessionId ?? null]);
}

export interface GateHandle {
  readonly key: GateKey;
  phase(): OperationPhase;
  setPhase(phase: OperationPhase): void;
  /** Idempotent. */
  release(): void;
  /**
   * A launch handle becomes a handle on the created session once its id is known. Returns null
   * (and keeps the launch held) when that session is already busy.
   */
  promote(sessionId: string): GateHandle | null;
}

export class OperationGate {
  private readonly entries = new Map<string, GateEntry>();
  private readonly listeners = new Set<() => void>();

  public tryAcquire(key: GateKey, phase: OperationPhase = 'Starting'): GateHandle | null {
    const id = gateId(key);
    if (this.entries.has(id)) return null;
    this.entries.set(id, { key, phase });
    this.notify();
    return this.handle(id, key);
  }

  /** The pending operation on a session, if any. Launch keys are looked up with `isLaunchBusy`. */
  public current(project: string, sessionId: string): GateEntry | undefined {
    return this.entries.get(gateId({ kind: 'session', project, sessionId }));
  }

  public isLaunchBusy(key: LaunchKey): boolean {
    return this.entries.has(gateId(key));
  }

  public onDidChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private handle(id: string, key: GateKey): GateHandle {
    const { entries } = this;
    let isReleased = false;
    const handle: GateHandle = {
      key,
      phase: () => entries.get(id)?.phase ?? 'Starting',
      setPhase: (phase) => {
        const entry = entries.get(id);
        if (isReleased || entry === undefined || entry.phase === phase) return;
        entry.phase = phase;
        this.notify();
      },
      release: () => {
        if (isReleased) return;
        isReleased = true;
        entries.delete(id);
        this.notify();
      },
      promote: (sessionId) => {
        if (isReleased || key.kind !== 'launch') return null;
        const next = this.tryAcquire({ kind: 'session', project: key.project, sessionId }, entries.get(id)?.phase);
        if (next === null) return null;
        handle.release();
        return next;
      },
    };
    return handle;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

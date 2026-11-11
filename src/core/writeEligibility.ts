import type { CapabilityKind } from '../cli/version';
import { text } from '../text';
import type { SessionSnapshot } from './model';

/** Why a write command is unavailable, and what the user can do about it (plans/03-control.md §2). */
export type WriteBlock =
  | { reason: 'cli'; kind: Exclude<CapabilityKind, 'ok'>; recovery: 'recheck' }
  | { reason: 'foreign-lock'; host: string | null; pid: number | null; heartbeatAt: string | null; recovery: 'refresh' }
  | { reason: 'busy'; phase: string; recovery: 'none' };

export type WriteCheck = { ok: true } | ({ ok: false } & WriteBlock);

export interface WriteInput {
  capability: CapabilityKind;
  /** Absent for a command that creates a session. */
  snapshot?: SessionSnapshot;
  /** The pending operation this extension holds for the target, if any. */
  pendingPhase?: string;
}

/**
 * Every write command checks the CLI, the target's lock and any pending operation. A live lock on
 * this host is the extension's own runner (Stop allowed); only a lock on another host blocks writes.
 */
export function checkWrite(input: WriteInput): WriteCheck {
  if (input.capability !== 'ok') {
    return { ok: false, reason: 'cli', kind: input.capability, recovery: 'recheck' };
  }
  if (input.pendingPhase !== undefined) return { ok: false, reason: 'busy', phase: input.pendingPhase, recovery: 'none' };
  const lock = input.snapshot?.lock;
  if (lock?.kind === 'alive' && lock.foreignHost) {
    return {
      ok: false,
      reason: 'foreign-lock',
      host: lock.host,
      pid: lock.pid,
      heartbeatAt: lock.heartbeatAt,
      recovery: 'refresh',
    };
  }
  return { ok: true };
}

/**
 * The phase values (`Starting`, `Sending reply`, ...) are identifiers owned by `operationGate.ts`; this maps each to
 * its catalog wording, and an unknown value is lowercased as it always was.
 */
function phaseWording(phase: string): string {
  switch (phase) {
    case 'Starting':
      return text('states.phaseStarting');
    case 'Running':
      return text('states.phaseRunning');
    case 'Sending reply':
      return text('states.phaseSendingReply');
    case 'Repairing':
      return text('states.phaseRepairing');
    case 'Completing':
      return text('states.phaseCompleting');
    case 'Stopping':
      return text('states.phaseStopping');
    case 'Deleting':
      return text('states.phaseDeleting');
    default:
      return phase.toLowerCase();
  }
}

/** One sentence for a notification or tooltip; the recovery action is offered separately. */
export function describeBlock(block: WriteBlock): string {
  switch (block.reason) {
    case 'cli':
      return block.kind === 'checking' ? text('states.cliChecking') : text('states.cliUnavailable', { kind: block.kind });
    case 'foreign-lock': {
      const owner = [block.host, block.pid === null ? null : text('states.lockOwnerPid', { pid: block.pid })]
        .filter(Boolean)
        .join(' ');
      const beat = block.heartbeatAt === null ? '' : text('states.lockHeartbeat', { at: block.heartbeatAt });
      return text('states.foreignLock', { owner: owner || text('states.lockOwnerUnknown'), beat });
    }
    case 'busy':
      return text('states.busy', { phase: phaseWording(block.phase) });
  }
}

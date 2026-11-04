import type { CapabilityKind } from '../cli/version';
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

/** One sentence for a notification or tooltip; the recovery action is offered separately. */
export function describeBlock(block: WriteBlock): string {
  switch (block.reason) {
    case 'cli':
      return block.kind === 'checking'
        ? 'The Migent CLI is still being checked.'
        : `The Migent CLI is unavailable (${block.kind}).`;
    case 'foreign-lock': {
      const owner = [block.host, block.pid === null ? null : `pid ${block.pid}`].filter(Boolean).join(' ');
      const beat = block.heartbeatAt === null ? '' : `, last heartbeat ${block.heartbeatAt}`;
      return `Another process holds this session (${owner || 'unknown'}${beat}).`;
    }
    case 'busy':
      return `Another operation on this session is still running (${block.phase.toLowerCase()}).`;
  }
}

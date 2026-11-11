import { text as describe } from '../text';
import { asSessionId } from './manifest';
import type { SessionManifest, SessionSnapshot } from './model';
import { resolveWithin } from './paths';
import { isRecord } from './record';

export interface HandoffArtifact {
  /** Input name in the target workflow. */
  name: string;
  output: string;
  /** Machine-specific absolute path in the source. Inert text: never opened or linked. */
  sourcePath: string | null;
  /** Path relative to the target session directory, e.g. `handoff/1/note.md`. */
  path: string;
  /** Absolute path inside the target session directory; null when `path` escapes it. */
  localPath: string | null;
  sha256: string;
}

export type HandoffRead =
  | { kind: 'absent' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'ok'; sourceSessionId: string; artifacts: HandoffArtifact[] };

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Parse the manifest `handoff` mapping (an inline JSON flow mapping inside the YAML,
 * already a record after parsing). Anything outside the observed shape is `invalid`;
 * the caller still has `prior_session_id` for the source link.
 */
export function readHandoff(manifest: SessionManifest | null, sessionDirPath: string): HandoffRead {
  const value = manifest?.raw.handoff;
  if (value === undefined || value === null) return { kind: 'absent' };
  if (!isRecord(value)) return { kind: 'invalid', reason: describe('states.handoffNotMapping') };
  const sourceSessionId = asSessionId(value.source_session_id);
  if (sourceSessionId === null) return { kind: 'invalid', reason: describe('states.handoffSourceMissing') };
  if (!isRecord(value.artifacts)) return { kind: 'invalid', reason: describe('states.handoffArtifactsNotMapping') };
  const artifacts: HandoffArtifact[] = [];
  for (const [name, entry] of Object.entries(value.artifacts)) {
    const output = isRecord(entry) ? str(entry.output) : null;
    const relative = isRecord(entry) ? str(entry.path) : null;
    const sha256 = isRecord(entry) ? str(entry.sha256) : null;
    if (!isRecord(entry) || output === null || relative === null || sha256 === null) {
      return { kind: 'invalid', reason: describe('states.handoffArtifactIncomplete', { name }) };
    }
    artifacts.push({
      name,
      output,
      sourcePath: str(entry.source_path),
      path: relative,
      localPath: resolveWithin(sessionDirPath, relative),
      sha256,
    });
  }
  return { kind: 'ok', sourceSessionId, artifacts };
}

/**
 * Sessions among `snapshots` that name `sessionId` as `prior_session_id`, in the order
 * given. Pure: relations to sessions outside the retained set are not resolved here.
 */
export function childrenOf(snapshots: readonly SessionSnapshot[], sessionId: string): SessionSnapshot[] {
  return snapshots.filter((snapshot) => snapshot.manifest?.priorSessionId === sessionId);
}

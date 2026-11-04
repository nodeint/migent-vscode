import { type MetricsExecution, type MetricsStage, type MetricsTotals, readMetrics } from './metrics';
import type { SessionSnapshot } from './model';
import { durationOf, titleCase } from './resultsModel';
import { sessionTitle, truncate } from './sessionPresentation';

/**
 * The data the Session Metrics page shows, as plain JSON. Every string is inert text rendered with
 * `textContent`. Only fields the page displays are passed on; `argv` and other machine-specific
 * fields of `metrics.json` never get this far (see `metrics.ts`).
 */

export type SessionMetricsView =
  | { kind: 'ok'; totals: MetricsTotals; stages: MetricsStage[]; executions: MetricsExecution[] }
  | { kind: 'missing' }
  | { kind: 'unreadable'; error: string }
  | { kind: 'invalid'; error: string };

export interface SessionMetricsModel {
  /** `unavailable`: the session is not known (removed, not yet loaded, or hidden by the limit). */
  availability: 'ok' | 'unavailable';
  sessionId: string;
  title: string;
  state: string;
  workflowId: string | null;
  completedAt: string | null;
  /** Milliseconds from creation to the last update; only for a Completed session with valid timestamps. */
  durationMs: number | null;
  metrics: SessionMetricsView;
}

export interface SessionMetricsInput {
  sessionId: string;
  sessionDirPath: string;
  /** Retained snapshots of the project. */
  snapshots: readonly SessionSnapshot[];
}

const TITLE_MAX = 40;
const COMPLETED_GLYPH = '✓';

/** The editor tab title: `✓ <workflow id or shortened title> · Metrics` for a Completed session, else `Metrics`. */
export function sessionMetricsPanelTitle(model: SessionMetricsModel): string {
  if (model.availability === 'unavailable' || model.state !== 'Completed') return 'Metrics';
  return `${COMPLETED_GLYPH} ${model.workflowId ?? truncate(model.title, TITLE_MAX)} · Metrics`;
}

function unavailable(sessionId: string): SessionMetricsModel {
  return {
    availability: 'unavailable',
    sessionId,
    title: sessionId,
    state: 'Unavailable',
    workflowId: null,
    completedAt: null,
    durationMs: null,
    metrics: { kind: 'missing' },
  };
}

/** Build the page data for one session. Reads `metrics.json` on demand; nothing is cached. */
export function buildSessionMetricsModel(input: SessionMetricsInput): SessionMetricsModel {
  const snapshot = input.snapshots.find((candidate) => candidate.sessionId === input.sessionId);
  if (snapshot === undefined) return unavailable(input.sessionId);
  const read = readMetrics(input.sessionDirPath);
  let metrics: SessionMetricsView;
  switch (read.kind) {
    case 'ok':
      metrics = { kind: 'ok', ...read.metrics };
      break;
    case 'missing':
      metrics = { kind: 'missing' };
      break;
    case 'unreadable':
    case 'invalid':
      metrics = { kind: read.kind, error: read.error };
      break;
  }
  return {
    availability: 'ok',
    sessionId: snapshot.sessionId,
    title: sessionTitle(snapshot),
    state: titleCase(snapshot.displayState.state),
    workflowId: snapshot.status?.workflowId ?? snapshot.manifest?.workflowId ?? null,
    completedAt: snapshot.displayState.state === 'completed' ? (snapshot.status?.updatedAt ?? null) : null,
    durationMs: durationOf(snapshot),
    metrics,
  };
}

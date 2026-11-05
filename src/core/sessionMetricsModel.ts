import { type MetricsExecution, type MetricsStage, type MetricsTotals, readMetrics } from './metrics';
import type { SessionSnapshot } from './model';
import { titleCase } from './resultsModel';
import { buildSessionMeta, NO_SESSION_META, type SessionMeta } from './sessionMeta';
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
  /** What the header says about the session, the same on every session page. */
  meta: SessionMeta;
  metrics: SessionMetricsView;
}

export interface SessionMetricsInput {
  sessionId: string;
  sessionDirPath: string;
  /** Retained snapshots of the project. */
  snapshots: readonly SessionSnapshot[];
}

const TITLE_MAX = 32;

/** The editor tab title: the shortened session title, or `Metrics` when unavailable. The tab icon names the page. */
export function sessionMetricsPanelTitle(model: SessionMetricsModel): string {
  return model.availability === 'unavailable' ? 'Metrics' : truncate(model.title, TITLE_MAX);
}

function unavailable(sessionId: string): SessionMetricsModel {
  return {
    availability: 'unavailable',
    sessionId,
    title: sessionId,
    state: 'Unavailable',
    workflowId: null,
    completedAt: null,
    meta: NO_SESSION_META,
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
    meta: buildSessionMeta(snapshot),
    metrics,
  };
}

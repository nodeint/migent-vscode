import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExecutionFile } from './executionFiles';
import type { LockProbe, ScanOutcome } from './model';
import {
  executionContextValue,
  executionDescription,
  executionFileLabel,
  executionIcon,
  executionLabel,
  formatAgo,
  formatDuration,
  nodeIds,
  sessionContextValue,
  sessionDescription,
  sessionIcon,
  sessionLabel,
  sessionRowLabel,
  sessionsDiagnostic,
  sessionTitle,
  sessionTooltip,
  shortId,
  truncate,
} from './sessionPresentation';
import { capturedDir, snapshotFromDir, syntheticDir } from './testHelpers';

const NOW = Date.parse('2026-11-01T12:05:00.000+00:00');
const alive: LockProbe = { kind: 'alive', pid: 1, host: 'h', heartbeatAt: 't', foreignHost: false };
const foreign: LockProbe = { kind: 'alive', pid: 1, host: 'other', heartbeatAt: 't', foreignHost: true };

const sessionFixture = (name: string) =>
  path.join(process.cwd(), 'src', 'core', 'fixtures', 'sessions', name);

describe('formatting', () => {
  it('formats durations and ages', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(192_000)).toBe('3m 12s');
    expect(formatDuration(7_500_000)).toBe('2h 5m');
    expect(formatDuration(100_800_000)).toBe('1d 4h');
    expect(formatDuration(-5)).toBe('0s');
    expect(formatAgo(2000)).toBe('just now');
    expect(formatAgo(300_000)).toBe('5m ago');
    expect(formatAgo(7_200_000)).toBe('2h ago');
  });

  it('truncates long labels with an ellipsis and leaves short ones', () => {
    expect(truncate('short')).toBe('short');
    const long = 'x'.repeat(80);
    expect(truncate(long)).toHaveLength(60);
    expect(truncate(long).endsWith('…')).toBe(true);
  });
});

describe('session title precedence', () => {
  const base = snapshotFromDir(sessionFixture('completed'));
  const withStatus = { ...base, titleOverride: null };

  it('prefers title.json, then manifest, status, workflow id, then the short id', () => {
    expect(sessionTitle({ ...withStatus, titleOverride: 'Renamed' })).toBe('Renamed');
    expect(sessionTitle({ ...withStatus, manifest: base.manifest && { ...base.manifest, title: 'Manifest' } })).toBe('Manifest');
    const noManifestTitle = { ...withStatus, manifest: base.manifest && { ...base.manifest, title: null } };
    expect(sessionTitle(noManifestTitle)).toBe(base.status?.title ?? base.status?.workflowId);
    const noIds = base.status && { ...base.status, title: null, workflowId: null };
    const bare = { ...withStatus, manifest: null, status: noIds };
    expect(sessionTitle(bare)).toBe(base.sessionId.slice(0, 8));
    expect(sessionTitle({ ...bare, status: base.status && { ...base.status, title: null, workflowId: 'plan' } })).toBe('plan');
  });

  it('shows the overlay in the label and tooltip', () => {
    const renamed = { ...withStatus, titleOverride: 'Renamed' };
    expect(sessionLabel(renamed)).toBe('Renamed');
    expect(sessionTooltip(renamed, NOW)).toContain('Renamed');
  });
});

describe('numeric and legacy ids side by side', () => {
  it('keeps node ids distinct and reads the captured 0.5.6 session', () => {
    const numeric = snapshotFromDir(capturedDir('numeric-ids-0.5.6'));
    const legacy = snapshotFromDir(sessionFixture('completed'));
    expect(numeric.sessionId).not.toBe(legacy.sessionId);
    expect(numeric.manifest?.sessionId).toBe('1');
    expect(numeric.titleOverride).toBe('Renamed title');
    expect(sessionLabel(numeric)).toBe('Renamed title');
    expect(nodeIds.session('k', numeric.sessionId)).not.toBe(nodeIds.session('k', legacy.sessionId));
  });
});

describe('session rows', () => {
  it('leads the row label with id and workflow tag, and describes the age', () => {
    const snapshot = snapshotFromDir(sessionFixture('completed'));
    expect(sessionLabel(snapshot)).toBe(snapshot.manifest?.title);
    expect(sessionRowLabel(snapshot)).toBe(truncate(`${shortId(snapshot.sessionId)} · plan · ${snapshot.manifest?.title}`));
    expect(sessionDescription(snapshot, NOW)).toMatch(/^.+ ago$/);
    const short = { ...snapshot, status: snapshot.status && { ...snapshot.status, workflowId: 'pr' } };
    expect(sessionRowLabel(short)).toBe(truncate(`${shortId(snapshot.sessionId)} · pr · ${snapshot.manifest?.title}`));
  });

  it('shows elapsed time since start for a Running session, with a pending-question indicator', () => {
    const snapshot = snapshotFromDir(syntheticDir('running-questions'), alive);
    expect(snapshot.displayState.state).toBe('running');
    expect(sessionDescription(snapshot, NOW)).toBe('5m 0s · 1 question');
    expect(sessionContextValue(snapshot)).toBe('session.running;questions');
  });

  it('flags a row that can take a reply, whatever else it shows', () => {
    const snapshot = snapshotFromDir(syntheticDir('running-questions'), alive);
    const target = { executionId: '0001-plan--attempt-01', stageId: 'plan', attempt: 1, kind: 'blocker' as const };
    expect(sessionContextValue({ ...snapshot, replyTargets: [target] })).toBe('session.running;questions;reply');
  });

  it('describes Question sessions by their pending questions', () => {
    const snapshot = snapshotFromDir(capturedDir('question-pending'));
    expect(snapshot.displayState.state).toBe('question');
    expect(sessionDescription(snapshot, NOW)).toContain('3 questions');
    expect(sessionContextValue(snapshot)).toBe('session.question;questions;role');
    expect(sessionIcon(snapshot)).toBe('comment-discussion');
  });

  it('adds the foreign and outputs flags in a fixed order', () => {
    const snapshot = snapshotFromDir(capturedDir('handoff-source'), foreign);
    expect(snapshot.displayState.writable).toBe(false);
    expect(sessionContextValue(snapshot)).toBe('session.running;foreign;outputs');
  });

  it('flags a role session so Complete is not offered for it', () => {
    const snapshot = snapshotFromDir(capturedDir('question-answered'));
    expect(snapshot.manifest?.role).toBe('planner');
    expect(sessionContextValue(snapshot).split(';')).toContain('role');
    expect(sessionContextValue(snapshotFromDir(capturedDir('handoff-source'))).split(';')).not.toContain('role');
  });

  it('builds a tooltip with unavailable values, blockers and no raw provider event', () => {
    const blocked = snapshotFromDir(syntheticDir('blocked-questions'));
    const tooltip = sessionTooltip(blocked, NOW);
    expect(tooltip).toContain('State: Blocked');
    expect(tooltip).toContain('Blocked by: 0002-review--attempt-01');
    expect(tooltip).toContain('Pending questions: 2');
    expect(tooltip).toContain('Last update: 2026-11-01T12:01:00.000+00:00 (4m ago)');

    const schema = sessionTooltip(snapshotFromDir(sessionFixture('unknown-schema')), NOW);
    expect(schema).toContain('Reason: Unsupported schema version 99');
    // An unreadable status leaves nothing to show for the update time.
    const corrupt = sessionTooltip(snapshotFromDir(sessionFixture('corrupt-status')), NOW);
    expect(corrupt).toContain('Reason: status.json invalid');
    expect(corrupt).toContain('Last update: unavailable');
  });

  it('shows only the small provider event fields', () => {
    const snapshot = snapshotFromDir(sessionFixture('completed'));
    expect(sessionTooltip(snapshot, NOW)).toContain('Latest event: provider.turn_completed · completed · claude');
  });
});

describe('execution rows', () => {
  const execution = {
    id: '0001-plan--attempt-02',
    order: 1,
    stage: 'plan',
    attempt: 2,
    status: 'completed',
    decision: 'approved',
    client: 'claude',
    model: 'sonnet',
    effort: null,
    error: null,
    hasFailureReport: false,
    blocker: null,
    kind: null,
    createdAt: null,
    completedAt: null,
  };

  it('labels by stage and attempt, describes by provider and decision', () => {
    expect(executionLabel(execution)).toBe('plan · attempt 2');
    expect(executionDescription(execution)).toBe('claude/sonnet · approved');
    expect(executionDescription({ ...execution, client: null, model: null, decision: null })).toBe('');
    expect(executionIcon(execution)).toBe('pass');
    expect(executionIcon({ ...execution, status: 'failed' })).toBe('error');
    expect(executionIcon({ ...execution, status: null })).toBe('circle-outline');
    expect(executionContextValue({ ...execution, status: null })).toBe('execution.unknown');
    expect(executionContextValue({ ...execution, status: 'failed', hasFailureReport: true })).toBe(
      'execution.failed;failure',
    );
  });

  it('labels files, with verify files by turn', () => {
    const file = (relativePath: string, kind: ExecutionFile['kind'], turn: number | null = null): ExecutionFile => ({
      kind,
      relativePath,
      absolutePath: relativePath,
      turn,
    });
    expect(executionFileLabel(file('response.md', 'response'))).toBe('response.md');
    expect(executionFileLabel(file('turns/turn-2/verify.md', 'verify', 2))).toBe('verify · turn 2');
    expect(executionFileLabel(file('turns/x/verify.md', 'verify'))).toBe('verify · turn ?');
    expect(executionFileLabel(file('artifacts/out.txt', 'artifact'))).toBe('out.txt');
  });
});

describe('sessionsDiagnostic', () => {
  const scan = (overrides: Partial<ScanOutcome>): ScanOutcome => ({
    state: 'ok',
    error: null,
    discovered: [],
    eligible: [],
    pending: [],
    ...overrides,
  });

  it('distinguishes an unreadable folder from an empty or missing one, and is null with sessions', () => {
    expect(sessionsDiagnostic(scan({ state: 'unreadable', error: 'EACCES' }))).toMatchObject({
      code: 'scan-unreadable',
      detail: 'EACCES',
    });
    expect(sessionsDiagnostic(scan({ state: 'missing' }))).toMatchObject({ code: 'no-sessions' });
    expect(sessionsDiagnostic(scan({ state: 'empty' }))).toMatchObject({ code: 'no-sessions' });
    expect(sessionsDiagnostic(scan({ discovered: ['p'], pending: ['p'] }))).toMatchObject({ code: 'no-sessions' });
    expect(sessionsDiagnostic(scan({ discovered: ['a'], eligible: ['a'] }))).toBeNull();
  });
});

describe('nodeIds', () => {
  it('builds identity strings without any state', () => {
    expect(nodeIds.session('file:///p', 's1')).toBe('session:file:///p#s1');
    expect(nodeIds.group('k', 'running')).toBe('group:k#running');
    expect(nodeIds.execution('k', 's', 'e')).toBe('execution:k#s/e');
    expect(nodeIds.more('k')).toBe('more:k');
    expect(nodeIds.diagnostic('k', 'no-sessions')).toBe('diag:k#no-sessions');
  });

  it('keeps two projects with the same session id distinct', () => {
    expect(nodeIds.session('a', 's1')).not.toBe(nodeIds.session('b', 's1'));
  });
});

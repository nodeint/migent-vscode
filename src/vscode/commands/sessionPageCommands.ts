import * as vscode from 'vscode';

import type { SessionSnapshot } from '../../core/model';
import { isRecord } from '../../core/record';
import { SESSION_TABS, type SessionBatchRef, type SessionTab } from '../../core/sessionPageModel';
import type { NextStepFlow } from '../nextStep/flow';
import type { SessionOpenOptions, SessionPanels } from '../session/panels';
import { registerNextStepCommands } from './nextStepCommands';
import { type CommandHost, resolve } from './sessionCommands';

/** The options a caller may attach to the explicit target it passes to `migent.session.open`. */
interface Requested {
  tab?: SessionTab;
  batch?: SessionBatchRef;
}

function tabOf(value: unknown): SessionTab | undefined {
  return SESSION_TABS.find((tab) => tab === value);
}

function requestedFrom(arg: unknown): Requested {
  if (!isRecord(arg)) return {};
  const executionId = typeof arg.executionId === 'string' && arg.executionId !== '' ? arg.executionId : undefined;
  const stageId = typeof arg.stageId === 'string' && arg.stageId !== '' ? arg.stageId : null;
  return {
    tab: tabOf(arg.tab),
    batch: executionId === undefined ? undefined : { stageId, executionId },
  };
}

const hasPending = (snapshot: SessionSnapshot): boolean => (snapshot.status?.questions.length ?? 0) > 0;

/** The stage of an execution, from the session's pending questions when the caller did not name it. */
function stageOf(snapshot: SessionSnapshot, stageId: string | null, executionId: string): string | null {
  if (stageId !== null) return stageId;
  const question = (snapshot.status?.questions ?? []).find((candidate) => candidate.executionId === executionId);
  return question?.stageId ?? null;
}

function optionsFor(snapshot: SessionSnapshot, requested: Requested, executionId: string | undefined): SessionOpenOptions {
  const tab = requested.tab ?? (executionId !== undefined || hasPending(snapshot) ? 'questions' : 'results');
  if (tab !== 'questions' || executionId === undefined) return { tab };
  return {
    tab,
    batch: { stageId: stageOf(snapshot, requested.batch?.stageId ?? null, executionId), executionId },
  };
}

/**
 * The one way to open a Session page. Called with a tree node, a notification target or an explicit
 * `{ project, sessionId, tab?, stageId?, executionId? }`; it resolves the session afresh and opens the requested tab.
 * A session with a pending batch opens on Questions, otherwise on Results.
 */
export function registerSessionPageCommands(
  host: CommandHost,
  session: SessionPanels,
  nextStep: NextStepFlow,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('migent.session.open', async (arg: unknown) => {
      const requested = requestedFrom(arg);
      const resolved = await resolve(host, arg, 'Open which session?');
      if (resolved === undefined) return;
      const { context, snapshot, target } = resolved;
      const executionId = requested.batch?.executionId ?? target?.executionId;
      session.open(
        { project: context.key, sessionId: snapshot.sessionId },
        optionsFor(snapshot, requested, executionId),
      );
    }),
    ...registerNextStepCommands(host, nextStep),
  ];
}

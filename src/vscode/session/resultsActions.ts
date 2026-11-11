import path from 'node:path';

import * as vscode from 'vscode';

import { manifestPath, nextPath, sessionDir, workflowsDir } from '../../core/paths';
import type { ResultsIntent, SessionAction } from '../../core/resultsIntent';
import { resolveHandoffPath, resolveHandoffValue, resolveOutputPath, type ResultsInput } from '../../core/resultsModel';
import type { SessionTab } from '../../core/sessionPageModel';
import type { WorkflowEntry } from '../../core/workflows';
import { text } from '../../text';
import { notify } from '../notices';
import { openFile } from '../openFile';
import type { ProjectContext, ProjectRegistry } from '../projects';
import type { Entry, Identity } from './entry';

const INFO_MESSAGE_MS = 5000;

/** What the Overview intent handlers need from the Session panel set; passed in so the dependency stays one way. */
export interface ResultsActionDeps {
  registry: ProjectRegistry;
  /** Opens the Next step feature; a no-op until the extension has set it. */
  openNextStep: (identity: Identity, workflow: string) => void;
  sessionAction: (entry: Entry, action: SessionAction) => Promise<void>;
  open: (identity: Identity, options: { tab: SessionTab }) => void;
}

/** Run one Overview/Results intent of a session page. */
export async function runResultsIntent(deps: ResultsActionDeps, entry: Entry, intent: ResultsIntent): Promise<void> {
  const context = deps.registry.project(entry.project);
  if (context === undefined) return;
  const input: ResultsInput = {
    sessionId: entry.sessionId,
    sessionDirPath: sessionDir(context.root, entry.sessionId),
    snapshots: context.store.all(),
    eligibleIds: context.store.scanOutcome.eligible,
    workflows: context.catalog.workflows().entries,
  };
  const identity = { project: entry.project, sessionId: entry.sessionId };
  switch (intent.intent) {
    case 'openOutput': {
      const file = resolveOutputPath(input, intent.name);
      if (file === null) notify('session.outputNotFound', { name: intent.name });
      else await openFile(file, text('prompts.fileKindOutput'));
      return;
    }
    case 'openHandoffFile': {
      const file = resolveHandoffPath(input, intent.name);
      if (file === null) notify('session.handoffNotFound', { name: intent.name });
      else await openFile(file, text('prompts.fileKindHandoff'));
      return;
    }
    case 'copyValue':
      return copyValue(input, intent);
    case 'openNextStep':
      deps.openNextStep(identity, intent.workflow);
      return;
    case 'openNextFile':
      await openFile(nextPath(context.root, entry.sessionId), 'next.json');
      return;
    case 'openManifest':
      await openFile(manifestPath(context.root, entry.sessionId), 'manifest.yaml');
      return;
    case 'openTargetWorkflow':
      await openWorkflow(context, intent.workflow);
      return;
    case 'sessionAction':
      await deps.sessionAction(entry, intent.action);
      return;
    case 'openSession':
      openSession(deps, { entry, context }, intent.sessionId);
  }
}

async function copyValue(input: ResultsInput, intent: Extract<ResultsIntent, { intent: 'copyValue' }>): Promise<void> {
  const value = intent.kind === 'sessionId'
    ? intent.sessionId
    : resolveHandoffValue(input, intent.name, intent.kind === 'handoffHash' ? 'hash' : 'sourcePath');
  if (value === null) {
    notify('session.copyUnavailable');
    return;
  }
  await vscode.env.clipboard.writeText(value);
}

interface SessionTarget {
  entry: Entry;
  context: ProjectContext;
}

function openSession(deps: ResultsActionDeps, target: SessionTarget, sessionId: string): void {
  if (target.context.store.snapshot(sessionId) === undefined) {
    vscode.window.setStatusBarMessage(text('prompts.sessionNotShown', { id: sessionId }), INFO_MESSAGE_MS);
    return;
  }
  deps.open({ project: target.entry.project, sessionId }, { tab: 'overview' });
}

async function openWorkflow(context: ProjectContext, workflow: string): Promise<void> {
  const matches = context.catalog.workflows().entries.filter((candidate) => candidate.id === workflow);
  if (matches.length === 0) { notify('session.workflowNotFound', { workflow }); return; }
  let [target]: (WorkflowEntry | undefined)[] = matches;
  if (matches.length > 1) {
    const picked = await vscode.window.showQuickPick(
      matches.map((candidate) => ({ label: candidate.file, candidate })),
      { title: text('prompts.workflowDuplicated', { workflow }) },
    );
    target = picked?.candidate;
  }
  if (target !== undefined) await openFile(path.join(workflowsDir(context.root), target.file), text('prompts.fileKindWorkflow'));
}

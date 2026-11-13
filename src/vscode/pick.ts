import * as vscode from 'vscode';

import type { SessionSnapshot } from '../core/model';
import { sessionDescription, sessionRowLabel } from '../core/sessionPresentation';
import { text } from '../text';
import type { ProjectContext, ProjectRegistry } from './projects';

const INFO_MESSAGE_MS = 5000;

export interface PickedSession {
  context: ProjectContext;
  snapshot: SessionSnapshot;
}

/** The only project, or the one chosen from a Quick Pick when several are open. */
export async function pickProject(registry: ProjectRegistry): Promise<ProjectContext | undefined> {
  const projects = registry.projects();
  if (projects.length === 0) {
    vscode.window.setStatusBarMessage(text('prompts.noProjectOpen'), INFO_MESSAGE_MS);
    return undefined;
  }
  if (projects.length === 1) return projects[0];
  const picked = await vscode.window.showQuickPick(
    projects.map((context) => ({ label: context.folder.name, description: context.root, context })),
    { title: text('prompts.migentProject'), placeHolder: text('prompts.selectProject') },
  );
  return picked?.context;
}

/**
 * Resolve a session for a command invoked from the Command Palette. A stale tree selection
 * is never an implicit target: the user picks.
 */
export async function pickSession(
  registry: ProjectRegistry,
  title: string,
  isEligible: (snapshot: SessionSnapshot) => boolean = () => true,
): Promise<PickedSession | undefined> {
  const context = await pickProject(registry);
  if (context === undefined) return undefined;
  const snapshots = context.store.all().filter(isEligible);
  if (snapshots.length === 0) {
    vscode.window.setStatusBarMessage(text('prompts.noMatchingSessions'), INFO_MESSAGE_MS);
    return undefined;
  }
  const now = Date.now();
  const picked = await vscode.window.showQuickPick(
    snapshots.map((snapshot) => ({
      label: sessionRowLabel(snapshot),
      description: sessionDescription(snapshot, now),
      detail: text('prompts.sessionDetail', { state: snapshot.displayState.state, id: snapshot.sessionId }),
      snapshot,
    })),
    { title, placeHolder: text('prompts.selectSession'), matchOnDescription: true, matchOnDetail: true },
  );
  return picked === undefined ? undefined : { context, snapshot: picked.snapshot };
}

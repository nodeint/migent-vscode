import type { FileTarget } from '../core/watchPlan';

/** `workspaceFolder.uri.toString()`: identifies a project across the host. Core events carry `projectRoot`. */
export type ProjectKey = string;

/**
 * The single change stream views subscribe to (plans/02-monitoring.md §5.2). Events carry
 * identity, never data: consumers read the store, the catalog or a stateless reader.
 */
export type MigentChange =
  | { type: 'session'; project: ProjectKey; sessionId: string; kind: 'added' | 'updated' | 'removed' }
  /** Watcher-classified file changes; no store was involved. */
  | { type: 'files'; project: ProjectKey; sessionId: string; targets: FileTarget[] }
  | { type: 'project'; project: ProjectKey; kind: 'scan' | 'workflows' | 'config' }
  /** A project was added or removed. */
  | { type: 'projects' }
  /** Full Refresh finished: re-read everything displayed. */
  | { type: 'refresh' }
  /** Reserved for the CLI capability service. */
  | { type: 'capability'; project: ProjectKey }
  /** The window-level CLI state changed; it has no project because it exists before any project does. */
  | { type: 'cliWindow' };

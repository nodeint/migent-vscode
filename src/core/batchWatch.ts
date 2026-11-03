import type { SessionSnapshot } from './model';
import { groupPendingQuestions } from './questions';

/** A pending question batch newly observed for a session. */
export interface ObservedBatch {
  sessionId: string;
  stageId: string | null;
  executionId: string;
  count: number;
}

/**
 * Track which `(session, execution)` batches were already seen. `isSeed` records the current ones silently
 * (startup, refresh, project discovery); otherwise the unseen ones are returned once. Identity is the
 * execution, so a follow-up round (a new execution) is a new batch even with the same question numbers.
 */
export class BatchWatch {
  readonly #seen = new Set<string>();

  public observe(project: string, snapshot: SessionSnapshot | undefined, isSeed: boolean): ObservedBatch[] {
    const fresh: ObservedBatch[] = [];
    const groups = groupPendingQuestions(snapshot?.status?.questions ?? []);
    for (const group of groups) {
      if (group.executionId === null) continue;
      const key = `${project}#${snapshot?.sessionId ?? ''}#${group.executionId}`;
      if (this.#seen.has(key)) continue;
      this.#seen.add(key);
      if (!isSeed) {
        fresh.push({
          sessionId: snapshot?.sessionId ?? '',
          stageId: group.stageId,
          executionId: group.executionId,
          count: group.questions.length,
        });
      }
    }
    return fresh;
  }
}

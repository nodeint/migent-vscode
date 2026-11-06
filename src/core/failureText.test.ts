import { describe, expect, it } from 'vitest';

import { describeFailure } from './failureText';

// Captured from migent 0.3.5: a draft whose `id` was changed (exit 2, nothing written).
const ID_REJECTION = 'migent: Session workflow id is wrong, not plan. Do not change id in workflow.yaml.';
// Captured from migent 0.3.5: an empty task.md is also exit 2 but has nothing to do with the draft.
const EMPTY_TASK = 'migent: Session s has no task.md or it is empty. Write .migent/sessions/s/task.md before starting.';

describe('describeFailure', () => {
  it('points to the draft when the CLI diagnostic names workflow.yaml', () => {
    const result = describeFailure({ outcome: 'ConfigError', exitCode: 2, last: ID_REJECTION, isDrafted: true });
    expect(result.offersDraft).toBe(true);
    expect(result.message).toBe(`Migent rejected this session's workflow.yaml. ${ID_REJECTION}`);
  });

  it('stays neutral for another exit-2 cause on a drafted session, and still offers the draft', () => {
    const result = describeFailure({ outcome: 'ConfigError', exitCode: 2, last: EMPTY_TASK, isDrafted: true });
    expect(result.offersDraft).toBe(true);
    expect(result.message).toBe(
      `Migent reported a configuration error. ${EMPTY_TASK} Check this session's workflow.yaml and the log.`,
    );
    expect(result.message).not.toContain('rejected');
  });

  it('reports a failed pre-run check without blaming the draft text', () => {
    // Captured from migent 0.3.6: the last line of a failed preflight (exit 2, session still prepared).
    const last = 'Preflight failed: fix the problems above and run again, or pass --skip-preflight.';
    const message = "Migent's pre-run check failed. The log lists the problems; fix them and run again.";
    expect(describeFailure({ outcome: 'ConfigError', exitCode: 2, last, isDrafted: true })).toEqual({
      message,
      offersDraft: true,
    });
    expect(describeFailure({ outcome: 'ConfigError', exitCode: 2, last, isDrafted: false })).toEqual({
      message,
      offersDraft: false,
    });
  });

  it('does not take workflow.frozen.yaml for the draft', () => {
    const result = describeFailure({
      outcome: 'ConfigError',
      exitCode: 2,
      last: 'migent: cannot read workflow.frozen.yaml',
      isDrafted: true,
    });
    expect(result.message).not.toContain('rejected');
  });

  it('keeps the earlier wording for a session without workflow.yaml', () => {
    expect(describeFailure({ outcome: 'ConfigError', exitCode: 2, last: ID_REJECTION, isDrafted: false })).toEqual({
      message: `Migent reported a configuration error. ${ID_REJECTION}`,
      offersDraft: false,
    });
    expect(describeFailure({ outcome: 'ConfigError', exitCode: 2, last: undefined, isDrafted: false }).message).toBe(
      'Migent reported a configuration error.',
    );
  });

  it('never blames the draft for another exit code', () => {
    expect(describeFailure({ outcome: 'Unknown', exitCode: 77, last: 'boom', isDrafted: true })).toEqual({
      message: 'Migent exited with code 77. boom',
      offersDraft: false,
    });
  });
});

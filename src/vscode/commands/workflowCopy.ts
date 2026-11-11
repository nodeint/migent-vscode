import { invokeJson } from '../../cli/invoke';
import type { LaunchSpec } from '../../cli/locate';
import { parseWorkflowAuthoringEnvelope } from '../../core/workflowEditor';
import { text } from '../../text';
import { envelopeOf, SAVE_TIMEOUT_MS, saveArgs, saveFailure } from '../workflowEditor/panels';

/**
 * Create a workflow file from a copy's text with `workflow save` and no base hash, so the CLI is the only writer
 * and refuses to replace an existing file. The CLI re-serializes a new file, so the copy loses the source's comments.
 * Returns an error text, or null once the CLI confirms the file was written.
 */
export async function createWorkflowCopy(
  launch: LaunchSpec,
  root: string,
  draft: { file: string; text: string },
): Promise<string | null> {
  const result = await invokeJson(launch, saveArgs(draft.file, null), {
    cwd: root,
    input: draft.text,
    timeoutMs: SAVE_TIMEOUT_MS,
  });
  const envelope =
    result.kind === 'ok' ? parseWorkflowAuthoringEnvelope(result.value) : envelopeOf(result.error.stdout);
  if (result.kind === 'ok' && envelope?.written === true) return null;
  const problem = envelope?.diagnostics.find((item) => item.severity === 'error')?.message;
  if (problem !== undefined) return problem;
  if (result.kind === 'error') return saveFailure(result.error.exitCode, result.error.stderr);
  return text('prompts.saveNotConfirmed');
}

# Captured CLI samples

Real files written by `migent` 0.3.1 on 2026-11-01 (the two draft samples by 0.3.5 on 2026-11-05),
with session ids, machine paths, host names and provider details redacted.
They document formats that the upstream docs describe only in prose.
They are not part of `fixtures/sessions`, so the shared test layout does not copy them.

| Directory | What it shows |
| :--- | :--- |
| `question-pending` | Role session stopped with `status: question`; `status.json.questions` records and the session and execution `questions.json` with `pending` records. Reconstructed from the CLI output observed before the reply. |
| `question-answered` | The same session after `session continue --reply "1B, 2A+C, 3 <text>"`: `answered` records with `selected` and `text`, and `answered_at`. |
| `handoff-source` | Completed workflow session with `downstream`: `next.json` v1 and its `status.json` outputs. |
| `handoff-target` | Session started with `--prior`: manifest `prior_session_id` and `handoff` mapping, and `status.json.handoff`. |
| `numeric-ids-0.5.6` | CLI 0.5.6 `session prepare` then `session rename`: the session id is the quoted string `"1"`, and `title.json` holds the new title and the `history` of earlier titles (`changed_at`) next to the unchanged manifest and status titles. |
| `prepared-draft` | migent 0.3.5 `session prepare`: `status: prepared`, an empty `task.md`, the editable `workflow.yaml` (the `workflow_path` of the manifest and status) and no `workflow.frozen.yaml`. |
| `started-draft` | A 0.3.5 session after `session run --session`: `workflow.yaml` is kept next to `workflow.frozen.yaml`, which wraps the workflow as `source_sha256` and `workflow`. The provider event is dropped. |

Behavior recorded from 0.3.5 and relied on by the extension, which the files above do not show:

- A draft whose `id` differs from the manifest is rejected before anything is written: exit 2, stderr
  `migent: Session workflow id is <found>, not <expected>. Do not change id in workflow.yaml.`, status still `prepared`.
  An empty `task.md` is also exit 2 (`... has no task.md or it is empty ...`), so exit 2 alone does not identify the draft.
- `workflow.yaml` survives freezing. `session continue` uses the frozen copy; `--refresh-workflow` re-freezes from the
  session's `workflow.yaml`, not from `.migent/workflows`.
- `session run --session <id> --workflow <id>` (Save & Run) still validates and freezes the draft.

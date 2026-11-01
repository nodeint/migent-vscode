# Captured CLI samples

Real files written by `migent` 0.3.1 on 2026-11-01, with session ids, machine paths, host names and
provider details redacted. They document formats that the upstream docs describe only in prose.
They are not part of `fixtures/sessions`, so the shared test layout does not copy them.

| Directory | What it shows |
| :--- | :--- |
| `question-pending` | Role session stopped with `status: question`; `status.json.questions` records and the session and execution `questions.json` with `pending` records. Reconstructed from the CLI output observed before the reply. |
| `question-answered` | The same session after `session continue --reply "1B, 2A+C, 3 <text>"`: `answered` records with `selected` and `text`, and `answered_at`. |
| `handoff-source` | Completed workflow session with `downstream`: `next.json` v1 and its `status.json` outputs. |
| `handoff-target` | Session started with `--prior`: manifest `prior_session_id` and `handoff` mapping, and `status.json.handoff`. |

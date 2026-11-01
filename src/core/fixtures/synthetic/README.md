# Synthetic fixtures

Hand-written files for shapes that no captured migent sample covers yet. They follow the observed shapes in
[`../captured/`](../captured/README.md); the unobserved parts are guesses, so a future captured sample should replace
them.

| Directory | Unobserved part |
| :--- | :--- |
| `running-questions` | Pending `status.json.questions` while the session also has a live lock (the lock is added by the test) |
| `blocked-questions` | Pending questions in a Blocked session |
| `questions-superseded` | A `superseded` record, and an answer outside the observed shapes |
| `next-unsupported` | `next.json` with `schema_version` 2 |
| `next-invalid` | `next.json` that is not JSON |
| `frozen-downstream` | `workflow.downstream` in `workflow.frozen.yaml` (captured sample is in `captured/handoff-source`; this one adds a second entry with a different mapping) |

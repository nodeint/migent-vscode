# Plan: Migent for VS Code

Goal: let developers manage and monitor sessions and run workflows directly inside VS Code, without opening a terminal.

Prerequisite: [`session-cancel.md`](./session-cancel.md) must land first, because the Stop button needs `migent session cancel` (Windows has no signal for a graceful cancel).

## 1. Design principles

1. **Native first.** TreeView, Quick Pick, Input Box, status bar, notifications and the built-in editor cover most needs. Small editor webviews cover the read-only Results overview, the human-question batch form in phase 3a, and a separate downstream Next step page in phase 3b; workflow graph and metrics dashboard are later webviews. Native session header actions stay intact. Task/config/workflow/output files keep their normal editors.
2. **Files are the source of truth.** The extension reads `.migent/sessions/**` and keeps no separate authoritative session state. Extension-owned drafts, panel state and transient command gates are separate from persisted Migent snapshots. Sessions started from a terminal or by another agent show up too.
3. **Commands go through the CLI.** Every write operation (run, continue, cancel, prepare) calls `migent`. The extension never writes to `status.json`, `events.jsonl`, `manifest.yaml` or `executions/` (docs/sessions.md forbids hand-editing these files).
4. **Do not import `@nodeint/migent-kernel`.** The README says internal packages have no stable API. The only contract is: documented file formats, `--json` output and exit codes.
5. **Pure logic is separated from `vscode`.** The `core/` directory never imports `vscode` and can be tested with vitest without launching VS Code.
6. **Refuse to guess.** On an unknown `schema_version` or CLI version, switch to read-only mode and say so clearly instead of inferring.
7. **Make the target and next step explicit.** Palette commands pick a project/session; context and document commands retain their original target throughout async work. Prefer one primary action based on state and cause, with blocker/failure context available after notifications disappear.
8. **Preserve work and distinguish pending from persisted state.** Save before Run/Reply, recover drafts after reload, and keep Starting/Stopping command state separate from watcher-derived snapshots. Background changes preserve editor focus and tree expansion. Capability restrictions apply to the affected project/session, with a reason and recovery action.

## 2. Repo, tooling, release

- Separate repo: `nodeint/migent-vscode` (reason: the extension is only a consumer of the public contract; its toolchain and release cadence differ from the CLI).
- TypeScript, built with esbuild (a single bundled `dist/extension.js`, `external: ["vscode"]`), tested with vitest for `core/` and `@vscode/test-electron` for integration.
- Package manager: pnpm (matches migent). Lint/format follow migent's config where available.
- Release: `vsce package` → VS Code Marketplace, plus Open VSX. Publisher: `nodeint` (see Decisions).
- `engines.vscode`: `^1.90.0` (re-confirm when scaffolding; only raise it when a newer API is needed).
- Activation: `activationEvents: ["workspaceContains:.migent/config.yaml"]`, never `*`.
- Multi-root workspaces: each folder containing `.migent/` is its own "project".

## 3. Contract with migent

The extension depends on the following. Changing any of them is a contract change, must bump `schema_version`, and must be communicated to the extension repo.

| Source | Used for | Notes |
|---|---|---|
| `manifest.yaml` | id, title, workflow_id, created_at, `schema_version` | currently `schema_version: 2` |
| `status.json` | session status | written atomically |
| `status.json.questions` | pending human-question summary | pending questions can coexist with Running/Blocked sessions |
| `questions.json` | session question history and recorded answers | question-file `schema_version: 1`; identity `(execution_id, id)` scoped by project/session |
| `executions/<id>/questions.json` | original question batch | use assigned question numbers/option letters, not agent-response prose |
| `session.lock` | session is running | `{pid, host, started_at, heartbeat_at, nonce}`, stale after 30 seconds |
| `events.jsonl` | timeline | envelope `{v, seq, event, timestamp, execution_id, stage_id, summary, data}` |
| `executions/<id>/execution.json` | stage, attempt, provider, model, status, outcome, owner_pid, hostname | |
| `executions/<id>/{prompt.md,response.md,artifacts/,turns/*/verify.md}` | open for viewing | read-only |
| `executions/<id>/stream.jsonl` | detailed provider log | read only when the user opens it |
| `outputs/*` | published results | `status.json.outputs` carries paths and provenance |
| `next.json` | Completed-source next-workflow suggestions | next-file version 1; presentation only, not authority to execute arbitrary argv or remap context |
| `workflow.frozen.yaml` | canonical source downstream declaration | workflow schema v4 adds downstream; current source YAML must not replace its frozen suggestions |
| Target manifest `prior_session_id`, `handoff` and `handoff/` | source/child links, CLI-bound snapshots and provenance | Prepare records prior only; binding/hash/freeze happen at target start |
| `metrics.json` | tokens, cost, duration | only present once a workflow session is `completed` |
| `.migent/workflows/*.yaml` | workflow list for Run | read `id`/file name and `stages` for display |
| `.migent/config.yaml` | Project view / native YAML editor | open original file; separate from VS Code extension settings |
| `migent --version` | compatibility check | |
| `migent session list/show/metrics --json` | initial load, reconciliation | |
| `migent session run/continue/prepare/cancel` | operations | exit codes: 0 done, 1 not finished, 3 stage_failed, 6 verify_exhausted, 7 verify, 8 quota, 9 awaiting answers, 130 cancelled |
| `migent session continue --stage ... --reply-file ...` | submit a human batch as a JSON answer map | acceptance is reconciled from persisted answers separately from subsequent dispatch |
| `migent session run/prepare --workflow ... --prior ...` | explicit new child/session handoff | source must be Completed; no automatic chaining; optional Run task override |

Human-question contract: [`docs/human-in-the-loop.md`](../../migent/docs/human-in-the-loop.md). Workflow `schema_version: 3` enables `ask: human`; execution outcome `question` is distinct from `blocked` and a completed workflow decision. Schema versions for workflow, manifest and question history are independent. Detailed extension design: [`03a-human-input.md`](./03a-human-input.md).

Downstream contract: [workflows](../../migent/docs/workflows.md#downstream-handoff) and [session handoff](../../migent/docs/sessions.md#reusable-workflow-boundaries). Workflow version 4, next-file version 1 and manifest schemas are independent. Results retains its content/header and adds suggestions; each selected suggestion opens a separate Next step page. Detailed design: [`03b-downstream-handoff.md`](./03b-downstream-handoff.md).

Startup check: `migent --version` ≥ the minimum version (configured in the extension). If the CLI is missing or too old, show install/configure instructions and disable writes while retaining any disk-readable sessions. An empty project gets a welcome view; a capability error must not look like an empty session list. If `session cancel` is missing, hide the Stop button.

## 4. Phases

Each phase has its own plan file with scope, details and exit criteria. Display state, SessionStore, watcher, event tail, CLI execution, UI, settings and webview details live in those files.

| Phase | File | Outcome |
|---|---|---|
| 0 | (below) | Preparation outside this repo |
| 1 | [`01-core.md`](./01-core.md) | Skeleton, `core/`, display state, store, event tail, fixtures |
| 2 | [`02-monitoring.md`](./02-monitoring.md) | Read-only MVP: watcher, Sessions/Workflows/Project views, Results with suggestion metadata, native files, status bar, logs |
| 3 | [`03-control.md`](./03-control.md) | Run/continue/reply/cancel via CLI, per-workflow Run action, notifications |
| 3a (within phase 3) | [`03a-human-input.md`](./03a-human-input.md) | Structured human-question form, batch JSON submission, drafts/history and recorded-answer recovery |
| 3b (within phase 3) | [`03b-downstream-handoff.md`](./03b-downstream-handoff.md) | Separate Next step page, explicit downstream Run/Prepare, prior links, deferred context binding and recovery |
| 4 | [`04-release.md`](./04-release.md) | Multi-root polish, docs, testing checklist, release 0.1 |
| 5 | [`05-later.md`](./05-later.md) | Workflow graph, metrics dashboard, execution diff, schema |

### Design references

Interactive prototypes live in [`designs/`](../designs/README.md), separate from implementation plans:

| Plan | Design |
|---|---|
| Phase 2 | [Monitoring](../designs/02-monitoring-ui.html) |
| Phase 3 | [Session controls](../designs/03-control-ui.html) |
| Phase 3a | [Human input](../designs/human-questions-ui.html) |
| Phase 3b | [Results and downstream Next step](../designs/downstream-handoff-ui.html) |

### Phase 0: Preparation (outside the extension repo)
- Finish `session cancel` ([`session-cancel.md`](./session-cancel.md)).
- Review `docs/sessions.md` as the contract document; record in migent's CONTRIBUTING that changing a file format is a contract change.
- Settle the publisher and extension name (`migent` / `nodeint.migent-vscode`).

## 5. Architecture

```
migent-vscode/
  src/
    extension.ts               # activate/deactivate: wiring only
    core/                      # does NOT import vscode
      paths.ts                 # paths inside .migent
      manifest.ts              # parse manifest.yaml (`yaml` library)
      statusReader.ts          # safe status.json reader (retry while being written)
      lockProbe.ts             # session.lock -> alive | stale | none
      displayState.ts          # deriveDisplayState
      eventTail.ts             # tail events.jsonl by byte offset
      executions.ts            # read execution.json for the tree
      workflows.ts             # list and read .migent/workflows
      questions.ts             # question/history readers, pending batches, fingerprints
      questionAnswers.ts       # pure answer validation and JSON reply-map serialization
      nextWorkflows.ts         # next suggestions and frozen-declaration comparison
      handoff.ts               # source/child identity and recorded snapshot provenance
      model.ts                 # types: SessionSnapshot, ExecutionSnapshot...
      store.ts                 # SessionStore: snapshot + change events
    cli/
      locate.ts                # find the migent binary (setting, PATH, node_modules)
      invoke.ts                # run short commands, parse --json
      runner.ts                # manage long-running processes: run/continue, cancel
      version.ts               # compatibility check
    vscode/                    # glue to the VS Code API
      projects.ts              # track workspace folders containing .migent
      watcher.ts               # FileSystemWatcher -> store
      views/sessionsTree.ts
      views/workflowsTree.ts
      views/projectTree.ts
      views/welcome.ts
      statusBar.ts
      notifications.ts
      content/sessionDocs.ts   # TextDocumentContentProvider
      humanInput/              # panel host, draft/submission storage, reconciliation
      results/                 # Results overview and separate Next step hosts, native header actions
      log/channels.ts          # per-session LogOutputChannel
      commands/*.ts            # one file per command
      pick.ts                  # Quick Pick for workflows, sessions
  test/
    fixtures/sessions/         # real (redacted) sessions, one per state
    core/*.test.ts
    integration/*.test.ts
  media/humanInput/            # batch form assets; no filesystem/CLI access
  media/results/               # read-only Results and separate Next step assets
  package.json  esbuild.mjs  tsconfig.json  .vscodeignore
```

Data flows one way: **watcher → store → view**. Views never read the disk themselves. Commands call the CLI, and the result comes back through the watcher (files change); commands never update the store directly, which avoids two sources of truth.


## 6. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Cancelling a session on Windows | Wait for `session cancel`; hide the Stop button if the CLI lacks it |
| `detached` child on Windows opens a console window or dies when VS Code exits | `windowsHide: true`; test early in phase 3 and decide between detached and attached to the extension host |
| VS Code watcher is late, coalesces or drops events | Debounce, re-read by state (not by event), 10-second timer while something is Running |
| `.migent/sessions` hidden by `files.watcherExclude` or `.gitignore` | Use `RelativePattern`; test with default config; note it in the README |
| `status.json` read mid-write | Atomic writes on the migent side; up to 3 re-reads |
| Hundreds of sessions slow things down | Lazy loading, limit N, watch only running sessions |
| Migent changes file formats | `schema_version`, fixtures, contract tests, read-only mode |
| Lock from another machine (shared folder) | Show Running, disable write operations |
| Sensitive data in fixtures | Redact paths, hostnames and real prompts before committing |
| Human answers recorded but continuation fails | Reconcile original question records; continue without resubmitting accepted answers |
| Another client replaces a question batch during submission | Stable identities/fingerprints and preflight checks; resolve the CLI-side batch-binding gap documented in phase 3a before claiming atomic protection |
| Downstream launch replaces Results or loses its controls | Add suggestions only; keep Results/header and open Next step separately; regression tests in phase 3b |
| Lost downstream acknowledgment causes duplicate children | Persist launch identity, reconcile observed prior/target links, never automatically resend an uncertain launch |
| Edited next metadata or mutable source context changes a handoff | Validate against frozen declarations; CLI binds and records snapshots/provenance; child resume uses recorded context |

## 7. Decisions

1. Publisher `nodeint`, display name `Migent`. The publisher must be created on the VS Code Marketplace and Open VSX before phase 4.
2. `engines.vscode`: `^1.90.0`; only raise it when a newer API is needed.
3. Remote (SSH, WSL, Dev Containers): no special work for 0.1. `extensionKind: ["workspace"]`; the README states the CLI must be installed on the remote machine; one manual WSL test before release.
4. Processes started by the extension always survive closing VS Code (detached). No setting, no warning on close. Verify early in phase 3 that this works on Windows; if not, decide a fallback then.
5. Telemetry: none.
6. License: MIT, like migent.

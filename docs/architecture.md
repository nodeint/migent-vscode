# Architecture

This page maps the extension's runtime composition and module responsibilities.
For file-reader and state behavior, see [Core behavior](core.md).

## Current runtime

[extension.ts](../src/extension.ts) builds a `ProjectRegistry`, the context keys and
the liveness timer, and registers `migent.refresh`. It returns a small API
(`registry`, `capability`, `workflowsTree`, `projectTree`, `tails`, `logs`, `statusBar`, `results`, `ready`)
that integration tests use. Discovery and
the first load run after `activate()` returns. The Sessions view, its read-only commands and the status bar
(running and needs-attention counts) exist, a Completed session opens a read-only Results page, and the
Workflows and Project views list the project catalog. Timeline documents and per-session log channels read
`events.jsonl` only while one is open. CLI capability checks run once
per trigger (a project appearing, a `migent.cli.*` change, Recheck) and never hide data read from disk.

Data flows watcher, then store, then consumer; consumers never read disk:

```text
disk --FileSystemWatcher--> ProjectWatcher --> SessionStore / ProjectCatalog (core)
                                   |                   | change events
                                   v                   v
                             `files` changes     ProjectRegistry --> MigentChange stream
```

The registry owns one `ProjectContext` per workspace folder that has a `.migent/`
directory (store, catalog, watcher) and an anchor watcher per `file` folder, so
creating or deleting `.migent/` promotes or demotes the folder without a reload.
Each `ProjectWatcher` mirrors core's desired watcher set (non-recursive watchers,
one per folder), classifies and coalesces events, and calls the store, the catalog
or the `files` callback. Consumers keep detail folders watched with
`retain(target)` and release them by disposing the handle. Watcher creation goes
through [watchBackend.ts](../src/vscode/watchBackend.ts), the one seam a
different backend would replace.

The store holds an in-memory projection; persisted Migent files remain the source
of truth. Core imports no `vscode` API and does not modify session files.

## Ownership map

| Responsibility | Implementation | Boundary |
| :--- | :--- | :--- |
| Activation and command registration | [extension.ts](../src/extension.ts) | VS Code lifecycle and wiring |
| Project discovery and change stream | [projects.ts](../src/vscode/projects.ts), [changes.ts](../src/vscode/changes.ts) | One `ProjectContext` per project; re-emits store, catalog and watcher changes as `MigentChange` |
| Watcher ownership | [watcher.ts](../src/vscode/watcher.ts), [watchBackend.ts](../src/vscode/watchBackend.ts) | Creates, diffs and disposes `FileSystemWatcher`s from core's plan; routes events; reads no detail data |
| Sessions view | [sessionsTree.ts](../src/vscode/views/sessionsTree.ts), [sessionChildren.ts](../src/vscode/views/sessionChildren.ts), [nodes.ts](../src/vscode/views/nodes.ts) | Identity-only nodes, `TreeItem`s built from the live store, children read on expand with core readers, narrow batched refreshes, badge, watch targets retained while a node is expanded; no file-system calls of its own |
| Workflows and Project views | [workflowsTree.ts](../src/vscode/views/workflowsTree.ts), [projectTree.ts](../src/vscode/views/projectTree.ts), [projectNodes.ts](../src/vscode/views/projectNodes.ts), [projectCommands.ts](../src/vscode/commands/projectCommands.ts), [projectPresentation.ts](../src/core/projectPresentation.ts) | Render the project catalog (workflow entries and `config.yaml` state) with distinct missing/empty/unreadable rows; refreshed only by the matching `project` change, never by session changes; `migent.workflow.open` and `migent.openConfig` open the real file and never create it |
| Row text and ids | [sessionPresentation.ts](../src/core/sessionPresentation.ts) | Pure label, description, tooltip, `contextValue`, icon and node-id rules |
| Session commands | [sessionCommands.ts](../src/vscode/commands/sessionCommands.ts), [pick.ts](../src/vscode/pick.ts) | Open files, copy id, reveal, Show more; a Command Palette call picks its target |
| Event tails, timeline and log | [tails.ts](../src/vscode/tails.ts), [sessionDocs.ts](../src/vscode/content/sessionDocs.ts), [channels.ts](../src/vscode/log/channels.ts), [timelineCommands.ts](../src/vscode/commands/timelineCommands.ts) | `TailManager` reference-counts interest per session and owns the `EventTail`; with no holder there is no tail. `migent-session:/<id>/timeline?project=` documents hold interest while a tab shows them. At most 5 `LogOutputChannel`s, least recently shown disposed first; a channel follows the tail only while its session is Running, with a final read when it stops. `migent.session.showTimeline` and `showLog` |
| Window context keys | [contextKeys.ts](../src/vscode/contextKeys.ts) | `migent.hasProjects`, `migent.sessionsState`, `migent.cliState` |
| CLI location and version | [locate.ts](../src/cli/locate.ts), [version.ts](../src/cli/version.ts), [capabilityText.ts](../src/cli/capabilityText.ts) | No `vscode` import. `migent.cli.path` resolves to a shell-free `LaunchSpec`: a native executable, or a `.js`/`.mjs`/`.cjs` entry run with `node` from `PATH`; `.cmd`, `.bat`, `.ps1` and other launchers are unsupported. The required version is a constant in `version.ts`, bumped in the release that needs a newer CLI; there is no setting for it |
| CLI capability service | [capability.ts](../src/vscode/capability.ts), [capabilityCommands.ts](../src/vscode/commands/capabilityCommands.ts) | Per-project state (`checking`, `ok`, `missing`, `unsupported`, `old`, `unparsable`, `error`), one `--version` probe per executable, announces `capability` changes; shows a diagnostic node in the Sessions view; `migent.openSettings` and `migent.cli.recheck` |
| Command execution | [invoke.ts](../src/cli/invoke.ts), [runner.ts](../src/cli/runner.ts), [exitCode.ts](../src/cli/exitCode.ts), [controlArgs.ts](../src/core/controlArgs.ts) | No `vscode` import. Short commands use `execFile` with a timeout and typed errors; long commands (`session run`, `session continue`) use `spawn` with `shell: false` and `windowsHide`, detached on POSIX, and report stderr one complete line at a time. Exit codes map to an outcome enum; exit 9 is a request for input, not a failure. Argv is built as separate values and never quoted or concatenated |
| Operation gate and write eligibility | [operationGate.ts](../src/core/operationGate.ts), [writeEligibility.ts](../src/core/writeEligibility.ts) | In-memory only; `session.lock` stays authoritative for the CLI. A session key `(project, session id)` covers an existing session and a launch key `(project, workflow[, prior])` covers a command that creates one, until the new id is known and the gate is promoted to the session key. A write is refused while the CLI is not usable, while another host holds a live lock, or while this extension has an operation pending for the target |
| Control commands | [control.ts](../src/vscode/control.ts), [controlCommands.ts](../src/vscode/commands/controlCommands.ts) | Run, Prepare, Save & Run, Continue and Stop call the CLI and never update the store directly; the watcher reports the result. The gate is released only after the session's persisted state shows an effect, otherwise `Status not confirmed` keeps it held. Stop reports success only when the stored state is no longer running. Only the user's `task.md` is ever written by the extension |
| Answer questions | [questionAnswers.ts](../src/core/questionAnswers.ts), [answerModel.ts](../src/core/answerModel.ts), [answerState.ts](../src/core/answerState.ts), [panels.ts](../src/vscode/questions/panels.ts), [entry.ts](../src/vscode/questions/entry.ts), [questionCommands.ts](../src/vscode/commands/questionCommands.ts), [media/questions](../media/questions) | Core validates drafts per active mode (choice or Other), serializes the JSON reply map, fingerprints a batch, reconciles recorded answers by `(execution_id, id)` and derives panel states; none import `vscode`. The host keeps one `migent.answerQuestions` webview per `(project, session, stage, execution)`, stores drafts in workspace state outside `.migent/`, and submits through [answers.ts](../src/vscode/answers.ts) with `session continue --reply-file`, after refreshing the target under the gate and verifying the authoritative question file, human recipient, membership and fingerprint. Acceptance comes only from persisted question records, never an exit code; an unconfirmed result is persisted in extension storage with its gate and survives a closed panel or reload until Recheck. [questionNotifier.ts](../src/vscode/questionNotifier.ts) notifies once per newly observed `(session, execution)` batch The page edits and requests; target, paths and argv are host-derived |
| Liveness timer | [liveness.ts](../src/core/liveness.ts) | One 10 s timer, alive only while a session is Running; no `vscode` import |
| Session/workflow locations | [paths.ts](../src/core/paths.ts) | Shared path construction and filenames |
| Shared parsed types and supported versions | [model.ts](../src/core/model.ts) | Core data shapes, not the complete upstream schema |
| Manifest and status reads | [manifest.ts](../src/core/manifest.ts), [statusReader.ts](../src/core/statusReader.ts) | Parse files into nullable fields and explicit read outcomes |
| Lock observation and display derivation | [lockProbe.ts](../src/core/lockProbe.ts), [displayState.ts](../src/core/displayState.ts) | Separate process/file observation from pure state selection |
| Execution and workflow summaries | [executions.ts](../src/core/executions.ts), [workflows.ts](../src/core/workflows.ts) | Read lightweight lists; do not execute workflows |
| Project config and workflow catalog | [projectConfig.ts](../src/core/projectConfig.ts), [projectCatalog.ts](../src/core/projectCatalog.ts) | Read `config.yaml` and workflow files for display; independent of the session store |
| Session detail readers | [questions.ts](../src/core/questions.ts), [outputs.ts](../src/core/outputs.ts), [nextWorkflows.ts](../src/core/nextWorkflows.ts), [handoff.ts](../src/core/handoff.ts), [executionFiles.ts](../src/core/executionFiles.ts) | Stateless read side; each call reads the file and keeps nothing |
| Grouping and attention | [attention.ts](../src/core/attention.ts) | Pure group, count and retention-exemption rules |
| Incremental event reads | [eventTail.ts](../src/core/eventTail.ts) | Complete-line parsing, byte offsets, bounded history, truncation reset |
| Results overview | [resultsModel.ts](../src/core/resultsModel.ts), [resultsIntent.ts](../src/core/resultsIntent.ts), [panels.ts](../src/vscode/results/panels.ts), [resultsCommands.ts](../src/vscode/commands/resultsCommands.ts), [media/results](../media/results) | Core builds the page data (header, outputs, next-step suggestions with declared flag and target-workflow state, source link with handoff provenance, children among retained sessions) as inert JSON and validates the page's messages; `argv` is never passed on. The host keeps one `migent.results` webview panel per `(project, session)`, restored by a serializer, retains `outputs/` while open and posts a revisioned model only when it changed. The page (CSP `default-src 'none'`, nonce script from `media/results/`, `textContent` only) sends identity-only intents; the host resolves each against fresh data. Only `open()` reveals a panel. A Completed Sessions row runs `migent.session.openResult`; the editor-title actions act on the active panel's session |
| Status bar text | [statusBarText.ts](../src/core/statusBarText.ts), [statusBar.ts](../src/vscode/statusBar.ts) | Pure model from per-project attention summaries (hidden when both counts are zero); the host item updates on store changes and liveness ticks, and click runs `migent.sessions.focus` |
| Timeline text | [timelineFormat.ts](../src/core/timelineFormat.ts) | Event to display line; raw passthrough for unrecognized lines |
| Watch planning and debounce | [watchPlan.ts](../src/core/watchPlan.ts), [coalescer.ts](../src/core/coalescer.ts) | Pure desired watcher set and path classification; keyed debounce with injectable timers. No watcher is created in core |
| Session cache and notifications | [store.ts](../src/core/store.ts) | One project per store; snapshot, lazy reads, change events |

Tests are colocated as `src/core/<module>.test.ts` and `src/cli/<module>.test.ts`. Shared sample data lives in
[fixtures](../src/core/fixtures); testing guidance belongs to [testing.md](testing.md); verification commands and
setup belong to [CONTRIBUTING.md](../CONTRIBUTING.md#verification).

## File-format contract

Migent owns the persisted file formats. The upstream
[session contract](https://github.com/nodeint/migent/blob/HEAD/docs/sessions.md)
is maintained in the Migent repository. Consult the matching upstream revision
when changing a reader. Local supported-version constants and
parsed types live in [model.ts](../src/core/model.ts).
